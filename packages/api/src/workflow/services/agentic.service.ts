/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from '@hexabot-ai/agentic';
import { WorkflowFull, WorkflowRunFull, WorkflowType } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';
import { stringifyError } from '@/utils/helpers/misc';

import type { RunLease } from '../lib/run-lease';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import {
  followUps,
  resolveRunId,
  toCallWorkflowResult,
} from '../lib/workflow-call-stack';
import { getOpenWaits, isBlockedOnOperator } from '../lib/workflow-run-waits';
import type {
  CallWorkflowOptions,
  CallWorkflowResult,
  CancelRunOptions,
  CancelRunOutcome,
  ClaimedResume,
  ResumeWaitOptions,
  ResumeWaitOutcome,
  RunPass,
  WorkflowCallService,
} from '../types';
import { HOST_RESOLVED_WAIT_REASONS } from '../types';

import { WorkflowCallStackService } from './workflow-call-stack.service';
import { WorkflowJobs } from './workflow-jobs.service';
import { WorkflowRunExecutor } from './workflow-run-executor.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

const EVENT_FAILURE_MESSAGE =
  'Unable to process incoming event through agentic workflow';

/** How an event is routed to its run. */
type DispatchOptions = {
  /** The target workflow, when the caller already resolved it. */
  workflow?: WorkflowFull;
  /**
   * The caller waits until the run settles. A parent the event sends a failed
   * result to then goes on before the new run starts, so the messages of a
   * conversation keep their order.
   */
  callerWaits?: boolean;
};

/**
 * A run an event was routed to, and the work left on it, which the caller
 * either waits for or leaves to {@link WorkflowJobs}.
 */
type DispatchedRun = {
  /**
   * The run once claimed: created (`idle`) or resumed (`running`); or as it
   * is when the event did not resume it (held, refused or claimed by another
   * caller).
   */
  run: WorkflowRunFull;
  /**
   * Run the work left on the run. Resolves with the run once its pass is
   * over, or `undefined` when the pass threw (logged).
   */
  proceed: () => Promise<WorkflowRunFull | undefined>;
};

/**
 * Thrown by {@link AgenticService.callWorkflow} when the first pass of the
 * child run ends without being able to settle it: the run was taken over (its
 * thread was closed) or recovered (its claim lapsed) while the pass ran, so
 * the outcome of the pass is dropped.
 */
export class WorkflowRunClaimLostError extends Error {
  constructor(readonly runId: string) {
    super(
      `Workflow run ${runId} was settled by another caller while this pass ran`,
    );
    this.name = 'WorkflowRunClaimLostError';
  }
}

/**
 * Entry points of workflow runs: inbound events, calls from a running
 * workflow and admin operations. Each one is routed to its run, which
 * {@link WorkflowRunExecutor} runs, and whose outcome
 * {@link WorkflowCallStackService} carries up its call stack. Work an HTTP
 * request does not wait for goes on in the background ({@link WorkflowJobs}).
 */
@Injectable()
export class AgenticService implements WorkflowCallService {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly executor: WorkflowRunExecutor,
    private readonly callStack: WorkflowCallStackService,
    private readonly jobs: WorkflowJobs,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Process an event by resuming a suspended workflow run if it exists,
   * otherwise start a new run using the latest configured workflow, and wait
   * until the run settles.
   *
   * Callers that already resolved the target workflow (e.g. the webhook
   * trigger path) can pass it through `options.workflow` to avoid a redundant
   * lookup.
   *
   * @returns The run once its pass is over, or `null` when no run processed
   * the event or its pass threw.
   */
  async handleEvent(
    event: TriggerEventWrapper,
    options: { workflow?: WorkflowFull } = {},
  ): Promise<WorkflowRunFull | null> {
    const dispatched = await this.dispatchOrLog(event, {
      ...options,
      callerWaits: true,
    });
    try {
      return (await dispatched?.proceed()) ?? null;
    } catch (error) {
      this.logger.error(EVENT_FAILURE_MESSAGE, error, {
        runId: dispatched?.run.id,
      });

      return null;
    }
  }

  /**
   * Route an event to its run like {@link handleEvent}, without waiting for
   * the run: this returns once the run is claimed, and its pass goes on in
   * the background. Callers that must answer quickly, such as HTTP requests,
   * use it; the run's updates report how it goes on. A parent the event sends
   * a failed result to goes on alongside the new run, not before it.
   *
   * @returns The claimed run (see {@link DispatchedRun.run}), or `null` when
   * no run could process the event.
   */
  async dispatchEvent(
    event: TriggerEventWrapper,
    options: { workflow?: WorkflowFull } = {},
  ): Promise<WorkflowRunFull | null> {
    const dispatched = await this.dispatchOrLog(event, options);
    if (!dispatched) {
      return null;
    }

    this.jobs.spawn(dispatched.proceed, EVENT_FAILURE_MESSAGE, {
      runId: dispatched.run.id,
    });

    return dispatched.run;
  }

  /**
   * Call another workflow from a running parent workflow.
   *
   * This is intentionally an API-level operation: workflows are database
   * records, so type enforcement, call-stack validation, child run creation,
   * and durable parent/child linkage all live here instead of in the agentic
   * DSL runner.
   *
   * @throws {WorkflowRunClaimLostError} When the child run was taken over
   * (its thread was closed) or recovered while it ran; its outcome is dropped.
   * @throws The error of the child's runner when it threw; the child run was
   * failed.
   */
  async callWorkflow({
    workflowId,
    input,
    parentContext,
  }: CallWorkflowOptions): Promise<CallWorkflowResult> {
    const parentRun = await this.workflowRunService.findOneAndPopulate(
      parentContext.workflowRunId,
    );
    if (!parentRun) {
      throw new Error(
        `Unable to load parent workflow run ${parentContext.workflowRunId}`,
      );
    }

    const workflow = await this.workflowService.findOneAndPopulate(workflowId);
    if (!workflow) {
      throw new Error(`Workflow with ID ${workflowId} not found`);
    }
    if (!workflow.definition) {
      throw new Error(`Workflow ${workflowId} is missing a definition`);
    }
    if (workflow.type !== parentRun.workflow.type) {
      throw new Error(
        `Workflow ${workflowId} has type "${workflow.type}" and cannot be called from a "${parentRun.workflow.type}" workflow`,
      );
    }

    await this.workflowRunService.assertCanCallWorkflow(parentRun, workflow.id);

    const { event } = parentContext;
    const { run, lease } = await this.workflowRunService.createFromEvent(
      workflow,
      event,
      { parentRun, input },
    );
    const pass = await this.runStartPass(run, lease, event);
    if (pass.status === 'claim_lost') {
      throw new WorkflowRunClaimLostError(run.id);
    }
    if (pass.status !== 'settled') {
      throw pass.error;
    }

    return toCallWorkflowResult(run, pass.result);
  }

  /**
   * Resolve one open wait of a suspended run on behalf of an admin.
   *
   * The run goes through the same path as any other resume: the payload is
   * validated before the run is claimed, and a refused payload leaves the
   * run waiting. Once the run is claimed, this returns: its pass, and the
   * runs it resumes in turn, go on in the background, since they may take
   * longer than the admin's request may last.
   *
   * @param options.event - Trigger event rebuilt for the run, since no
   * inbound event carries an admin decision.
   * @returns The resume outcome: `accepted` once the run is claimed.
   * @throws When the run could not be resumed and is still waiting, e.g. its
   * pinned definition no longer compiles.
   */
  async resumeWait({
    run,
    event,
    waitId,
    resumeData,
  }: ResumeWaitOptions): Promise<ResumeWaitOutcome> {
    const claim = await this.executor.claimResume({
      run,
      event,
      resumeData,
      selectWait: (waits) => waits.find((wait) => wait.waitId === waitId),
    });
    switch (claim.status) {
      case 'claimed':
        // Started before the run is read back, which then reports how far
        // the pass got.
        this.jobs.spawn(
          () => this.proceedResume(claim),
          'Workflow run failed after its wait was resolved',
          { runId: run.id, waitId },
        );

        return {
          status: 'accepted',
          run: await this.reloadClaimedRun(claim.run),
        };
      case 'unresumable':
        this.failParentInBackground(run, event);

        return { status: 'unresumable', error: claim.error };
      default:
        return claim;
    }
  }

  /**
   * Fail a suspended run on behalf of an admin.
   *
   * The run is claimed on the suspension that was loaded, so a run another
   * caller is resuming is left alone. Its open waits are marked cancelled and
   * its suspended descendants are cancelled too. A parent waiting on it
   * receives the failed result in the background, since it goes on from
   * there.
   */
  async cancelRun({
    run,
    message,
  }: CancelRunOptions): Promise<CancelRunOutcome> {
    if (!(await this.workflowRunService.cancelSuspended(run, message))) {
      return { status: 'claim_lost' };
    }

    await this.workflowRunService.cancelSuspendedDescendants(
      run.id,
      `Parent workflow run ${run.id} was cancelled`,
    );
    this.failParentInBackground(run);

    return {
      status: 'cancelled',
      run: await this.workflowRunService.reload(run),
    };
  }

  /**
   * Route an event to its run (see {@link dispatch}). An error is only
   * logged: no run processed the event.
   */
  private async dispatchOrLog(
    event: TriggerEventWrapper,
    options: DispatchOptions,
  ): Promise<DispatchedRun | null> {
    try {
      return await this.dispatch(event, options);
    } catch (err) {
      this.logger.error(EVENT_FAILURE_MESSAGE, err);

      return null;
    }
  }

  /**
   * Claim the suspended run an event resumes, or create a new run for it.
   * The work left on the run is up to the caller.
   */
  private async dispatch(
    event: TriggerEventWrapper,
    options: DispatchOptions,
  ): Promise<DispatchedRun | null> {
    const initiator = event.getInitiator();
    this.logger.debug('Handling incoming workflow event');
    if (!initiator) {
      this.logger.warn(
        'Skipping workflow execution due to missing event initiator',
      );

      return null;
    }

    // A run waiting on an admin holds the messages of its conversation, so
    // they do not interleave with the pending decision. Other triggers do
    // not converse: they start a new run instead of waiting behind it.
    const suspendedRun =
      await this.workflowRunService.findSuspendedRunByInitiator(
        initiator.id,
        event.getThreadId(),
        event.getWorkflowId(),
        {
          skipBlockedOnOperator:
            event.triggerType !== WorkflowType.conversational,
        },
      );
    if (suspendedRun) {
      this.logger.log('Resuming suspended workflow run', {
        triggeredById: initiator.id,
        runId: suspendedRun.id,
        workflowId: suspendedRun.workflow?.id,
        waitIds: getOpenWaits(suspendedRun).map((wait) => wait.waitId),
      });

      // The event resolves the first open wait, in flow order, that the host
      // does not resolve itself (see `HOST_RESOLVED_WAIT_REASONS`).
      const claim = await this.executor.claimResume({
        run: suspendedRun,
        event,
        selectWait: (waits) =>
          waits.find(
            (wait) => !HOST_RESOLVED_WAIT_REASONS.has(wait.reason ?? ''),
          ),
        resumeData: event.buildInput(),
      });
      switch (claim.status) {
        case 'claimed':
          return {
            run: await this.reloadClaimedRun(claim.run),
            proceed: () => this.proceedResume(claim),
          };
        case 'no_wait':
          return this.holdEvent(suspendedRun, event);
        case 'unresumable':
          this.logger.warn(
            'Suspended workflow run can no longer be resumed; starting a new run',
            {
              triggeredById: initiator.id,
              runId: suspendedRun.id,
              workflowId: suspendedRun.workflow?.id,
            },
          );
          // Only the run this event targeted falls through to a new run: a
          // parent failing further up the call stack must not start another
          // one. When the caller waits for the run, that parent goes on first,
          // so the messages of a conversation keep their order; nothing is
          // claimed for the new run yet, so waiting here is safe. Otherwise it
          // goes on alongside the new run, which the caller answers with.
          if (options.callerWaits) {
            await this.callStack.reconcile(
              [resolveRunId(suspendedRun.parentRun)],
              event,
            );
          } else {
            this.failParentInBackground(suspendedRun, event);
          }
          break;
        default: {
          // The payload was refused, or another caller claimed the run.
          const run = await this.workflowRunService.reload(suspendedRun);

          return { run, proceed: async () => run };
        }
      }
    }

    const workflow = await this.resolveWorkflow(event, options.workflow);

    return workflow ? await this.startNewRun(workflow, event) : null;
  }

  /**
   * Pick the workflow a new run of an event runs: the given one, the one the
   * event targets, or the latest one.
   *
   * @returns The workflow, or `null` when none can run (logged).
   */
  private async resolveWorkflow(
    event: TriggerEventWrapper,
    workflow?: WorkflowFull,
  ): Promise<WorkflowFull | null> {
    const requestedWorkflowId = event.getWorkflowId();
    const resolved =
      workflow ??
      (requestedWorkflowId
        ? await this.workflowService.findOneAndPopulate(requestedWorkflowId)
        : await this.workflowService.pickWorkflow());
    if (!resolved) {
      this.logger.warn('No workflow available to handle incoming event', {
        requestedWorkflowId: requestedWorkflowId ?? null,
      });

      return null;
    }
    if (!resolved.definition) {
      this.logger.warn('Workflow definition is missing', {
        workflowId: resolved.id,
      });

      return null;
    }

    return resolved;
  }

  /**
   * Create a run of a workflow for an event; its first pass is the work left
   * on it.
   */
  private async startNewRun(
    workflow: WorkflowFull,
    event: TriggerEventWrapper,
  ): Promise<DispatchedRun> {
    this.logger.log('Starting workflow run', { workflowId: workflow.id });

    const { run, lease } = await this.workflowRunService.createFromEvent(
      workflow,
      event,
    );

    return {
      run,
      proceed: async () => {
        const pass = await this.runStartPass(run, lease, event);
        switch (pass.status) {
          case 'settled':
            return await this.workflowRunService.reload(run);
          case 'claim_lost':
            this.logger.warn(
              'Workflow run was taken over or recovered while it ran',
              { runId: run.id },
            );

            return undefined;
          default:
            // The runner threw; the pass logged it and failed the run.
            return undefined;
        }
      },
    };
  }

  /**
   * Execute a new run from its first step, then reconcile the runs it leaves
   * (see {@link followUps}).
   *
   * @param lease - Lease the run was created with; the pass ends it.
   * @throws When how the pass ended could not be written (see
   * {@link WorkflowRunExecutor.start}).
   */
  private async runStartPass(
    run: WorkflowRunFull,
    lease: RunLease,
    event: TriggerEventWrapper,
  ): Promise<RunPass> {
    const pass = await this.executor.start(run, lease, event);
    await this.callStack.reconcile(followUps(run, pass), event);

    return pass;
  }

  /**
   * Run the pass of a claimed resume, then read the run back. A step
   * refusing the payload while it ran puts the run back on the same wait.
   *
   * @returns The run once its pass is over, or `undefined` when its runner
   * threw (the pass logged it and failed the run).
   * @throws When how the pass ended could not be written; recovery puts the
   * run back on this wait once its claim lapses.
   */
  private async proceedResume(
    claim: ClaimedResume,
  ): Promise<WorkflowRunFull | undefined> {
    const pass = await this.callStack.continueResume(claim);

    return pass.status === 'crashed'
      ? undefined
      : await this.workflowRunService.reload(claim.run);
  }

  /**
   * Send the parent waiting on a run that ended its failed result, in the
   * background (see {@link WorkflowCallStackService.reconcile}).
   *
   * @param event - Trigger event to resume the parent with; rebuilt when
   * not given.
   */
  private failParentInBackground(
    run: WorkflowRunFull,
    event?: TriggerEventWrapper,
  ): void {
    this.jobs.spawn(
      () => this.callStack.reconcile([resolveRunId(run.parentRun)], event),
      'Unable to send the parent of a workflow run its failed result',
      { runId: run.id },
    );
  }

  /**
   * Leave a suspended run an event cannot resume as it is. The run only waits
   * on things the host resolves, such as a child run or an admin decision: a
   * child that just ended is resuming it right now, and one whose result was
   * missed is caught up by the work left on it.
   */
  private holdEvent(
    run: WorkflowRunFull,
    event: TriggerEventWrapper,
  ): DispatchedRun {
    const details = {
      runId: run.id,
      waits: getOpenWaits(run).map((wait) => wait.reason ?? null),
    };
    if (isBlockedOnOperator(run)) {
      this.logger.log(
        'Holding event: the workflow run waits on an admin',
        details,
      );
    } else {
      this.logger.warn(
        'Suspended workflow run has no wait an event resolves',
        details,
      );
    }

    return {
      run,
      proceed: async () => {
        await this.callStack.reconcile([run.id], event);

        return await this.workflowRunService.reload(run);
      },
    };
  }

  /**
   * Load a run this caller just claimed, to answer with. A failed read must
   * not make the caller report a run that goes on as not resumed.
   */
  private async reloadClaimedRun(
    run: WorkflowRunFull,
  ): Promise<WorkflowRunFull> {
    try {
      return await this.workflowRunService.reload(run);
    } catch (error) {
      this.logger.warn('Unable to reload a claimed workflow run', {
        runId: run.id,
        error: stringifyError(error),
      });

      return { ...run, status: EWorkflowRunStatus.RUNNING };
    }
  }
}

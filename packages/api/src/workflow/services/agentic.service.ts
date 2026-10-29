/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  WaitInfo,
  WorkflowCheckpoint,
  WorkflowCheckpointInvalidError,
  WorkflowDefinitionDriftError,
  WorkflowResumeRejectedError,
  WorkflowRunner,
  WorkflowRunResult,
} from '@hexabot-ai/agentic';
import { WorkflowFull, WorkflowRunFull, WorkflowType } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { LoggerService } from '@/logger/logger.service';
import { stringifyError } from '@/utils/helpers/misc';

import { WorkflowContextFactory } from '../contexts/workflow-context-factory';
import type { WorkflowRuntimeContext } from '../contexts/workflow-runtime.context';
import { runInBackground } from '../lib/run-in-background';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import {
  getChildRunId,
  resolveRunId,
  toCallWorkflowResult,
  toEndedCallWorkflowResult,
  toFailedCallWorkflowResult,
} from '../lib/workflow-call-stack';
import { getOpenWaits, isBlockedOnOperator } from '../lib/workflow-run-waits';
import type {
  CallWorkflowFailedResult,
  CallWorkflowOptions,
  CallWorkflowResult,
  CancelRunOptions,
  CancelRunOutcome,
  ResumeOutcome,
  ResumeRunOptions,
  ResumeWaitOptions,
  ResumeWaitOutcome,
  ResumeWaitSettlement,
  StartRunOptions,
  WorkflowCallService,
  WorkflowRunDispatch,
} from '../types';
import { HOST_RESOLVED_WAIT_REASONS } from '../types';

import type { CompiledRun } from './workflow-compiler.service';
import { WorkflowCompiler } from './workflow-compiler.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

const MISSING_DEFINITION_ERROR =
  'Workflow definition is required to run the workflow';
const EVENT_FAILURE_MESSAGE =
  'Unable to process incoming event through agentic workflow';

type RunWorkflowExecution = {
  run: WorkflowRunFull;
  result: WorkflowRunResult;
};

/** A resume that claimed its run; its pass has not run yet. */
type ClaimedResume = {
  status: 'claimed';
  run: WorkflowRunFull;
  event: TriggerEventWrapper;
  workflow: CompiledRun['workflow'];
  checkpoint: WorkflowCheckpoint;
  context: WorkflowRuntimeContext;
  wait: WaitInfo;
  resumeData: unknown;
  claimId: string;
};

/**
 * A run that was failed because it can never resume. `notifyParent` sends
 * the failed result to a parent waiting on it, which then goes on.
 */
type UnresumableRun = {
  status: 'unresumable';
  run: WorkflowRunFull;
  notifyParent: () => Promise<void>;
};

/** What claiming a suspended run for a resume gave. */
type ResumeClaim =
  | ClaimedResume
  | UnresumableRun
  | Exclude<ResumeOutcome, { status: 'resumed' | 'unresumable' }>;

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
 * Thrown when a pass ends without being able to settle its run: the run was
 * taken over (its thread was closed) or recovered (its claim lapsed) while
 * the pass ran, so the outcome of the pass is dropped.
 */
export class WorkflowRunClaimLostError extends Error {
  constructor(readonly runId: string) {
    super(
      `Workflow run ${runId} was settled by another caller while this pass ran`,
    );
    this.name = 'WorkflowRunClaimLostError';
  }
}

@Injectable()
export class AgenticService implements WorkflowCallService {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly workflowCompiler: WorkflowCompiler,
    private readonly logger: LoggerService,
    private readonly workflowContextFactory: WorkflowContextFactory,
    private readonly eventEmitter: EventEmitter2,
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

    return (await dispatched?.settled) ?? null;
  }

  /**
   * Route an event to its run like {@link handleEvent}, without waiting for
   * the run: this returns once the run is claimed, and its pass goes on in
   * the background. Callers that must answer quickly, such as HTTP requests,
   * use it; the run's updates report how it goes on. A parent the event sends
   * a failed result to goes on alongside the new run, not before it.
   *
   * @returns The claimed run and the work left on it, or `null` when no run
   * could process the event.
   */
  async dispatchEvent(
    event: TriggerEventWrapper,
    options: { workflow?: WorkflowFull } = {},
  ): Promise<WorkflowRunDispatch | null> {
    return await this.dispatchOrLog(event, options);
  }

  /**
   * Route an event to its run (see {@link dispatch}). An error is only
   * logged: no run processed the event.
   */
  private async dispatchOrLog(
    event: TriggerEventWrapper,
    options: DispatchOptions,
  ): Promise<WorkflowRunDispatch | null> {
    try {
      return await this.dispatch(event, options);
    } catch (err) {
      this.logger.error(EVENT_FAILURE_MESSAGE, err);

      return null;
    }
  }

  /**
   * Claim the suspended run an event resumes, or create a new run for it,
   * and start its pass without waiting for it.
   */
  private async dispatch(
    event: TriggerEventWrapper,
    options: DispatchOptions,
  ): Promise<WorkflowRunDispatch | null> {
    const initiator = event.getInitiator();
    const requestedWorkflowId = event.getWorkflowId();
    const threadId = event.getThreadId();
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
        threadId,
        requestedWorkflowId,
        {
          skipBlockedOnOperator:
            event.triggerType !== WorkflowType.conversational,
        },
      );
    let unresumableSettled: Promise<void> | undefined;
    if (suspendedRun) {
      this.logger.log('Resuming suspended workflow run', {
        triggeredById: initiator.id,
        runId: suspendedRun.id,
        workflowId: suspendedRun.workflow?.id,
        waitIds: getOpenWaits(suspendedRun).map((wait) => wait.waitId),
      });

      // The event resolves the first open wait, in flow order, that the host
      // does not resolve itself (see `HOST_RESOLVED_WAIT_REASONS`).
      const claim = await this.claimResume({
        run: suspendedRun,
        event,
        selectWait: (waits) =>
          waits.find(
            (wait) => !HOST_RESOLVED_WAIT_REASONS.has(wait.reason ?? ''),
          ),
        resumeData: event.buildInput(),
      });
      switch (claim.status) {
        case 'claimed': {
          const settled = this.inBackground(
            async () => (await this.runResumePass(claim)).run,
            EVENT_FAILURE_MESSAGE,
            { runId: suspendedRun.id },
          );

          return { run: await this.reloadClaimedRun(suspendedRun), settled };
        }
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
          unresumableSettled = this.inBackground(
            claim.notifyParent,
            'Unable to send the parent of a workflow run that can no longer be resumed its failed result',
            { runId: suspendedRun.id },
          );
          if (options.callerWaits) {
            await unresumableSettled;
          }
          break;
        default:
          return { run: claim.run, settled: Promise.resolve(claim.run) };
      }
    }

    const workflowToRun =
      options.workflow ??
      (requestedWorkflowId
        ? await this.workflowService.findOneAndPopulate(requestedWorkflowId)
        : await this.workflowService.pickWorkflow());
    if (!workflowToRun) {
      this.logger.warn('No workflow available to handle incoming event', {
        requestedWorkflowId: requestedWorkflowId ?? null,
      });

      return null;
    }
    if (!workflowToRun.definition) {
      this.logger.warn('Workflow definition is missing', {
        workflowId: workflowToRun.id,
      });

      return null;
    }

    this.logger.log('Starting workflow run', {
      workflowId: workflowToRun.id,
    });

    const { run, claimId } = await this.workflowRunService.createFromEvent(
      workflowToRun,
      event,
    );
    const settled = this.inBackground(
      async () => (await this.runStartPass(run, claimId, event)).run,
      EVENT_FAILURE_MESSAGE,
      { runId: run.id },
    );

    return {
      run,
      settled: unresumableSettled
        ? Promise.all([settled, unresumableSettled]).then(([ended]) => ended)
        : settled,
    };
  }

  /**
   * Call another workflow from a running parent workflow.
   *
   * This is intentionally an API-level operation: workflows are database
   * records, so type enforcement, call-stack validation, child run creation,
   * and durable parent/child linkage all live here instead of in the agentic
   * DSL runner.
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

    const execution = await this.startRun({
      workflow,
      event: parentContext.event,
      parentRun,
      input,
    });

    return toCallWorkflowResult(execution.run, execution.result);
  }

  /**
   * Create a run for a workflow and execute it from its first step.
   *
   * @throws {WorkflowRunClaimLostError} When the run was taken over (its
   * thread was closed) or recovered while it ran; its outcome is dropped.
   */
  private async startRun(
    options: StartRunOptions,
  ): Promise<RunWorkflowExecution> {
    const { run, claimId } = await this.workflowRunService.createFromEvent(
      options.workflow,
      options.event,
      { parentRun: options.parentRun, input: options.input },
    );

    return await this.runStartPass(run, claimId, options.event);
  }

  /**
   * Execute a new run from its first step.
   *
   * The run was created under a claim, held until its first pass is over. A
   * run that cannot start (no definition, a context or runner that cannot be
   * built) is failed right away.
   *
   * @param claimId - Token of the claim the run was created with.
   * @throws {WorkflowRunClaimLostError} When the run was taken over (its
   * thread was closed) or recovered while it ran; its outcome is dropped.
   */
  private async runStartPass(
    run: WorkflowRunFull,
    claimId: string,
    event: TriggerEventWrapper,
  ): Promise<RunWorkflowExecution> {
    const result = await this.workflowRunService.withHeldClaim(
      run.id,
      claimId,
      async () => {
        let context: WorkflowRuntimeContext | undefined;
        let runner: WorkflowRunner | undefined;
        let passResult: WorkflowRunResult;
        try {
          const compiled = this.workflowCompiler.compile(run, event);
          if (!compiled) {
            throw new Error(MISSING_DEFINITION_ERROR);
          }

          const { definition, workflow } = compiled;
          context = await this.workflowContextFactory.create(
            run,
            event,
            definition,
          );
          runner = await workflow.buildAsyncRunner({ runId: run.id });

          this.logger.debug('Marking workflow run as running', {
            runId: run.id,
            workflowId: run.workflow?.id,
            triggeredById: run.triggeredBy?.id,
          });
          const marked = await this.workflowRunService.markRunning(
            run.id,
            claimId,
            { context: context.state },
          );
          if (!marked) {
            throw new WorkflowRunClaimLostError(run.id);
          }

          passResult = await runner.start({
            inputData: run.input ?? {},
            context,
          });
        } catch (err) {
          if (!(err instanceof WorkflowRunClaimLostError)) {
            this.logger.error('Workflow runner threw during execution', err);
            await this.persistCrashOrLog(
              run,
              runner,
              context?.state,
              err,
              claimId,
            );
          }

          throw err;
        }

        const settled = await this.workflowRunService.persistResult(
          run,
          runner,
          passResult,
          context.state,
          claimId,
        );
        if (!settled) {
          throw new WorkflowRunClaimLostError(run.id);
        }

        return passResult;
      },
    );

    if (result.status === 'suspended') {
      await this.deliverMissedChildResults(run, result.waits, event);
    }

    return { run: await this.reloadRun(run), result };
  }

  /**
   * Fail a run whose pass threw. An error writing it is only logged, so the
   * caller rethrows the error of the pass; the run is then recovered once
   * its claim lapses.
   *
   * @returns `false` when the run could not be settled.
   */
  private async persistCrashOrLog(
    run: WorkflowRunFull,
    runner: WorkflowRunner | undefined,
    contextState: Record<string, unknown> | null | undefined,
    error: unknown,
    claimId: string,
  ): Promise<boolean> {
    try {
      return await this.workflowRunService.persistCrash(
        run,
        runner,
        contextState,
        error,
        claimId,
      );
    } catch (writeError) {
      this.logger.error(
        'Unable to persist the failure of a workflow run; it is recovered once its claim lapses',
        writeError,
        { runId: run.id },
      );

      return false;
    }
  }

  /**
   * Leave a suspended run an event cannot resume as it is. The run only waits
   * on things the host resolves, such as a child run or an admin decision: a
   * child that just ended is resuming it right now, and one whose result was
   * missed is caught up in the background.
   */
  private holdEvent(
    run: WorkflowRunFull,
    event: TriggerEventWrapper,
  ): WorkflowRunDispatch {
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
      settled: this.inBackground(
        async () => {
          await this.resumeFromEndedChildren(run.id, event);

          return await this.reloadRun(run);
        },
        EVENT_FAILURE_MESSAGE,
        { runId: run.id },
      ),
    };
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
    const claim = await this.claimResume({
      run,
      event,
      resumeData,
      selectWait: (waits) => waits.find((wait) => wait.waitId === waitId),
    });
    switch (claim.status) {
      case 'claimed': {
        const settled = this.settleResumeWait(claim);

        return {
          status: 'accepted',
          run: await this.reloadClaimedRun(run),
          settled,
        };
      }
      case 'unresumable':
        return {
          status: 'unresumable',
          run: claim.run,
          settled: this.inBackground(
            claim.notifyParent,
            'Unable to send the parent of a workflow run that can no longer be resumed its failed result',
            { runId: run.id },
          ),
        };
      default:
        return claim;
    }
  }

  /**
   * Run the pass of a resume an admin started, once the request answered.
   * Its outcome is only logged: the admin follows the run through its
   * updates. A step refusing the payload while it ran puts the run back on
   * the same wait.
   */
  private async settleResumeWait(
    claim: ClaimedResume,
  ): Promise<ResumeWaitSettlement> {
    try {
      return await this.runResumePass(claim);
    } catch (error) {
      const current = await this.reloadRun(claim.run).catch(() => claim.run);
      // The run itself, or an ancestor it resumed, failed afterwards; or the
      // pass could not write its outcome, and recovery puts the run back on
      // this wait once its claim lapses.
      this.logger.error(
        'Workflow run failed after its wait was resolved',
        error,
        {
          runId: claim.run.id,
          waitId: claim.wait.waitId,
          status: current.status,
        },
      );

      return { status: 'crashed', run: current, error };
    }
  }

  /**
   * Fail a suspended run on behalf of an admin.
   *
   * The run is claimed on the suspension that was loaded, so a run another
   * caller is resuming is left alone. Its open waits are marked cancelled and
   * its suspended descendants are cancelled too. A parent waiting on it
   * receives a failed result in the background, since it goes on from there.
   *
   * @param options.event - Trigger event used to resume a waiting parent;
   * without it, the parent catches the result up on its next event.
   */
  async cancelRun({
    run,
    message,
    event,
  }: CancelRunOptions): Promise<CancelRunOutcome> {
    if (!(await this.workflowRunService.cancelSuspended(run, message))) {
      return { status: 'claim_lost', run: await this.reloadRun(run) };
    }

    await this.workflowRunService.cancelSuspendedDescendants(
      run.id,
      `Parent workflow run ${run.id} was cancelled`,
    );

    const parentRunId = resolveRunId(run.parentRun);
    let settled: Promise<void> = Promise.resolve();
    if (parentRunId && event) {
      settled = this.inBackground(
        () =>
          this.resumeParentRunFromChild(
            run,
            toFailedCallWorkflowResult(run, message),
            event,
          ),
        'Unable to send the parent of a cancelled workflow run its failed result',
        { runId: run.id, parentRunId },
      );
    } else if (parentRunId) {
      this.logger.warn(
        'Parent workflow run will receive the cancelled result on its next event',
        { runId: run.id, parentRunId },
      );
    }

    return { status: 'cancelled', run: await this.reloadRun(run), settled };
  }

  /**
   * Resume one open wait of a suspended run, and wait for its pass.
   *
   * @throws When the pinned definition no longer compiles (the run stays
   * suspended), or when the pass threw.
   */
  private async resumeRun(options: ResumeRunOptions): Promise<ResumeOutcome> {
    const claim = await this.claimResume(options);
    switch (claim.status) {
      case 'claimed':
        return await this.runResumePass(claim);
      case 'unresumable':
        await claim.notifyParent();

        return { status: 'unresumable', run: claim.run };
      default:
        return claim;
    }
  }

  /**
   * Claim a suspended run to resume one of its open waits.
   *
   * Follows the agentic host contract: the checkpoint and the payload are
   * validated before anything is claimed, then the run is claimed on the
   * suspension that was validated. A refused payload leaves the run exactly
   * as it was, still waiting. The caller must start the pass of a claimed
   * run right away (see {@link runResumePass}).
   *
   * @throws When the pinned definition no longer compiles. The run stays
   * suspended: compiling depends on the registered actions and binding kinds,
   * which a later deployment can restore.
   */
  private async claimResume(options: ResumeRunOptions): Promise<ResumeClaim> {
    const { run, event, resumeData } = options;
    const compiled = this.workflowCompiler.compile(run, event);
    if (!compiled) {
      return await this.failUnresumableRun(
        run,
        new Error(MISSING_DEFINITION_ERROR),
        event,
      );
    }

    const { definition, workflow } = compiled;
    const restorable = workflow.validateCheckpoint(run.checkpoint);
    if (!restorable.ok) {
      return await this.failUnresumableRun(run, restorable.error, event);
    }

    const wait = options.selectWait(restorable.checkpoint.waits);
    if (!wait) {
      return { status: 'no_wait', run };
    }

    const accepted = workflow.validateCheckpoint(restorable.checkpoint, {
      waitId: wait.waitId,
      resumeData,
    });
    if (!accepted.ok) {
      if (accepted.error instanceof WorkflowResumeRejectedError) {
        this.logRejection(run, wait, accepted.error);
        // The runner never sees this payload, so the host reports the
        // refusal as the runner does for the payloads it refuses itself.
        this.eventEmitter.emit('hook:workflow:resume_rejected', {
          runId: run.id,
          wait,
          resumeData,
          error: accepted.error,
        });

        return { status: 'rejected', run, error: accepted.error };
      }

      // The wait was picked from the open ones, so it is always found.
      throw accepted.error;
    }

    const context = await this.workflowContextFactory.create(
      run,
      event,
      definition,
    );
    const claimId = await this.workflowRunService.claimSuspended(
      run.id,
      run.suspendedAt ?? null,
    );
    if (!claimId) {
      this.logger.warn('Workflow run was already resumed by another caller', {
        runId: run.id,
        waitId: wait.waitId,
      });

      return { status: 'claim_lost', run: await this.reloadRun(run) };
    }

    this.logger.debug('Workflow run claimed for a resume', {
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id,
      waitId: wait.waitId,
    });

    return {
      status: 'claimed',
      run,
      event,
      workflow,
      checkpoint: accepted.checkpoint,
      context,
      wait,
      resumeData,
      claimId,
    };
  }

  /**
   * Restore a claimed run from its checkpoint and resume it on the wait it
   * was claimed for, then deliver its outcome to the runs waiting on it.
   *
   * The claim is held, and renewed, from the call on: start this as soon as
   * the run is claimed, never behind other work, or the claim lapses and
   * recovery takes the run over.
   *
   * @throws When the pass threw; the run was failed and a parent waiting on
   * it was sent the failed result.
   */
  private async runResumePass(claim: ClaimedResume): Promise<ResumeOutcome> {
    const { run, event, workflow, context, wait, resumeData, claimId } = claim;
    const pass = await this.workflowRunService.withHeldClaim(
      run.id,
      claimId,
      async () => {
        let runner: WorkflowRunner | undefined;
        let result: WorkflowRunResult;
        try {
          runner = workflow.buildRunnerFromCheckpoint({
            checkpoint: claim.checkpoint,
            context,
            snapshot: run.snapshot ?? undefined,
            runId: run.id,
          });
          result = await runner.resume({ waitId: wait.waitId, resumeData });
        } catch (error) {
          this.logger.error('Workflow runner threw during execution', error);
          const settled = await this.workflowRunService.persistCrash(
            run,
            runner,
            context.state,
            error,
            claimId,
          );

          return { kind: 'crashed', error, settled } as const;
        }

        if (result.status === 'suspended' && result.rejection) {
          // The step that read the payload refused it: the runner put the run
          // back as its checkpoint describes it, so only the claim is undone.
          this.logRejection(run, wait, result.rejection.error);
          const settled = await this.workflowRunService.releaseClaim(
            run.id,
            claimId,
          );

          return {
            kind: 'rejected',
            result,
            error: result.rejection.error,
            settled,
          } as const;
        }

        const settled = await this.workflowRunService.persistResult(
          run,
          runner,
          result,
          context.state,
          claimId,
        );

        return { kind: 'settled', result, settled } as const;
      },
    );

    // The run was taken over or recovered while this pass ran: its outcome
    // is dropped, and whoever settled the run delivers what has to be.
    if (!pass.settled) {
      return { status: 'claim_lost', run: await this.reloadRun(run) };
    }

    if (pass.kind === 'crashed') {
      await this.resumeParentRunFromChild(
        run,
        toFailedCallWorkflowResult(run, pass.error),
        event,
      );

      throw pass.error;
    }

    if (pass.kind === 'rejected') {
      await this.deliverMissedChildResults(run, pass.result.waits, event);

      return {
        status: 'rejected',
        run: await this.reloadRun(run),
        error: pass.error,
      };
    }

    const { result } = pass;
    if (result.status === 'suspended') {
      await this.deliverMissedChildResults(run, result.waits, event);
    } else {
      await this.resumeParentRunFromChild(
        run,
        toCallWorkflowResult(run, result),
        event,
      );
    }

    return { status: 'resumed', run: await this.reloadRun(run) };
  }

  /**
   * Fail a suspended run that can never be resumed: it pins no definition,
   * or its checkpoint is missing, malformed or taken against another
   * definition. Failing it stops it from claiming further events.
   *
   * @returns The failed run, and how to send a parent waiting on it the
   * failed result; the caller decides whether to wait for that parent.
   */
  private async failUnresumableRun(
    run: WorkflowRunFull,
    error: unknown,
    event: TriggerEventWrapper,
  ): Promise<UnresumableRun | { status: 'claim_lost'; run: WorkflowRunFull }> {
    const claimId = await this.workflowRunService.claimSuspended(
      run.id,
      run.suspendedAt ?? null,
    );
    if (!claimId) {
      return { status: 'claim_lost', run: await this.reloadRun(run) };
    }

    this.logger.error('Workflow run can no longer be resumed', error, {
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id ?? null,
      ...(error instanceof WorkflowCheckpointInvalidError
        ? { code: error.code, path: error.path }
        : {}),
      ...(error instanceof WorkflowDefinitionDriftError
        ? { expected: error.expected, actual: error.actual }
        : {}),
    });
    const message = `Cannot resume workflow run: ${stringifyError(error)}`;
    const failed = await this.workflowRunService.markFailed(
      run.id,
      { error: message },
      claimId,
    );
    if (!failed) {
      return { status: 'claim_lost', run: await this.reloadRun(run) };
    }

    return {
      status: 'unresumable',
      run: await this.reloadRun(run),
      notifyParent: () =>
        this.resumeParentRunFromChild(
          run,
          toFailedCallWorkflowResult(run, message),
          event,
        ),
    };
  }

  /**
   * Log a refused resume payload; the run keeps waiting on the same wait.
   */
  private logRejection(
    run: WorkflowRunFull,
    wait: WaitInfo,
    error: WorkflowResumeRejectedError,
  ): void {
    this.logger.warn('Workflow run refused the resume payload', {
      runId: run.id,
      waitId: wait.waitId,
      reason: wait.reason ?? null,
      error: error.message,
      issues: error.issues,
    });
  }

  /**
   * Build the `call_workflow` payload of a child run that no longer exists.
   *
   * @param wait - The parent's wait on the child run.
   * @param childRunId - Id of the deleted child run.
   */
  private async toDeletedCallWorkflowResult(
    wait: WaitInfo,
    childRunId: string,
  ): Promise<CallWorkflowFailedResult> {
    const workflowId = (wait.data as { workflow_id?: unknown } | null)
      ?.workflow_id;
    const workflow =
      typeof workflowId === 'string'
        ? await this.workflowService.findOne(workflowId)
        : null;

    return {
      status: 'failed',
      workflow_id: typeof workflowId === 'string' ? workflowId : '',
      workflow_run_id: childRunId,
      error: workflow
        ? `Called workflow run ${childRunId} was deleted`
        : `Called workflow ${String(workflowId)} was deleted`,
    };
  }

  /**
   * Resume a suspended parent run after its child run completes or fails.
   *
   * The child result resolves the parent wait opened by the `call_workflow`
   * step that spawned this child. This may cascade through multiple ancestors
   * because resuming the parent can itself finish a child call that belongs to
   * another suspended parent.
   */
  private async resumeParentRunFromChild(
    childRun: WorkflowRunFull,
    payload: CallWorkflowResult,
    event: TriggerEventWrapper,
  ): Promise<void> {
    const parentRunId = resolveRunId(childRun.parentRun);
    if (!parentRunId) {
      return;
    }

    const parentRun =
      await this.workflowRunService.findOneAndPopulate(parentRunId);
    if (!parentRun) {
      this.logger.warn('Unable to resume missing parent workflow run', {
        childRunId: childRun.id,
        parentRunId,
      });

      return;
    }

    await this.resumeParentRunWithChildResult(
      parentRun,
      childRun.id,
      payload,
      event,
    );
  }

  /**
   * Resolve the wait a parent run holds on one of its child runs.
   */
  private async resumeParentRunWithChildResult(
    parentRun: WorkflowRunFull,
    childRunId: string,
    payload: CallWorkflowResult,
    event: TriggerEventWrapper,
  ): Promise<void> {
    const parentRunId = parentRun.id;
    // A parent still running catches this result up once it suspends.
    if (parentRun.status !== 'suspended') {
      this.logger.warn(
        'Skipping parent workflow resume because it is not suspended',
        {
          childRunId,
          parentRunId,
          parentStatus: parentRun.status,
        },
      );

      return;
    }

    const outcome = await this.resumeRun({
      run: parentRun,
      event,
      selectWait: (waits) =>
        waits.find((wait) => getChildRunId(wait) === childRunId),
      resumeData: payload,
    });

    switch (outcome.status) {
      case 'no_wait':
        this.logger.warn('Parent workflow run is not waiting on this child', {
          childRunId,
          parentRunId,
        });
        break;
      case 'claim_lost':
        // The caller holding the parent catches this result up once the
        // parent suspends again.
        this.logger.warn('Parent workflow run is being resumed by another', {
          childRunId,
          parentRunId,
        });
        break;
      case 'rejected': {
        // The child result cannot be sent again, so the parent could never
        // leave this wait.
        const failed = await this.failUnresumableRun(
          parentRun,
          outcome.error,
          event,
        );
        if (failed.status === 'unresumable') {
          await failed.notifyParent();
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Deliver the results of child runs that ended while `run` was not
   * suspended. Call it each time `run` goes back to `suspended`.
   *
   * @param waits The waits `run` was left suspended on.
   */
  private async deliverMissedChildResults(
    run: WorkflowRunFull,
    waits: WaitInfo[],
    event: TriggerEventWrapper,
  ): Promise<void> {
    if (waits.some((wait) => getChildRunId(wait))) {
      await this.resumeFromEndedChildren(run.id, event);
    }
  }

  /**
   * Resume a suspended parent with the result of a child that already ended.
   *
   * A child cannot resume a parent that is still running, e.g. one whose
   * first pass is still going after spawning it, and it loses the claim on a
   * parent held by another caller, e.g. two children of a `wait_all` block
   * finishing together. Whoever leaves the parent suspended calls this to
   * deliver the result that was missed. One wait is resolved per call: that
   * resume calls back here once the parent suspends again.
   *
   * A child run that no longer exists, e.g. deleted along with its workflow,
   * will never end: the parent receives a failed result for it instead.
   */
  async resumeFromEndedChildren(
    parentRunId: string,
    event: TriggerEventWrapper,
  ): Promise<void> {
    const parentRun =
      await this.workflowRunService.findOneAndPopulate(parentRunId);
    if (!parentRun || parentRun.status !== 'suspended') {
      return;
    }

    for (const wait of getOpenWaits(parentRun)) {
      const childRunId = getChildRunId(wait);
      if (!childRunId) {
        continue;
      }

      const childRun =
        await this.workflowRunService.findOneAndPopulate(childRunId);
      if (!childRun) {
        const payload = await this.toDeletedCallWorkflowResult(
          wait,
          childRunId,
        );
        this.logger.warn('Failing a call to a workflow run that was deleted', {
          parentRunId: parentRun.id,
          childRunId,
          error: payload.error,
        });
        await this.resumeParentRunWithChildResult(
          parentRun,
          childRunId,
          payload,
          event,
        );

        return;
      }

      if (
        resolveRunId(childRun.parentRun) !== parentRun.id ||
        (childRun.status !== 'finished' && childRun.status !== 'failed')
      ) {
        continue;
      }

      this.logger.log('Resuming parent workflow run with a missed result', {
        parentRunId: parentRun.id,
        childRunId: childRun.id,
      });
      await this.resumeParentRunFromChild(
        childRun,
        toEndedCallWorkflowResult(childRun),
        event,
      );

      return;
    }
  }

  /**
   * Load the latest persisted state of a run, falling back to the given one.
   */
  private async reloadRun(run: WorkflowRunFull): Promise<WorkflowRunFull> {
    return (await this.workflowRunService.findOneAndPopulate(run.id)) ?? run;
  }

  /**
   * Load a run whose pass was started in the background. A failed read must
   * not make the caller report a run that goes on as not resumed.
   */
  private async reloadClaimedRun(
    run: WorkflowRunFull,
  ): Promise<WorkflowRunFull> {
    try {
      return await this.reloadRun(run);
    } catch (error) {
      this.logger.warn('Unable to reload a claimed workflow run', {
        runId: run.id,
        error: stringifyError(error),
      });

      return { ...run, status: EWorkflowRunStatus.RUNNING };
    }
  }

  /**
   * Start work on a run without waiting for it (see {@link runInBackground}):
   * it starts right away, and its errors are logged. A pass whose run was
   * taken over or recovered meanwhile is only warned about: whoever settled
   * the run delivers what has to be.
   *
   * @returns The result of the work, or `undefined` when it threw. Never
   * rejects.
   */
  private inBackground<T>(
    work: () => Promise<T>,
    message: string,
    details: Record<string, unknown>,
  ): Promise<T | undefined> {
    return runInBackground(
      this.logger,
      async () => {
        try {
          return await work();
        } catch (err) {
          if (!(err instanceof WorkflowRunClaimLostError)) {
            throw err;
          }

          this.logger.warn(
            'Workflow run was taken over or recovered while it ran',
            { runId: err.runId },
          );

          return undefined;
        }
      },
      message,
      details,
    );
  }
}

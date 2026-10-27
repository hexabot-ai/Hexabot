/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  WaitInfo,
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
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import {
  getChildRunId,
  resolveRunId,
  toCallWorkflowResult,
  toEndedCallWorkflowResult,
  toFailedCallWorkflowResult,
} from '../lib/workflow-call-stack';
import {
  getOpenWaits,
  isBlockedOnOperator,
  isSameSuspension,
} from '../lib/workflow-run-waits';
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
  StartRunOptions,
  WorkflowCallService,
} from '../types';
import { HOST_RESOLVED_WAIT_REASONS } from '../types';

import { WorkflowCompiler } from './workflow-compiler.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

const MISSING_DEFINITION_ERROR =
  'Workflow definition is required to run the workflow';

type RunWorkflowExecution = {
  run: WorkflowRunFull;
  result: WorkflowRunResult;
};

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
   * otherwise start a new run using the latest configured workflow.
   *
   * Callers that already resolved the target workflow (e.g. the webhook
   * trigger path) can pass it through `options.workflow` to avoid a redundant
   * lookup.
   */
  async handleEvent(
    event: TriggerEventWrapper,
    options: { workflow?: WorkflowFull } = {},
  ): Promise<WorkflowRunFull | null> {
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

    try {
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
      if (suspendedRun) {
        this.logger.log('Resuming suspended workflow run', {
          triggeredById: initiator.id,
          runId: suspendedRun.id,
          workflowId: suspendedRun.workflow?.id,
          waitIds: getOpenWaits(suspendedRun).map((wait) => wait.waitId),
        });

        const outcome = await this.resumeRunFromEvent(suspendedRun, event);
        // Only the run this event targeted may fall through to a new run: a
        // parent failing further up the call stack must not start another one.
        if (outcome.status !== 'unresumable') {
          return outcome.run;
        }

        this.logger.warn(
          'Suspended workflow run can no longer be resumed; starting a new run',
          {
            triggeredById: initiator.id,
            runId: suspendedRun.id,
            workflowId: suspendedRun.workflow?.id,
          },
        );
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

      const execution = await this.startRun({
        workflow: workflowToRun,
        event,
      });

      return execution.run;
    } catch (err) {
      this.logger.error(
        'Unable to process incoming event through agentic workflow',
        err,
      );

      return null;
    }
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
   */
  private async startRun(
    options: StartRunOptions,
  ): Promise<RunWorkflowExecution> {
    const { event } = options;
    const run = await this.workflowRunService.createFromEvent(
      options.workflow,
      event,
      { parentRun: options.parentRun, input: options.input },
    );
    const compiled = this.workflowCompiler.compile(run, event);
    if (!compiled) {
      throw new Error(MISSING_DEFINITION_ERROR);
    }

    const { definition, workflow } = compiled;
    const context = await this.workflowContextFactory.create(
      run,
      event,
      definition,
    );
    const runner = await workflow.buildAsyncRunner({ runId: run.id });

    this.logger.debug('Marking workflow run as running', {
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id,
    });
    await this.workflowRunService.markRunning(run.id, {
      context: context.state,
    });

    let result: WorkflowRunResult;
    try {
      result = await runner.start({
        inputData: run.input ?? {},
        context,
      });
    } catch (err) {
      this.logger.error('Workflow runner threw during execution', err);
      await this.workflowRunService.persistCrash(
        run,
        runner,
        context.state,
        err,
      );

      throw err;
    }

    await this.workflowRunService.persistResult(
      run,
      runner,
      result,
      context.state,
    );
    if (result.status === 'suspended') {
      await this.deliverMissedChildResults(run, result.waits, event);
    }

    return { run: await this.reloadRun(run), result };
  }

  /**
   * Resume a suspended run with the input of an inbound event.
   *
   * The event resolves the first open wait, in flow order, that the host does
   * not resolve itself (see `HOST_RESOLVED_WAIT_REASONS`).
   */
  private async resumeRunFromEvent(
    run: WorkflowRunFull,
    event: TriggerEventWrapper,
  ): Promise<ResumeOutcome> {
    const outcome = await this.resumeRun({
      run,
      event,
      selectWait: (waits) =>
        waits.find(
          (wait) => !HOST_RESOLVED_WAIT_REASONS.has(wait.reason ?? ''),
        ),
      resumeData: event.buildInput(),
    });
    if (outcome.status !== 'no_wait') {
      return outcome;
    }

    // The run only waits on things the host resolves, such as a child run or
    // an admin decision. It is left as is: a child that just ended is resuming
    // it right now, and one whose result was missed is caught up below.
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
    await this.resumeFromEndedChildren(run.id, event);

    return { ...outcome, run: await this.reloadRun(run) };
  }

  /**
   * Resolve one open wait of a suspended run on behalf of an admin.
   *
   * The run goes through the same path as any other resume: the payload is
   * validated before the run is claimed, and a refused payload leaves the
   * run waiting.
   *
   * @param options.event - Trigger event rebuilt for the run, since no
   * inbound event carries an admin decision.
   * @returns The resume outcome, or `failed` when the wait was resolved but
   * the run failed while it went on.
   * @throws When the run could not be resumed and is still waiting, e.g. its
   * pinned definition no longer compiles.
   */
  async resumeWait({
    run,
    event,
    waitId,
    resumeData,
  }: ResumeWaitOptions): Promise<ResumeWaitOutcome> {
    try {
      return await this.resumeRun({
        run,
        event,
        resumeData,
        selectWait: (waits) => waits.find((wait) => wait.waitId === waitId),
      });
    } catch (error) {
      const current = await this.reloadRun(run);
      if (current.status === 'suspended' && isSameSuspension(current, run)) {
        throw error;
      }

      // The wait was resolved: the run itself, or an ancestor it resumed,
      // failed afterwards and was already marked failed.
      this.logger.error(
        'Workflow run failed after its wait was resolved',
        error,
        {
          runId: run.id,
          waitId,
          status: current.status,
        },
      );

      return current.status === 'failed'
        ? { status: 'failed', run: current, error }
        : { status: 'resumed', run: current };
    }
  }

  /**
   * Fail a suspended run on behalf of an admin.
   *
   * The run is claimed on the suspension that was loaded, so a run another
   * caller is resuming is left alone. Its open waits are marked cancelled,
   * its suspended descendants are cancelled too, and a parent waiting on it
   * receives a failed result.
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

    if (resolveRunId(run.parentRun)) {
      if (event) {
        await this.resumeParentRunFromChild(
          run,
          toFailedCallWorkflowResult(run, message),
          event,
        );
      } else {
        this.logger.warn(
          'Parent workflow run will receive the cancelled result on its next event',
          { runId: run.id, parentRunId: resolveRunId(run.parentRun) },
        );
      }
    }

    return { status: 'cancelled', run: await this.reloadRun(run) };
  }

  /**
   * Resume one open wait of a suspended run.
   *
   * Follows the agentic host contract: the checkpoint and the payload are
   * validated before anything is claimed, the run is then claimed on the
   * suspension that was validated, restored from its checkpoint, and resumed.
   * A refused payload leaves the run exactly as it was, still waiting.
   *
   * @throws When the pinned definition no longer compiles. The run stays
   * suspended: compiling depends on the registered actions and binding kinds,
   * which a later deployment can restore.
   */
  private async resumeRun(options: ResumeRunOptions): Promise<ResumeOutcome> {
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
    const claimed = await this.workflowRunService.claimSuspended(
      run.id,
      run.suspendedAt ?? null,
    );
    if (!claimed) {
      this.logger.warn('Workflow run was already resumed by another caller', {
        runId: run.id,
        waitId: wait.waitId,
      });

      return { status: 'claim_lost', run: await this.reloadRun(run) };
    }

    this.logger.debug('Marking workflow run as running', {
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id,
      waitId: wait.waitId,
    });
    await this.workflowRunService.markRunning(run.id, {
      context: context.state,
    });

    let runner: WorkflowRunner | undefined;
    let result: WorkflowRunResult;
    try {
      runner = workflow.buildRunnerFromCheckpoint({
        checkpoint: accepted.checkpoint,
        context,
        snapshot: run.snapshot ?? undefined,
        runId: run.id,
      });
      result = await runner.resume({ waitId: wait.waitId, resumeData });
    } catch (err) {
      this.logger.error('Workflow runner threw during execution', err);
      await this.workflowRunService.persistCrash(
        run,
        runner,
        context.state,
        err,
      );
      await this.resumeParentRunFromChild(
        run,
        toFailedCallWorkflowResult(run, err),
        event,
      );

      throw err;
    }

    if (result.status === 'suspended' && result.rejection) {
      // The step that read the payload refused it: the runner put the run
      // back as its checkpoint describes it, so only the claim is undone.
      this.logRejection(run, wait, result.rejection.error);
      await this.workflowRunService.releaseClaim(run.id, {
        context: run.context ?? null,
      });
      await this.deliverMissedChildResults(run, result.waits, event);

      return {
        status: 'rejected',
        run: await this.reloadRun(run),
        error: result.rejection.error,
      };
    }

    await this.workflowRunService.persistResult(
      run,
      runner,
      result,
      context.state,
    );

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
   */
  private async failUnresumableRun(
    run: WorkflowRunFull,
    error: unknown,
    event: TriggerEventWrapper,
  ): Promise<ResumeOutcome> {
    const claimed = await this.workflowRunService.claimSuspended(
      run.id,
      run.suspendedAt ?? null,
    );
    if (!claimed) {
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
    await this.workflowRunService.markFailed(run.id, { error: message });
    await this.resumeParentRunFromChild(
      run,
      toFailedCallWorkflowResult(run, message),
      event,
    );

    return { status: 'unresumable', run: await this.reloadRun(run) };
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
      case 'rejected':
        // The child result cannot be sent again, so the parent could never
        // leave this wait.
        await this.failUnresumableRun(parentRun, outcome.error, event);
        break;
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
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Workflow as AgenticWorkflow,
  JsonataFunctionRegistry,
  StepExecutionRecord,
  WaitInfo,
  WorkflowCheckpointInvalidError,
  WorkflowDefinition,
  WorkflowDefinitionDriftError,
  WorkflowResumeRejectedError,
  WorkflowRunner,
  WorkflowRunResult,
} from '@hexabot-ai/agentic';
import { WorkflowFull, WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { I18nService } from '@/i18n/services/i18n.service';
import { LoggerService } from '@/logger/logger.service';

import { WorkflowContextFactory } from '../contexts/workflow-context-factory';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import { parseWorkflowDefinition } from '../lib/workflow-definition';
import { getOpenWaits } from '../lib/workflow-run-waits';
import type {
  CallWorkflowOptions,
  CallWorkflowResult,
  ResumeOutcome,
  ResumeRunOptions,
  StartRunOptions,
  WorkflowCallService,
} from '../types';
import {
  AWAITING_CHILD_WORKFLOW_REASON,
  HOST_RESOLVED_WAIT_REASONS,
} from '../types';

import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

const MAX_CALL_STACK_DEPTH = 10;
const MISSING_DEFINITION_ERROR =
  'Workflow definition is required to run the workflow';

type RunWorkflowExecution = {
  run: WorkflowRunFull;
  result: WorkflowRunResult;
};

/** The definition a run pins, and the workflow compiled from it. */
type CompiledRun = {
  definition: WorkflowDefinition;
  workflow: AgenticWorkflow;
};

@Injectable()
export class AgenticService implements WorkflowCallService {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly actionService: ActionService,
    private readonly runtimeBindingsService: RuntimeBindingsService,
    private readonly logger: LoggerService,
    private readonly workflowContextFactory: WorkflowContextFactory,
    private readonly i18n: I18nService,
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
      const suspendedRun =
        await this.workflowRunService.findSuspendedRunByInitiator(
          initiator.id,
          threadId,
          requestedWorkflowId,
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

    await this.assertCanCallWorkflow(parentRun, workflow.id);

    const execution = await this.startRun({
      workflow,
      event: parentContext.event,
      parentRun,
      input,
    });

    return this.toCallWorkflowResult(execution.run, execution.result);
  }

  /**
   * Create a run for a workflow and execute it from its first step.
   */
  private async startRun(
    options: StartRunOptions,
  ): Promise<RunWorkflowExecution> {
    const { event } = options;
    const run = await this.createRun(options.workflow, event, {
      parentRun: options.parentRun,
      input: options.input,
    });
    const compiled = this.compileRun(run, event);
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
      await this.markRunFailed(run, runner, context.state, err);

      throw err;
    }

    await this.persistResult(run, runner, result, context.state);
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

    // The run only waits on things the host resolves, such as a child run.
    // It is left as is: a child that just ended is resuming it right now,
    // and one whose result was missed is caught up below.
    this.logger.warn('Suspended workflow run has no wait an event resolves', {
      runId: run.id,
      waits: getOpenWaits(run).map((wait) => wait.reason ?? null),
    });
    await this.resumeFromEndedChildren(run.id, event);

    return { ...outcome, run: await this.reloadRun(run) };
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
    const compiled = this.compileRun(run, event);
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
      await this.markRunFailed(run, runner, context.state, err);
      await this.resumeParentRunFromChild(
        run,
        this.toFailedCallWorkflowResult(run, err),
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

    await this.persistResult(run, runner, result, context.state);

    if (result.status === 'suspended') {
      await this.deliverMissedChildResults(run, result.waits, event);
    } else {
      await this.resumeParentRunFromChild(
        run,
        this.toCallWorkflowResult(run, result),
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
    const message = `Cannot resume workflow run: ${this.stringifyError(error)}`;
    await this.workflowRunService.markFailed(run.id, { error: message });
    await this.resumeParentRunFromChild(
      run,
      this.toFailedCallWorkflowResult(run, message),
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
   * Compile the definition pinned by a run's workflow version.
   *
   * @returns The compiled run, or `undefined` when the run pins no definition.
   * @throws When the definition no longer parses or compiles against the
   * registered actions and binding kinds.
   */
  private compileRun(
    run: WorkflowRunFull,
    event: TriggerEventWrapper,
  ): CompiledRun | undefined {
    const definition = this.resolveRunDefinition(run);
    if (!definition) {
      return undefined;
    }

    const workflow = AgenticWorkflow.fromDefinition(definition, {
      actions: this.actionService.getRegistry(),
      bindingKinds: this.runtimeBindingsService.getRegistry(),
      jsonataFunctions: this.buildJsonataFunctions(event),
    });

    return { definition, workflow };
  }

  /**
   * Build JSONata helpers scoped to the workflow initiator language.
   */
  private buildJsonataFunctions(
    event: TriggerEventWrapper,
  ): JsonataFunctionRegistry {
    const initiatorLanguage = event.getInitiator()?.language || undefined;

    return {
      t: (key: string, args?: Record<string, unknown>) =>
        this.i18n.t(key, {
          lang: initiatorLanguage,
          defaultValue: key,
          args,
        }),
    };
  }

  /**
   * Create a workflow run record and load it with relations.
   *
   * Child calls inherit the same event metadata, initiator, and thread as the
   * parent, but store an explicit `parentRun` relation so future events can
   * resume the deepest suspended child before returning to the parent.
   */
  private async createRun(
    workflow: WorkflowFull,
    event: TriggerEventWrapper,
    options: {
      parentRun?: WorkflowRunFull;
      input?: Record<string, unknown>;
    } = {},
  ): Promise<WorkflowRunFull> {
    const initiator = event.getInitiator();
    if (!workflow.definition) {
      throw new Error('Workflow definition is required to create a run');
    }
    const initialContext = {
      ...(workflow.definition.context ?? {}),
      ...event.getContextData(),
    };
    const run = await this.workflowRunService.create({
      workflow: workflow.id,
      workflowVersion: workflow.currentVersion?.id ?? null,
      triggeredBy: initiator.id,
      thread: event.getThreadId() ?? null,
      parentRun: options.parentRun?.id ?? null,
      input: options.input ?? event.buildInput(),
      context: Object.keys(initialContext).length > 0 ? initialContext : null,
      metadata: event.getMetadata(),
    });
    const populated = await this.workflowRunService.findOneAndPopulate(run.id);

    if (!populated) {
      throw new Error(`Unable to load workflow run ${run.id}`);
    }

    return populated;
  }

  /**
   * Validate that a workflow call does not create a recursive or overly deep stack.
   *
   * The walk follows active parent links, so only the current call stack is
   * rejected; a workflow can still be called again after an earlier stack has
   * completed.
   */
  private async assertCanCallWorkflow(
    parentRun: WorkflowRunFull,
    targetWorkflowId: string,
  ): Promise<void> {
    let current: WorkflowRunFull | null = parentRun;
    let depth = 0;

    while (current) {
      depth += 1;
      if (depth >= MAX_CALL_STACK_DEPTH) {
        throw new Error(
          `Workflow call stack depth cannot exceed ${MAX_CALL_STACK_DEPTH}`,
        );
      }

      if (current.workflow.id === targetWorkflowId) {
        throw new Error(
          `Workflow call cycle detected for workflow ${targetWorkflowId}`,
        );
      }

      const parentRunId = this.resolveRunId(current.parentRun);
      current = parentRunId
        ? await this.workflowRunService.findOneAndPopulate(parentRunId)
        : null;
    }
  }

  /**
   * Convert a child run terminal/suspended result into the `call_workflow`
   * contract. The same payload shape is used for immediate returns and for
   * resuming a parent after the child completed in a later event.
   */
  private toCallWorkflowResult(
    run: WorkflowRunFull,
    result: WorkflowRunResult,
  ): CallWorkflowResult {
    if (result.status === 'finished') {
      return {
        status: 'finished',
        workflow_id: run.workflow.id,
        workflow_run_id: run.id,
        output: result.output,
      };
    }

    if (result.status === 'suspended') {
      return {
        status: 'suspended',
        workflow_id: run.workflow.id,
        workflow_run_id: run.id,
      };
    }

    return this.toFailedCallWorkflowResult(run, result.error);
  }

  /**
   * Build the `call_workflow` payload of a child run that failed.
   */
  private toFailedCallWorkflowResult(
    run: WorkflowRunFull,
    error: unknown,
  ): CallWorkflowResult {
    return {
      status: 'failed',
      workflow_id: run.workflow.id,
      workflow_run_id: run.id,
      error: this.stringifyError(error),
    };
  }

  /**
   * Build the `call_workflow` payload of a persisted child run that ended.
   */
  private toEndedCallWorkflowResult(run: WorkflowRunFull): CallWorkflowResult {
    if (run.status === 'finished') {
      return {
        status: 'finished',
        workflow_id: run.workflow.id,
        workflow_run_id: run.id,
        output: run.output ?? {},
      };
    }

    return this.toFailedCallWorkflowResult(
      run,
      run.error ?? 'Child workflow run failed',
    );
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
    const parentRunId = this.resolveRunId(childRun.parentRun);
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

    // A parent still running catches this result up once it suspends.
    if (parentRun.status !== 'suspended') {
      this.logger.warn(
        'Skipping parent workflow resume because it is not suspended',
        {
          childRunId: childRun.id,
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
        waits.find((wait) => this.getChildRunId(wait) === childRun.id),
      resumeData: payload,
    });

    switch (outcome.status) {
      case 'no_wait':
        this.logger.warn('Parent workflow run is not waiting on this child', {
          childRunId: childRun.id,
          parentRunId,
        });
        break;
      case 'claim_lost':
        // The caller holding the parent catches this result up once the
        // parent suspends again.
        this.logger.warn('Parent workflow run is being resumed by another', {
          childRunId: childRun.id,
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
    if (waits.some((wait) => this.getChildRunId(wait))) {
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
   */
  private async resumeFromEndedChildren(
    parentRunId: string,
    event: TriggerEventWrapper,
  ): Promise<void> {
    const parentRun =
      await this.workflowRunService.findOneAndPopulate(parentRunId);
    if (!parentRun || parentRun.status !== 'suspended') {
      return;
    }

    for (const wait of getOpenWaits(parentRun)) {
      const childRunId = this.getChildRunId(wait);
      const childRun = childRunId
        ? await this.workflowRunService.findOneAndPopulate(childRunId)
        : null;
      if (
        !childRun ||
        this.resolveRunId(childRun.parentRun) !== parentRun.id ||
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
        this.toEndedCallWorkflowResult(childRun),
        event,
      );

      return;
    }
  }

  /**
   * Read the child run a `call_workflow` wait is waiting on.
   *
   * @returns The child run id, or `undefined` for any other wait.
   */
  private getChildRunId(wait: WaitInfo): string | undefined {
    if (wait.reason !== AWAITING_CHILD_WORKFLOW_REASON) {
      return undefined;
    }

    const childRunId = (wait.data as { workflow_run_id?: unknown } | null)
      ?.workflow_run_id;

    return typeof childRunId === 'string' ? childRunId : undefined;
  }

  /**
   * Resolve a workflow run relation from either a populated object or id.
   */
  private resolveRunId(
    run: string | { id?: string | null } | null | undefined,
  ): string | null {
    if (typeof run === 'string') {
      return run;
    }

    return run?.id ?? null;
  }

  /**
   * Load the latest persisted state of a run, falling back to the given one.
   */
  private async reloadRun(run: WorkflowRunFull): Promise<WorkflowRunFull> {
    return (await this.workflowRunService.findOneAndPopulate(run.id)) ?? run;
  }

  /**
   * Resolve the workflow definition snapshot used by the current run.
   */
  private resolveRunDefinition(run: WorkflowRunFull) {
    const definitionYml = run.workflowVersion?.definitionYml;
    if (typeof definitionYml === 'string' && definitionYml.trim() !== '') {
      return parseWorkflowDefinition(definitionYml);
    }
  }

  /**
   * Persist the outcome of a runner pass and the run state it left.
   */
  private async persistResult(
    run: WorkflowRunFull,
    runner: WorkflowRunner,
    result: WorkflowRunResult,
    contextState: Record<string, unknown> | null,
  ): Promise<void> {
    const state = runner.getState();
    const runState = {
      snapshot: result.snapshot,
      context: contextState,
      stepLog: this.buildStepLog(runner, run.stepLog),
      input: state?.input ?? run.input ?? {},
    };
    this.logger.debug('Persisting workflow result', {
      runId: run.id,
      status: result.status,
    });

    switch (result.status) {
      case 'suspended':
        this.logger.log('Workflow run suspended', {
          runId: run.id,
          waits: result.waits.map(({ waitId, reason }) => ({
            waitId,
            reason,
          })),
        });
        await this.workflowRunService.markSuspended(run.id, {
          ...runState,
          checkpoint: result.checkpoint,
          output: result.checkpoint.output,
        });
        break;
      case 'finished':
        this.logger.log('Workflow run finished', {
          runId: run.id,
        });
        await this.workflowRunService.markFinished(run.id, {
          ...runState,
          output: result.output,
        });
        break;
      case 'failed':
      default:
        this.logger.error('Workflow runner reported failure status', {
          runId: run.id,
          error: this.stringifyError(result.error),
        });
        await this.workflowRunService.markFailed(run.id, {
          ...runState,
          output: state?.output ?? run.output ?? null,
          error: this.stringifyError(result.error),
        });
        break;
    }
  }

  /**
   * Merge persisted step log entries with the latest runner log.
   */
  private buildStepLog(
    runner: WorkflowRunner,
    existing?: Record<string, StepExecutionRecord> | null,
  ): Record<string, StepExecutionRecord> | null {
    const merged = { ...(existing ?? {}), ...runner.getStepLog() };

    return Object.keys(merged).length > 0 ? merged : null;
  }

  /**
   * Persist a failing workflow run when runner execution throws.
   *
   * @param runner The runner that threw, if it was created at all.
   */
  private async markRunFailed(
    run: WorkflowRunFull,
    runner: WorkflowRunner | undefined,
    contextState: Record<string, unknown> | null,
    error: unknown,
  ): Promise<void> {
    const state = runner?.getState();

    this.logger.error(
      'Persisting failed workflow run after runner crash',
      error,
      {
        runId: run.id,
        workflowId: run.workflow?.id,
        triggeredById: run.triggeredBy?.id ?? null,
      },
    );
    await this.workflowRunService.markFailed(run.id, {
      ...(runner
        ? {
            snapshot: runner.getSnapshot(),
            stepLog: this.buildStepLog(runner, run.stepLog),
          }
        : {}),
      context: contextState,
      input: state?.input ?? run.input ?? {},
      output: state?.output ?? run.output ?? null,
      error: this.stringifyError(error),
    });
  }

  /**
   * Convert an unknown error into a readable string.
   */
  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return JSON.stringify(error) ?? 'Unknown error';
  }

  /**
   * Abort all active workflow runs linked to a thread when that thread is closed.
   */
  @OnEvent('hook:thread:postUpdate')
  async handleThreadClosed({
    entity,
    databaseEntity,
  }: {
    entity: { id: string; status: string };
    databaseEntity: { id: string; status: string };
  }): Promise<void> {
    if (entity.status === 'closed' && databaseEntity.status !== 'closed') {
      await this.workflowRunService.abortActiveRunsForThread(entity.id);
    }
  }
}

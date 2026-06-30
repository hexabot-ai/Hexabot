/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Workflow as AgenticWorkflow,
  ExecutionState,
  JsonataFunctionRegistry,
  StepExecutionRecord,
  WorkflowRunner,
} from '@hexabot-ai/agentic';
import { WorkflowFull, WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { I18nService } from '@/i18n/services/i18n.service';
import { LoggerService } from '@/logger/logger.service';

import { WorkflowContextFactory } from '../contexts/workflow-context-factory';
import type { WorkflowRuntimeContext } from '../contexts/workflow-runtime.context';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import { parseWorkflowDefinition } from '../lib/workflow-definition';
import type {
  CallWorkflowOptions,
  CallWorkflowResult,
  RunStrategy,
  RunWorkflowOptions,
  WorkflowCallService,
  WorkflowResult,
} from '../types';

import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

const MAX_CALL_STACK_DEPTH = 10;

type RunWorkflowExecution = {
  run: WorkflowRunFull;
  result: WorkflowResult;
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
  ) {}

  /**
   * Process an event by resuming a suspended workflow run if it exists,
   * otherwise start a new run using the latest configured workflow.
   */
  async handleEvent(
    event: TriggerEventWrapper,
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
          suspendedStep: suspendedRun.suspendedStep,
          suspensionReason: suspendedRun.suspensionReason,
        });

        const execution = await this.runWorkflow({
          mode: 'resume',
          run: suspendedRun,
          event,
        });

        return execution.run;
      }

      const workflowToRun = requestedWorkflowId
        ? await this.workflowService.findOneAndPopulate(requestedWorkflowId)
        : await this.workflowService.pickWorkflow();
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

      const execution = await this.runWorkflow({
        mode: 'start',
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

    const execution = await this.runWorkflow({
      mode: 'start',
      workflow,
      event: parentContext.event,
      parentRun,
      input,
    });

    return this.toCallWorkflowResult(execution.run, execution.result);
  }

  /**
   * Shared runner lifecycle for starts, external resumes, and internal parent
   * resumes. When a resumed child reaches a terminal state, this method also
   * unwinds the suspended parent with the child result payload.
   */
  private async runWorkflow(
    options: RunWorkflowOptions,
  ): Promise<RunWorkflowExecution> {
    const { event, mode } = options;
    const run =
      mode === 'start'
        ? await this.createRun(options.workflow, event, {
            parentRun: options.parentRun,
            input: options.input,
          })
        : options.run;
    const definition = this.resolveRunDefinition(run);
    if (!definition) {
      throw new Error('Workflow definition is required to run the workflow');
    }
    const workflowInstance = AgenticWorkflow.fromDefinition(definition, {
      actions: this.actionService.getRegistry(),
      bindingKinds: this.runtimeBindingsService.getRegistry(),
      jsonataFunctions: this.buildJsonataFunctions(event),
    });
    const context = await this.workflowContextFactory.create(
      run,
      event,
      definition,
    );

    this.logger.debug('Preparing workflow runner', {
      mode,
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id,
    });

    const strategy = await this.createRunStrategy(
      mode,
      run,
      context,
      workflowInstance,
      mode === 'resume' ? options.resumeData : undefined,
    );

    this.logger.debug('Marking workflow run as running', {
      mode,
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id,
      hasSnapshot: Boolean(strategy.markRunningInput.snapshot ?? run.snapshot),
      hasResumeData: Boolean(
        strategy.markRunningInput.lastResumeData ?? strategy.resumeData,
      ),
    });
    await this.workflowRunService.markRunning(run.id, {
      ...strategy.markRunningInput,
      context: context.state,
    });

    let result: WorkflowResult;
    try {
      this.logger.debug('Executing workflow runner', {
        mode,
        runId: run.id,
        workflowId: run.workflow?.id,
        triggeredById: run.triggeredBy?.id,
      });
      result = await strategy.execute();
    } catch (err) {
      this.logger.error('Workflow runner threw during execution', err);
      await this.markRunFailed(run, strategy.runner, context.state, err);
      if (mode === 'resume') {
        await this.resumeParentRunFromChild(
          run,
          {
            status: 'failed',
            error: err,
            snapshot: strategy.runner.getSnapshot(),
          },
          event,
        );
      }

      throw err;
    }

    this.logger.debug('Workflow runner completed', {
      mode,
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id,
      status: result.status,
    });
    await this.persistResult(
      run,
      strategy.runner,
      result,
      strategy.resumeData,
      context,
    );

    if (mode === 'resume') {
      await this.resumeParentRunFromChild(run, result, event);
    }

    const persistedRun = await this.workflowRunService.findOneAndPopulate(
      run.id,
    );

    return { run: persistedRun ?? run, result };
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
   * Build the execution strategy for starting a new workflow or resuming an existing one.
   *
   * `resumeData` is supplied only for internal child-to-parent unwinds; normal
   * event resumes use the current event input.
   */
  private async createRunStrategy(
    mode: 'start' | 'resume',
    run: WorkflowRunFull,
    context: WorkflowRuntimeContext,
    workflowInstance: AgenticWorkflow,
    resumeData?: unknown,
  ): Promise<RunStrategy> {
    if (mode === 'start') {
      const runner = await workflowInstance.buildAsyncRunner({
        runId: run.id,
      });

      return {
        runner,
        markRunningInput: {
          snapshot: run.snapshot ?? null,
        },
        execute: () =>
          runner.start({
            inputData: run.input ?? {},
            context,
          }),
      };
    }

    const latestInput = resumeData ?? context.event.buildInput();
    const runner = await workflowInstance.buildRunnerFromState({
      state: this.buildExecutionState(run),
      context,
      snapshot: run.snapshot ?? { status: run.status, actions: {} },
      suspension: run.suspendedStep
        ? {
            stepId: run.suspendedStep,
            reason: run.suspensionReason,
            data: run.suspensionData ?? undefined,
            stepExecId: run.suspensionStepExecId ?? undefined,
            suspendIndex: run.suspensionIndex ?? undefined,
            suspendKey: run.suspensionKey ?? undefined,
            awaitResults: run.suspensionAwaitResults ?? undefined,
          }
        : undefined,
      runId: run.id,
      lastResumeData: latestInput,
    });

    return {
      runner,
      resumeData: latestInput,
      markRunningInput: {
        lastResumeData: latestInput,
        snapshot: run.snapshot ?? null,
      },
      execute: () => runner.resume({ resumeData: latestInput }),
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
    result: WorkflowResult,
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

    return {
      status: 'failed',
      workflow_id: run.workflow.id,
      workflow_run_id: run.id,
      error: this.stringifyError(result.error),
    };
  }

  /**
   * Resume a suspended parent run after its child run completes or fails.
   *
   * This may cascade through multiple ancestors because resuming the parent can
   * itself finish a child call that belongs to another suspended parent.
   */
  private async resumeParentRunFromChild(
    childRun: WorkflowRunFull,
    result: WorkflowResult,
    event: TriggerEventWrapper,
  ): Promise<void> {
    if (result.status === 'suspended') {
      return;
    }

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

    await this.runWorkflow({
      mode: 'resume',
      run: parentRun,
      event,
      resumeData: this.toCallWorkflowResult(childRun, result),
    });
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
   * Resolve the workflow definition snapshot used by the current run.
   */
  private resolveRunDefinition(run: WorkflowRunFull) {
    const definitionYml = run.workflowVersion?.definitionYml;
    if (typeof definitionYml === 'string' && definitionYml.trim() !== '') {
      return parseWorkflowDefinition(definitionYml);
    }
  }

  /**
   * Persist workflow outcome and updated execution state.
   */
  private async persistResult(
    run: WorkflowRunFull,
    runner: WorkflowRunner,
    result: WorkflowResult,
    resumeData?: unknown,
    runtimeContext?: WorkflowRuntimeContext,
  ): Promise<void> {
    const contextState = runtimeContext?.state;
    const state = runner.getState();
    const metadata = this.buildMetadata(state, run.metadata);
    const output = this.pickOutput(result, state, run.output);
    const stepLog = this.buildStepLog(runner, run.stepLog);
    this.logger.debug('Persisting workflow result', {
      runId: run.id,
      status: result.status,
    });

    switch (result.status) {
      case 'suspended':
        this.logger.log('Workflow run suspended', {
          runId: run.id,
          stepId: result.step.id,
          reason: result.reason,
          stepExecId: result.stepExecId,
          suspendIndex: result.suspendIndex,
          suspendKey: result.suspendKey,
        });
        await this.workflowRunService.markSuspended(run.id, {
          stepId: result.step.id,
          reason: result.reason,
          data: result.data,
          stepExecId: result.stepExecId,
          suspendIndex: result.suspendIndex,
          suspendKey: result.suspendKey,
          awaitResults: result.awaitResults,
          snapshot: result.snapshot,
          context: contextState,
          lastResumeData: resumeData,
        });
        break;
      case 'finished':
        this.logger.log('Workflow run finished', {
          runId: run.id,
        });
        await this.workflowRunService.markFinished(run.id, {
          snapshot: result.snapshot,
          context: contextState,
          output: result.output ?? output,
        });
        break;
      case 'failed':
      default:
        this.logger.error('Workflow runner reported failure status', {
          runId: run.id,
          error: this.stringifyError(result.error),
        });
        await this.workflowRunService.markFailed(run.id, {
          snapshot: result.snapshot,
          context: contextState,
          error: this.stringifyError(result.error),
        });
        break;
    }

    await this.workflowRunService.updateOne(run.id, {
      input: state?.input ?? run.input ?? {},
      output,
      metadata,
      context: contextState,
      stepLog,
    });
  }

  /**
   * Build the ExecutionState used to rebuild a runner.
   */
  private buildExecutionState(run: WorkflowRunFull): ExecutionState {
    const state: ExecutionState = {
      input: run.input ?? {},
      output: run.output ?? {},
      iterationStack: [],
    };
    const storedState = (run.metadata as any)?.state;
    if (storedState) {
      if (storedState.iteration !== undefined) {
        state.iteration = storedState.iteration;
      }
      if (storedState.accumulator !== undefined) {
        state.accumulator = storedState.accumulator;
      }
      state.iterationStack = storedState.iterationStack ?? [];
    }

    return state;
  }

  /**
   * Build the metadata payload for persisting workflow run state.
   */
  private buildMetadata(
    state: ExecutionState | undefined,
    existing?: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    const next = { ...(existing ?? {}) };
    if (state) {
      next.state = {
        iteration: state.iteration,
        accumulator: state.accumulator,
        iterationStack: state.iterationStack,
      };
    }

    return Object.keys(next).length > 0 ? next : null;
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
   * Decide which output payload to persist based on result and runner state.
   */
  private pickOutput(
    result: WorkflowResult,
    state: ExecutionState | undefined,
    previousOutput?: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (result.status === 'finished' && result.output) {
      return result.output;
    }

    if (state?.output) {
      return state.output;
    }

    return previousOutput ?? null;
  }

  /**
   * Persist a failing workflow run when runner execution throws.
   */
  private async markRunFailed(
    run: WorkflowRunFull,
    runner: WorkflowRunner,
    contextState: Record<string, unknown> | null,
    error: unknown,
  ): Promise<void> {
    const state = runner.getState();
    const metadata = this.buildMetadata(state, run.metadata);
    const stepLog = this.buildStepLog(runner, run.stepLog);

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
      snapshot: runner.getSnapshot(),
      context: contextState,
      error: this.stringifyError(error),
    });

    await this.workflowRunService.updateOne(run.id, {
      input: state?.input ?? run.input ?? {},
      output: state?.output ?? run.output ?? null,
      metadata,
      context: contextState,
      stepLog,
    });
  }

  /**
   * Convert an unknown error into a readable string.
   */
  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : JSON.stringify(error);
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

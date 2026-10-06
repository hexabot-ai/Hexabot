/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  assertFrameMatchesStep,
  CHECKPOINT_VERSION,
  collectWaits,
  selectWait,
  validateCheckpoint,
  type ConditionalFrame,
  type LoopFrame,
  type ParallelFrame,
  type SequenceFrame,
  type StepFrame,
  type TaskFrame,
  type WaitInfo,
  type WorkflowCheckpoint,
} from './checkpoint';
import {
  EWorkflowRunStatus,
  type ActionSnapshot,
  type ActionStatus,
  type BaseWorkflowContext,
  type StepExecutionRecord,
  type WorkflowRunStatus,
  type WorkflowSnapshot,
} from './context';
import { throwIfAborted } from './errors';
import { checkResumePayload } from './resume-payload';
import { RunnerRuntimeControl } from './runner-runtime-control';
import { executeConditional as runConditionalExecutor } from './step-executors/conditional-executor';
import { executeLoop as runLoopExecutor } from './step-executors/loop-executor';
import { executeParallel as runParallelExecutor } from './step-executors/parallel-executor';
import { executeTaskStep as runTaskExecutor } from './step-executors/task-executor';
import type {
  StepExecutorEnv,
  StepExecutorEnvForkOverrides,
} from './step-executors/types';
import { cloneAsJson } from './utils/clone';
import {
  StepType,
  type StepInfo,
  type WorkflowEventMap,
} from './workflow-event-emitter';
import { fingerprintWorkflow } from './workflow-fingerprint';
import type {
  CompiledStep,
  CompiledTask,
  CompiledWorkflow,
  ExecutionState,
  ResumeRejection,
  RunnerResumeArgs,
  RunnerStartArgs,
  SuspendedResult,
  WorkflowRunOptions,
  WorkflowRunResult,
} from './workflow-types';
import { evaluateMapping } from './workflow-values';

/** One start or resume pass over the flow. */
type ExecutionPass = {
  /** Resume payloads for the waits this pass satisfies, by wait id. */
  resolutions: ReadonlyMap<string, unknown>;
  /** Set when the resumed step refused its payload. */
  rejection?: ResumeRejection;
};

/** What the runner reports about a run, put back when a resume is refused. */
type RunReport = {
  state?: ExecutionState;
  snapshots: Record<string, ActionSnapshot>;
  stepLog: Record<string, StepExecutionRecord>;
};

/** The suspended run a resume pass starts from. */
type ResumedRun = {
  checkpoint: WorkflowCheckpoint;
  /** The report before the pass, restored if the payload is refused. */
  report: RunReport;
};

/**
 * Executes a compiled workflow definition, tracking state, suspensions, and event hooks.
 * Create a new instance per execution to avoid leaking state between runs.
 */
export class WorkflowRunner {
  // Compiled workflow definition driving this runner.
  private readonly compiled: CompiledWorkflow;

  // External run identifier propagated through events for correlation.
  private readonly runId?: string;

  // Current lifecycle status of the workflow execution.
  private status: WorkflowRunStatus = EWorkflowRunStatus.IDLE;

  // Snapshots of action execution keyed by step id for inspection/resume.
  private snapshots: Record<string, ActionSnapshot> = {};

  // Detailed execution records for each task step, used by UI/telemetry.
  private stepLog: Record<string, StepExecutionRecord> = {};

  // Checkpoint of the run while it is suspended awaiting external input.
  private checkpoint?: WorkflowCheckpoint;

  // Control surface exposed to actions to suspend/resume the workflow.
  private runtimeControl?: RunnerRuntimeControl;

  // Mutable execution state including input and outputs.
  private state?: ExecutionState;

  // Workflow context shared with actions for IO and side-effects.
  private context?: BaseWorkflowContext;

  /**
   * Create a new runner for a compiled workflow definition.
   *
   * @param compiled The compiled workflow to execute.
   * @param options Optional runner configuration such as run id.
   */
  constructor(compiled: CompiledWorkflow, options?: WorkflowRunOptions) {
    this.compiled = compiled;
    this.runId = options?.runId;
  }

  /**
   * Get the current state of the workflow run.
   *
   * @returns The state of the workflow execution.
   */
  getState(): ExecutionState | undefined {
    return this.state;
  }

  /**
   * Get the current lifecycle status of the workflow run.
   *
   * @returns The status of the workflow execution.
   */
  getStatus(): WorkflowRunStatus {
    return this.status;
  }

  /**
   * Snapshot the current workflow status and action states.
   *
   * @returns A snapshot representing the workflow and each action's status.
   */
  getSnapshot(): WorkflowSnapshot {
    return {
      status: this.status,
      actions: { ...this.snapshots },
    };
  }

  /**
   * Read the per-step execution records captured for UI/telemetry.
   *
   * @returns A shallow copy of the step execution log.
   */
  getStepLog(): Record<string, StepExecutionRecord> {
    return Object.fromEntries(
      Object.entries(this.stepLog).map(([id, record]) => [
        id,
        {
          ...record,
          context: record.context ? { ...record.context } : undefined,
          error: record.error ? { ...record.error } : undefined,
        },
      ]),
    );
  }

  /**
   * Read the checkpoint of a suspended run: everything a host must persist to
   * resume it later, in this process or another one. Treat it as read-only.
   *
   * @returns The checkpoint while the run is suspended, otherwise undefined.
   */
  getCheckpoint(): WorkflowCheckpoint | undefined {
    return this.checkpoint;
  }

  /**
   * Begin executing the workflow from the first step.
   * Returns a status object describing whether execution finished, suspended, or failed.
   *
   * @param args Input payload and context to seed execution.
   * @returns Execution result including status and snapshot.
   */
  async start(args: RunnerStartArgs): Promise<WorkflowRunResult> {
    this.status = EWorkflowRunStatus.RUNNING;
    this.snapshots = {};
    this.stepLog = {};
    this.checkpoint = undefined;
    this.context = args.context;
    this.state = {
      input: this.compiled.inputParser.parse(args.inputData ?? {}),
      output: {},
      iterationStack: [],
    };

    this.runtimeControl = new RunnerRuntimeControl();
    this.context.attachWorkflowRuntime(this.runtimeControl);

    this.emit('hook:workflow:start', { runId: this.runId });

    return this.runExecution(new Map());
  }

  /**
   * Resume a suspended workflow by satisfying one of its open waits.
   *
   * Execution re-enters the checkpoint's frames: completed work is skipped,
   * the resolved step re-runs its action body, and waits left untouched stay
   * parked.
   *
   * A payload the wait does not accept is refused, first against the wait's
   * `accepts` JSON Schema without running anything, then by the action body.
   * Either way the result is suspended on the same waits and carries
   * `rejection`, and the checkpoint, snapshot and step log are left as they
   * were. Events a refusing body emitted are not withdrawn, and its side
   * effects, including writes to context state, are not undone.
   *
   * @param args Resume payload and, when several waits are open, the wait it satisfies.
   * @returns Execution result including status and snapshot.
   * @throws {WorkflowWaitNotFoundError} When `waitId` is not an open wait.
   * @throws {WorkflowWaitAmbiguousError} When several waits are open and no
   * `waitId` is given.
   */
  async resume(args: RunnerResumeArgs): Promise<WorkflowRunResult> {
    if (this.status !== EWorkflowRunStatus.SUSPENDED || !this.checkpoint) {
      throw new Error('Cannot resume a workflow that is not suspended.');
    }

    if (!this.context) {
      throw new Error('Workflow state is not initialized.');
    }

    const wait = selectWait(this.checkpoint.waits, args.waitId);
    const payload = checkResumePayload(wait, args.resumeData);
    const result = payload.ok
      ? await this.resolveWait(wait, payload.value)
      : this.keepWaiting(this.checkpoint, {
          waitId: wait.waitId,
          error: payload.error,
        });
    if (result.status === EWorkflowRunStatus.SUSPENDED && result.rejection) {
      this.emit('hook:workflow:resume_rejected', {
        runId: this.runId,
        wait,
        resumeData: args.resumeData,
        error: result.rejection.error,
      });
    }

    return result;
  }

  /**
   * Run the pass that resolves one wait with an accepted payload.
   *
   * @param wait The wait being resolved.
   * @param recorded The payload as the checkpoint records it.
   * @returns Execution result including status and snapshot.
   */
  private async resolveWait(
    wait: WaitInfo,
    recorded: unknown,
  ): Promise<WorkflowRunResult> {
    const checkpoint = this.checkpoint;
    if (!checkpoint) {
      throw new Error('Cannot resume a workflow that is not suspended.');
    }

    const report: RunReport = {
      state: this.state,
      snapshots: { ...this.snapshots },
      stepLog: { ...this.stepLog },
    };
    this.status = EWorkflowRunStatus.RUNNING;
    this.context?.attachWorkflowRuntime(this.runtimeControl);

    return this.runExecution(new Map([[wait.waitId, recorded]]), {
      checkpoint,
      report,
    });
  }

  /**
   * Run the flow from the top, or from a checkpoint, and normalize
   * suspension, finish, and failure handling.
   *
   * @param resolutions Resume payloads for the waits this pass satisfies.
   * @param resumed Suspended run to resume from; omitted on start.
   * @returns Result of the execution attempt.
   */
  private async runExecution(
    resolutions: ReadonlyMap<string, unknown>,
    resumed?: ResumedRun,
  ): Promise<WorkflowRunResult> {
    const pass: ExecutionPass = { resolutions };

    try {
      // In-process and durable resumes start from the same detached JSON
      // copy, so both see exactly what a host would have persisted.
      const from = resumed ? cloneAsJson(resumed.checkpoint) : undefined;
      if (from) {
        this.state = {
          input: from.input,
          output: from.output,
          iterationStack: [],
        };
      }

      const state = this.state;
      if (!state) {
        throw new Error('Workflow state not initialized.');
      }

      const root = await this.executeFlow(
        this.compiled.flow,
        state,
        [],
        from?.root,
        this.createExecutorEnv(pass),
      );

      // Only the refusing step ran in this pass, and it did not complete, so
      // the run is put back as the checkpoint it started from describes it.
      if (pass.rejection && resumed) {
        this.state = resumed.report.state;
        this.snapshots = resumed.report.snapshots;
        this.stepLog = resumed.report.stepLog;

        return this.keepWaiting(resumed.checkpoint, pass.rejection);
      }

      if (root) {
        const next = this.buildCheckpoint(state, root);

        this.checkpoint = next;
        this.status = EWorkflowRunStatus.SUSPENDED;
        this.emit('hook:workflow:suspended', {
          runId: this.runId,
          waits: next.waits,
        });

        return {
          status: EWorkflowRunStatus.SUSPENDED,
          waits: next.waits,
          checkpoint: next,
          snapshot: this.getSnapshot(),
        };
      }

      const output = await this.evaluateWorkflowOutputs();
      this.status = EWorkflowRunStatus.FINISHED;
      this.checkpoint = undefined;
      this.emit('hook:workflow:finish', { runId: this.runId, output });
      if (!this.context) {
        throw new Error('Workflow context is not attached.');
      }
      this.context.attachWorkflowRuntime(undefined);

      return {
        status: EWorkflowRunStatus.FINISHED,
        output,
        snapshot: this.getSnapshot(),
      };
    } catch (error) {
      this.status = EWorkflowRunStatus.FAILED;
      this.checkpoint = undefined;
      this.emit('hook:workflow:failure', { runId: this.runId, error });
      this.context?.attachWorkflowRuntime(undefined);

      return {
        status: EWorkflowRunStatus.FAILED,
        error,
        snapshot: this.getSnapshot(),
      };
    }
  }

  /**
   * Leave the run suspended on `checkpoint` after a resume payload was
   * refused.
   *
   * @param checkpoint The checkpoint the run was suspended on.
   * @param rejection The refused wait and why.
   * @returns The suspended result, carrying the rejection.
   */
  private keepWaiting(
    checkpoint: WorkflowCheckpoint,
    rejection: ResumeRejection,
  ): SuspendedResult {
    this.checkpoint = checkpoint;
    this.status = EWorkflowRunStatus.SUSPENDED;

    return {
      status: EWorkflowRunStatus.SUSPENDED,
      waits: checkpoint.waits,
      checkpoint,
      snapshot: this.getSnapshot(),
      rejection,
    };
  }

  /**
   * Snapshot the suspended run as a detached JSON checkpoint.
   *
   * The checkpoint goes through the same JSON round trip a host applies when
   * persisting it, so a resumed run sees the same values in process and
   * after a restore.
   *
   * @param state Root execution state at suspension time.
   * @param root Frame returned by the top-level flow.
   * @returns The checkpoint to hand to the host.
   * @throws When the run's state cannot be encoded as JSON.
   */
  private buildCheckpoint(
    state: ExecutionState,
    root: SequenceFrame,
  ): WorkflowCheckpoint {
    try {
      return cloneAsJson({
        version: CHECKPOINT_VERSION,
        fingerprint: fingerprintWorkflow(this.compiled),
        input: state.input,
        output: state.output,
        root,
        waits: collectWaits(root),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new Error(
        `Cannot checkpoint the suspended run: its state is not JSON-serializable (${reason}).`,
      );
    }
  }

  /**
   * Restore a suspended run from its persisted checkpoint, typically in a
   * different process than the one that suspended it.
   *
   * @param compiled The compiled workflow definition.
   * @param options.checkpoint Checkpoint returned when the run suspended.
   * @param options.context Freshly hydrated workflow context.
   * @param options.snapshot Persisted action snapshot, to keep reporting past steps.
   * @param options.runId Run identifier propagated through events.
   * @returns A suspended runner ready for {@link resume}.
   * @throws {WorkflowResumeError} When the checkpoint cannot resume against `compiled`.
   */
  static fromCheckpoint(
    compiled: CompiledWorkflow,
    options: {
      checkpoint: unknown;
      context: BaseWorkflowContext;
      snapshot?: WorkflowSnapshot;
      runId?: string;
    },
  ): WorkflowRunner {
    const validation = validateCheckpoint(compiled, options.checkpoint);
    if (!validation.ok) {
      throw validation.error;
    }

    const checkpoint = validation.checkpoint;
    const runner = new WorkflowRunner(compiled, {
      runId: options.runId,
    });

    runner.checkpoint = checkpoint;
    runner.state = {
      input: checkpoint.input,
      output: checkpoint.output,
      iterationStack: [],
    };
    runner.context = options.context;
    runner.snapshots = { ...(options.snapshot?.actions ?? {}) };
    runner.status = EWorkflowRunStatus.SUSPENDED;
    runner.runtimeControl = new RunnerRuntimeControl();
    options.context.attachWorkflowRuntime(runner.runtimeControl);

    return runner;
  }

  /**
   * Emit an event if an emitter is provided.
   *
   * @param event The event name to emit.
   * @param payload The event payload.
   */
  private emit<K extends keyof WorkflowEventMap>(
    event: K,
    payload: WorkflowEventMap[K],
  ) {
    this.context?.eventEmitter?.emit(event, payload);
  }

  /**
   * Evaluate and map the workflow outputs after all steps have completed.
   * Throws if the internal state or context were not initialized.
   *
   * @returns The evaluated workflow outputs.
   * @throws When state or context are missing.
   */
  private async evaluateWorkflowOutputs(): Promise<Record<string, unknown>> {
    if (!this.state || !this.context) {
      throw new Error('Workflow state not initialized.');
    }

    return evaluateMapping(this.compiled.outputMapping, {
      input: this.state.input,
      context: this.context.state,
      output: this.state.output,
    });
  }

  /**
   * Build a stable step id that reflects the current loop iteration stack.
   *
   * @param step The compiled step to annotate.
   * @param iterationStack The loop stack representing nested iterations.
   * @returns A step info object with an iteration-aware id.
   */
  private buildInstanceStepInfo(
    step: CompiledStep,
    iterationStack: number[],
  ): StepInfo {
    const suffix =
      iterationStack.length > 0 ? `[${iterationStack.join('.')}]` : '';

    return {
      id: `${step.id}${suffix}`,
      name: step.label,
      type: step.type,
    };
  }

  /**
   * Record an action snapshot for the given step id.
   *
   * @param step The step being updated.
   * @param status The new snapshot status.
   * @param reason Optional reason to include when marking failure/suspension.
   */
  private markSnapshot(step: StepInfo, status: ActionStatus, reason?: string) {
    this.snapshots[step.id] = {
      id: step.id,
      name: step.name,
      status,
      reason,
    };
  }

  /**
   * Record a detailed execution entry for the given step.
   *
   * @param step The step being updated.
   * @param update Partial record fields to merge into the log.
   */
  private recordStepExecution(
    step: StepInfo,
    update: Partial<StepExecutionRecord>,
  ): StepExecutionRecord {
    const existing = this.stepLog[step.id];
    const base: StepExecutionRecord =
      existing ??
      ({
        id: step.id,
        name: step.name,
        status: 'pending',
      } satisfies StepExecutionRecord);
    const mergedContext =
      existing?.context || update.context
        ? { ...existing?.context, ...update.context }
        : undefined;
    const nextRecord: StepExecutionRecord = {
      ...base,
      ...update,
      id: step.id,
      name: step.name,
      status: update.status ?? base.status,
      context: mergedContext,
    };

    this.stepLog[step.id] = nextRecord;

    return {
      ...nextRecord,
      context: nextRecord.context ? { ...nextRecord.context } : undefined,
      error: nextRecord.error ? { ...nextRecord.error } : undefined,
    };
  }

  /**
   * Construct the environment object passed to step executors.
   *
   * @param pass The execution pass, shared by every scope it forks.
   * @param overrides Scope-specific replacements, e.g. for a parallel branch.
   * @returns A step executor environment bound to this runner.
   * @throws When the workflow context or runtime control is missing.
   */
  private createExecutorEnv(
    pass: ExecutionPass,
    overrides: StepExecutorEnvForkOverrides = {},
  ): StepExecutorEnv {
    const context = overrides.context ?? this.context;
    if (!context) {
      throw new Error('Workflow context is not attached.');
    }

    const runtime = overrides.runtime ?? this.runtimeControl;
    if (!runtime) {
      throw new Error('Workflow runtime control is not initialized.');
    }

    const signal = overrides.signal ?? new AbortController().signal;
    const executorEnv: StepExecutorEnv = {
      compiled: this.compiled,
      context,
      signal,
      runId: this.runId,
      runtime,
      resolutions: pass.resolutions,
      rejectResume: (rejection) => {
        pass.rejection = rejection;
      },
      buildInstanceStepInfo: (step, iterationStack) =>
        this.buildInstanceStepInfo(step, iterationStack),
      markSnapshot: (step, status, reason) =>
        this.markSnapshot(step, status, reason),
      recordStepExecution: (step, update) =>
        this.recordStepExecution(step, update),
      emit: (event, payload) => this.emit(event, payload),
      captureTaskOutput: (task, state, result) =>
        this.captureTaskOutput(task, state, result),
      executeFlow: (steps, state, path, frame) =>
        this.executeFlow(steps, state, path, frame, executorEnv),
      executeStep: (step, state, path, frame) =>
        this.executeStep(step, state, path, frame, executorEnv),
      fork: (forkOverrides) =>
        this.createExecutorEnv(pass, {
          context: forkOverrides.context ?? context,
          signal: forkOverrides.signal ?? signal,
          runtime: forkOverrides.runtime ?? runtime,
        }),
    };

    return executorEnv;
  }

  /**
   * Walk a list of compiled steps, threading state and returning a frame when
   * one of them suspends.
   *
   * @param steps The steps to execute sequentially.
   * @param state Mutable execution state shared across steps.
   * @param path Path tokens leading to the current step for tracing.
   * @param frame Frame of a previous suspension within these steps.
   * @param env Executor environment of the current scope.
   * @returns A frame if execution pauses, otherwise void.
   */
  private async executeFlow(
    steps: CompiledStep[],
    state: ExecutionState,
    path: Array<number | string>,
    frame: SequenceFrame | undefined,
    env: StepExecutorEnv,
  ): Promise<SequenceFrame | void> {
    if (frame) {
      state.accumulator = frame.accumulator;
    }

    for (let index = frame?.index ?? 0; index < steps.length; index += 1) {
      throwIfAborted(env.signal);

      const child = await this.executeStep(
        steps[index],
        state,
        [...path, index],
        frame && index === frame.index ? frame.child : undefined,
        env,
      );

      if (child) {
        return {
          kind: 'sequence',
          index,
          accumulator: state.accumulator,
          child,
        };
      }
    }

    return undefined;
  }

  /**
   * Execute a single compiled step by delegating to its executor.
   *
   * @param step The step to run.
   * @param state The shared execution state.
   * @param path Tokens describing the location of the step in the workflow.
   * @param frame Frame of a previous suspension of this step.
   * @param env Executor environment of the current scope.
   * @returns A frame if the step pauses execution, otherwise void.
   */
  private async executeStep(
    step: CompiledStep,
    state: ExecutionState,
    path: Array<number | string>,
    frame: StepFrame | undefined,
    env: StepExecutorEnv,
  ): Promise<StepFrame | void> {
    throwIfAborted(env.signal);
    assertFrameMatchesStep(frame, step, path);

    switch (step.type) {
      case StepType.Task:
        return runTaskExecutor(env, step, state, path, frame as TaskFrame);
      case StepType.Parallel:
        return runParallelExecutor(
          env,
          step,
          state,
          path,
          frame as ParallelFrame,
        );
      case StepType.Conditional:
        return runConditionalExecutor(
          env,
          step,
          state,
          path,
          frame as ConditionalFrame,
        );
      case StepType.Loop:
        return runLoopExecutor(env, step, state, path, frame as LoopFrame);
    }
  }

  /**
   * Store the raw task result under the task name in the workflow output state.
   *
   * @param task The task whose output is being captured.
   * @param state Current execution state to mutate.
   * @param result Raw result returned by the task action.
   */
  private async captureTaskOutput(
    task: CompiledTask,
    state: ExecutionState,
    result: unknown,
  ) {
    state.output[task.name] = result;
  }
}

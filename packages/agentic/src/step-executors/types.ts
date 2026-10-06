/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { SequenceFrame, StepFrame } from '../checkpoint';
import type {
  ActionSnapshot,
  BaseWorkflowContext,
  StepExecutionRecord,
} from '../context';
import type { RunnerRuntimeControl } from '../runner-runtime-control';
import type { StepInfo, WorkflowEventMap } from '../workflow-event-emitter';
import type {
  CompiledStep,
  CompiledTask,
  CompiledWorkflow,
  ExecutionState,
  ResumeRejection,
} from '../workflow-types';

export type StepExecutorEnvForkOverrides = {
  context?: BaseWorkflowContext;
  signal?: AbortSignal;
  runtime?: RunnerRuntimeControl;
};

/**
 * Everything a step executor needs from the runner.
 *
 * Executors return a frame when the step suspends and `undefined` when it
 * completes. Passing that frame back in resumes the step where it stopped.
 */
export type StepExecutorEnv = {
  compiled: CompiledWorkflow;
  context: BaseWorkflowContext;
  signal: AbortSignal;
  runId?: string;
  /** Suspension control of the concurrency scope this env runs in. */
  runtime: RunnerRuntimeControl;
  /** Resume payloads for the waits this execution pass satisfies, by wait id. */
  resolutions: ReadonlyMap<string, unknown>;
  /**
   * Report that a resumed step refused its payload. The runner then leaves
   * the run exactly as it was before this pass.
   */
  rejectResume: (rejection: ResumeRejection) => void;
  buildInstanceStepInfo: (
    step: CompiledStep,
    iterationStack: number[],
  ) => StepInfo;
  markSnapshot: (
    step: StepInfo,
    status: ActionSnapshot['status'],
    reason?: string,
  ) => void;
  recordStepExecution: (
    step: StepInfo,
    update: Partial<StepExecutionRecord>,
  ) => StepExecutionRecord;
  emit: <K extends keyof WorkflowEventMap>(
    event: K,
    payload: WorkflowEventMap[K],
  ) => void;
  captureTaskOutput: (
    task: CompiledTask,
    state: ExecutionState,
    result: unknown,
  ) => Promise<void>;
  executeFlow: (
    steps: CompiledStep[],
    state: ExecutionState,
    path: Array<number | string>,
    frame?: SequenceFrame,
  ) => Promise<SequenceFrame | void>;
  executeStep: (
    step: CompiledStep,
    state: ExecutionState,
    path: Array<number | string>,
    frame?: StepFrame,
  ) => Promise<StepFrame | void>;
  fork: (overrides: StepExecutorEnvForkOverrides) => StepExecutorEnv;
};

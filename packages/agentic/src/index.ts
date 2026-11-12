/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

export { AbstractAction } from './action/abstract-action';

export { defineAction } from './action/action';

export type { DefineActionParams } from './action/action';

export type {
  Action,
  ActionExecutionArgs,
  ActionMetadata,
  Actions,
  InferActionArgs,
  InferActionBindings,
  InferActionContext,
  InferActionInput,
  InferActionOutput,
  InferActionSettings,
} from './action/action.types';

export {
  BaseWorkflowContext,
  EWorkflowRunStatus,
  WORKFLOW_RUN_STATUSES,
  type ActionSnapshot,
  type ActionStatus,
  type StepExecutionRecord,
  type SuspensionOptions,
  type WorkflowRunStatus,
  type WorkflowRuntimeControl,
  type WorkflowSnapshot,
} from './context';

export * from './dsl.types';

export {
  issueMessages,
  type WorkflowValidationIssue,
  type WorkflowValidationIssueCode,
} from './validation-issue';

export type {
  BindingKindDescriptor,
  BindingKindSchemas,
  InferMountedBindingValue,
  InferWorkflowBindings,
} from './bindings/base-binding';

export {
  buildWorkflowInputParser,
  compileWorkflow,
  Workflow,
  WorkflowEventEmitter,
  WorkflowRunner,
  type FlowStepPath,
  type WorkflowCompileOptions,
  type WorkflowRunOptions,
  type WorkflowRunResult,
} from './workflow';

export { StepType } from './workflow-event-emitter';

export type {
  StepInfo,
  WorkflowEventEmitterLike,
  WorkflowEventMap,
} from './workflow-event-emitter';

export type {
  BaseStep as CompiledBaseStep,
  ConditionalBranch as CompiledConditionalBranch,
  ConditionalStep as CompiledConditionalStep,
  LoopStep as CompiledLoopStep,
  CompiledMapping,
  ParallelStep as CompiledParallelStep,
  CompiledStep,
  CompiledTask,
  CompiledTaskBindings,
  TaskStep as CompiledTaskStep,
  CompiledValue,
  CompiledWorkflow,
  EvaluationScope,
  ExecutionState,
  ResumeRejection,
  RunnerResumeArgs,
  RunnerStartArgs,
  SuspendedResult,
} from './workflow-types';

export {
  CHECKPOINT_VERSION,
  collectWaits,
  validateCheckpoint,
  workflowCheckpointSchema,
  type CheckpointValidationResult,
  type ConditionalFrame,
  type LoopFrame,
  type ParallelBranchFrame,
  type ParallelFrame,
  type RecordedResult,
  type SequenceFrame,
  type StepFrame,
  type TaskFrame,
  type WaitInfo,
  type WorkflowCheckpoint,
} from './checkpoint';

export { fingerprintWorkflow } from './workflow-fingerprint';

export {
  NonDeterministicWorkflowError,
  WorkflowCancellationError,
  WorkflowCheckpointInvalidError,
  WorkflowDefinitionDriftError,
  WorkflowInputRejectedError,
  WorkflowResumeError,
  WorkflowResumeRejectedError,
  WorkflowWaitAmbiguousError,
  WorkflowWaitNotFoundError,
  type WorkflowCheckpointInvalidCode,
} from './errors';

export {
  compileValue,
  evaluateMapping,
  evaluateValue,
  mergeSettings,
  type CompileValueOptions,
  type JsonataFunctionConfig,
  type JsonataFunctionImplementation,
  type JsonataFunctionRegistry,
} from './workflow-values';

export {
  assertSnakeCaseName,
  isSnakeCaseName,
  toSnakeCase,
} from './utils/naming';

export { sleep, withTimeout } from './utils/timeout';

export {
  collectWorkflowDefinitionResourceRefs,
  remapWorkflowDefinitionResourceRefs,
  type WorkflowDefinitionResourceDescriptor,
  type WorkflowDefinitionResourceIdMaps,
  type WorkflowDefinitionResourceRefs,
} from './utils/workflow-definition-resources';

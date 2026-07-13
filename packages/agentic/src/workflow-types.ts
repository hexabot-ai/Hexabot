/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Expression, Focus } from 'jsonata';
import type { ZodType } from 'zod';

import type { Action } from './action/action.types';
import type { CompiledTaskBindings } from './bindings/base-binding';
import type { BaseWorkflowContext, WorkflowSnapshot } from './context';
import type { Settings, TaskDefinition, WorkflowDefinition } from './dsl.types';
import { StepType, type StepInfo } from './workflow-event-emitter';

export type { CompiledTaskBindings } from './bindings/base-binding';

/** Custom function callable from JSONata expressions. */
export type JsonataFunctionImplementation = (
  this: Focus,
  ...args: any[]
) => unknown;

/** Function implementation, optionally paired with a JSONata type signature. */
export type JsonataFunctionConfig =
  | JsonataFunctionImplementation
  | {
      implementation: JsonataFunctionImplementation;
      signature?: string;
    };

/** Map of function names to implementations, registered on compiled expressions. */
export type JsonataFunctionRegistry = Record<string, JsonataFunctionConfig>;

/**
 * Value representation used by the runtime after compilation.
 * The function registry is kept so nested `=` expressions discovered at
 * evaluation time can be compiled with the same custom functions.
 */
export type CompiledValue =
  | {
      kind: 'literal';
      value: unknown;
      jsonataFunctions?: JsonataFunctionRegistry;
    }
  | {
      kind: 'expression';
      source: string;
      expression: Expression;
      jsonataFunctions?: JsonataFunctionRegistry;
    };

/** Map of variable names to compiled values. */
export type CompiledMapping = Record<string, CompiledValue>;

/** Fully resolved task with parsed settings and compiled IO mappings. */
export type CompiledTask = {
  name: string;
  definition: TaskDefinition;
  actionName: string;
  action: Action;
  inputs: CompiledMapping;
  settings: Settings;
  bindings: CompiledTaskBindings;
};

/** Complete workflow ready for execution. */
export type CompiledWorkflow = {
  definition: WorkflowDefinition;
  tasks: Record<string, CompiledTask>;
  flow: CompiledStep[];
  outputMapping: CompiledMapping;
  inputParser: ZodType<Record<string, unknown>>;
  defaultSettings?: Settings;
};

/** Any executable step inside the compiled flow. */
export type CompiledStep = TaskStep | ParallelStep | ConditionalStep | LoopStep;

export type BaseStep = {
  id: string;
  label: string;
  type: StepType;
};

/** Single task execution. */
export type TaskStep = BaseStep & {
  type: StepType.Task;
  taskName: string;
};

/** Runs nested steps with either wait-all or wait-any semantics. */
export type ParallelStep = BaseStep & {
  type: StepType.Parallel;
  description?: string;
  strategy: 'wait_all' | 'wait_any';
  steps: CompiledStep[];
};

/** Conditional branch tree describing when to run a step list. */
export type ConditionalBranch = {
  id: string;
  condition?: CompiledValue;
  steps: CompiledStep[];
};

/** Conditional step with multiple branches. */
export type ConditionalStep = BaseStep & {
  type: StepType.Conditional;
  description?: string;
  branches: ConditionalBranch[];
};

type BaseLoopStep = BaseStep & {
  type: StepType.Loop;
  name?: string;
  description?: string;
  accumulate?: { as: string; initial: unknown; merge: CompiledValue };
  steps: CompiledStep[];
};

/** Loop over items with optional post-iteration break condition. */
export type ForEachLoopStep = BaseLoopStep & {
  loopType: 'for_each';
  forEach: { item: string; in: CompiledValue };
  maxConcurrency?: number;
  until?: CompiledValue;
};

/** Classic while-loop evaluated before each iteration. */
export type WhileLoopStep = BaseLoopStep & {
  loopType: 'while';
  while: CompiledValue;
};

export type LoopStep = ForEachLoopStep | WhileLoopStep;

/** Scope passed to value evaluators, reflecting the live runtime state. */
export type EvaluationScope = {
  input: Record<string, unknown>;
  context: Record<string, unknown>;
  output: Record<string, unknown>;
  iteration?: { item: unknown; index: number };
  accumulator?: unknown;
  result?: unknown;
};

/** Minimal mutable state for the executor. */
export type ExecutionState = {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  iteration?: { item: unknown; index: number };
  accumulator?: unknown;
  iterationStack: number[];
};

/** Encapsulates a suspended step and how to continue it. */
export type Suspension = {
  step: StepInfo;
  reason?: string;
  data?: unknown;
  stepExecId?: string;
  suspendIndex?: number;
  suspendKey?: string;
  awaitResults?: Record<string, unknown>;
  continue: (resumeData: unknown) => Promise<Suspension | void>;
};

export type PersistedSuspension = {
  stepId: string;
  reason?: string | null;
  data?: unknown;
  stepExecId?: string;
  suspendIndex?: number;
  suspendKey?: string;
  awaitResults?: Record<string, unknown>;
};

/** Result of starting a workflow run. */
export type StartResult =
  | {
      status: 'finished';
      output: Record<string, unknown>;
      snapshot: WorkflowSnapshot;
    }
  | {
      status: 'suspended';
      step: StepInfo;
      reason?: string;
      data?: unknown;
      stepExecId?: string;
      suspendIndex?: number;
      suspendKey?: string;
      awaitResults?: Record<string, unknown>;
      snapshot: WorkflowSnapshot;
    }
  | { status: 'failed'; error: unknown; snapshot: WorkflowSnapshot };

/** Result of resuming a suspended workflow. */
export type ResumeResult =
  | {
      status: 'finished';
      output: Record<string, unknown>;
      snapshot: WorkflowSnapshot;
    }
  | {
      status: 'suspended';
      step: StepInfo;
      reason?: string;
      data?: unknown;
      stepExecId?: string;
      suspendIndex?: number;
      suspendKey?: string;
      awaitResults?: Record<string, unknown>;
      snapshot: WorkflowSnapshot;
    }
  | { status: 'failed'; error: unknown; snapshot: WorkflowSnapshot };

/** Options that influence how the workflow runner behaves. */
export type WorkflowRunOptions = {
  runId?: string;
};

export type WorkflowStartResult = StartResult;

export type WorkflowResumeResult = ResumeResult;

/** Arguments required to start a run. */
export type RunnerStartArgs = {
  inputData: unknown;
  context: BaseWorkflowContext;
};

/** Payload passed when resuming a suspended run. */
export type RunnerResumeArgs = {
  resumeData?: unknown;
};

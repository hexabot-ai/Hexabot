/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { BaseWorkflowContext, WorkflowRuntimeControl } from '../context';
import {
  getAbortReason,
  ParallelSuspensionError,
  throwIfAborted,
  WorkflowCancellationError,
} from '../errors';
import type {
  CompiledStep,
  ExecutionState,
  ParallelStep,
  Suspension,
} from '../workflow-types';

import { markStepsCancelled } from './skip-helpers';
import type { StepExecutorEnv } from './types';

type BranchResult =
  | { status: 'fulfilled'; index: number; outputDelta: Record<string, unknown> }
  | { status: 'failed'; index: number; error: unknown }
  | { status: 'cancelled'; index: number; error: Error };

type BranchHandle = {
  index: number;
  step: CompiledStep;
  iterationStack: number[];
  controller: AbortController;
  promise: Promise<BranchResult>;
};

type TrackedOutput = {
  output: Record<string, unknown>;
  getDelta: () => Record<string, unknown>;
};

/**
 * Execute a set of child steps concurrently and resolve according to the configured strategy.
 *
 * @param env Executor environment providing helpers and workflow context.
 * @param step The parallel step definition including strategy and children.
 * @param state Mutable workflow execution state.
 * @param path Path tokens locating this parallel block in the workflow.
 * @returns Always undefined; suspensions are rejected inside parallel blocks.
 */
export async function executeParallel(
  env: StepExecutorEnv,
  step: ParallelStep,
  state: ExecutionState,
  path: Array<number | string>,
): Promise<Suspension | void> {
  if (step.steps.length === 0) {
    return undefined;
  }

  throwIfAborted(env.signal);

  const baseOutput = cloneRecord(state.output);
  const baseContextState = cloneRecord(env.context.state);
  const branches = step.steps.map((child, index) =>
    launchBranch({
      env,
      child,
      index,
      path,
      parentState: state,
      baseOutput,
      baseContextState,
    }),
  );

  if (step.strategy === 'wait_any') {
    return executeWaitAny(env, branches, state);
  }

  return executeWaitAll(env, branches, state);
}

async function executeWaitAll(
  env: StepExecutorEnv,
  branches: BranchHandle[],
  state: ExecutionState,
): Promise<void> {
  const pending = new Set(branches);
  const outcomes = new Map<number, BranchResult>();

  while (pending.size > 0) {
    const { branch, result } = await raceNext(pending);
    pending.delete(branch);
    outcomes.set(result.index, result);

    if (result.status === 'failed' || result.status === 'cancelled') {
      cancelBranches(
        env,
        pending,
        result.error,
        'Parallel branch execution was cancelled.',
      );
      await settleBranches(branches);
      throw result.error;
    }
  }

  mergeBranchOutputs(state, outcomes);
}

async function executeWaitAny(
  env: StepExecutorEnv,
  branches: BranchHandle[],
  state: ExecutionState,
): Promise<void> {
  const pending = new Set(branches);
  const outcomes = new Map<number, BranchResult>();

  while (pending.size > 0) {
    const { branch, result } = await raceNext(pending);
    pending.delete(branch);
    outcomes.set(result.index, result);

    if (result.status === 'fulfilled') {
      cancelBranches(
        env,
        pending,
        new WorkflowCancellationError('Parallel wait_any winner selected.'),
        'Parallel wait_any branch lost the race.',
      );
      await settleBranches(branches);
      mergeBranchOutputs(state, new Map([[result.index, result]]));

      return;
    }

    cancelBranches(
      env,
      pending,
      result.error,
      'Parallel branch execution was cancelled.',
    );
    await settleBranches(branches);
    throw result.error;
  }
}

function launchBranch({
  env,
  child,
  index,
  path,
  parentState,
  baseOutput,
  baseContextState,
}: {
  env: StepExecutorEnv;
  child: CompiledStep;
  index: number;
  path: Array<number | string>;
  parentState: ExecutionState;
  baseOutput: Record<string, unknown>;
  baseContextState: Record<string, unknown>;
}): BranchHandle {
  const controller = createBranchController(env.signal);
  const trackedOutput = createTrackedOutput(baseOutput);
  const branchState: ExecutionState = {
    input: parentState.input,
    output: trackedOutput.output,
    iteration: parentState.iteration ? { ...parentState.iteration } : undefined,
    accumulator: cloneValue(parentState.accumulator),
    iterationStack: [...parentState.iterationStack],
  };
  const branchContext = createParallelBranchContext(
    env.context,
    cloneRecord(baseContextState),
  );
  const branchEnv = env.fork({
    context: branchContext,
    signal: controller.signal,
    setCurrentStep: () => undefined,
  });
  const childPath = [...path, 'parallel', index];
  const promise = runBranch(
    branchEnv,
    child,
    branchState,
    childPath,
    trackedOutput,
    index,
  );

  return {
    index,
    step: child,
    iterationStack: [...parentState.iterationStack],
    controller,
    promise,
  };
}

async function runBranch(
  env: StepExecutorEnv,
  child: CompiledStep,
  branchState: ExecutionState,
  childPath: Array<number | string>,
  trackedOutput: TrackedOutput,
  index: number,
): Promise<BranchResult> {
  try {
    throwIfAborted(env.signal);

    const suspension = await env.executeStep(child, branchState, childPath);
    if (suspension) {
      throw new ParallelSuspensionError();
    }

    throwIfAborted(env.signal);

    return {
      status: 'fulfilled',
      index,
      outputDelta: trackedOutput.getDelta(),
    };
  } catch (error) {
    if (env.signal.aborted) {
      return { status: 'cancelled', index, error: getAbortReason(env.signal) };
    }

    return { status: 'failed', index, error };
  }
}

async function raceNext(
  pending: Set<BranchHandle>,
): Promise<{ branch: BranchHandle; result: BranchResult }> {
  return Promise.race(
    [...pending].map((branch) =>
      branch.promise.then((result) => ({ branch, result })),
    ),
  );
}

async function settleBranches(branches: BranchHandle[]): Promise<void> {
  await Promise.all(branches.map((branch) => branch.promise.catch(() => null)));
}

function cancelBranches(
  env: StepExecutorEnv,
  branches: Iterable<BranchHandle>,
  reason: unknown,
  snapshotReason: string,
): void {
  for (const branch of branches) {
    if (!branch.controller.signal.aborted) {
      branch.controller.abort(
        reason instanceof Error
          ? reason
          : new WorkflowCancellationError(String(reason)),
      );
    }

    markStepsCancelled(
      env,
      [branch.step],
      branch.iterationStack,
      reason instanceof Error ? reason.message : snapshotReason,
    );
  }
}

function mergeBranchOutputs(
  state: ExecutionState,
  outcomes: Map<number, BranchResult>,
): void {
  const ordered = [...outcomes.values()].sort((left, right) => {
    return left.index - right.index;
  });

  for (const outcome of ordered) {
    if (outcome.status !== 'fulfilled') {
      continue;
    }

    Object.assign(state.output, outcome.outputDelta);
  }
}

function createBranchController(parentSignal: AbortSignal): AbortController {
  const controller = new AbortController();

  if (parentSignal.aborted) {
    controller.abort(getAbortReason(parentSignal));

    return controller;
  }

  parentSignal.addEventListener(
    'abort',
    () => controller.abort(getAbortReason(parentSignal)),
    { once: true },
  );

  return controller;
}

function createTrackedOutput(
  baseOutput: Record<string, unknown>,
): TrackedOutput {
  const writtenKeys = new Set<string>();
  const target = cloneRecord(baseOutput);
  const output = new Proxy(target, {
    set(record, property, value) {
      if (typeof property === 'string') {
        writtenKeys.add(property);
      }

      return Reflect.set(record, property, value);
    },
    deleteProperty(record, property) {
      if (typeof property === 'string') {
        writtenKeys.add(property);
      }

      return Reflect.deleteProperty(record, property);
    },
  });

  return {
    output,
    getDelta: () =>
      Object.fromEntries(
        [...writtenKeys]
          .filter((key) => Object.prototype.hasOwnProperty.call(target, key))
          .map((key) => [key, target[key]]),
      ),
  };
}

class ParallelWorkflowRuntimeControl implements WorkflowRuntimeControl {
  constructor(private readonly getParent: () => WorkflowRuntimeControl) {}

  get status() {
    return this.getParent().status;
  }

  get resumeData() {
    return this.getParent().resumeData;
  }

  suspend<T = unknown>(): Promise<T> {
    return Promise.reject(new ParallelSuspensionError());
  }

  hasRecordedResult(): boolean {
    // Suspension is not supported inside parallel blocks, so no resume
    // result can ever be recorded for them.
    return false;
  }

  resume(data?: unknown): void {
    this.getParent().resume(data);
  }

  getSnapshot() {
    return this.getParent().getSnapshot();
  }
}

function createParallelBranchContext(
  context: BaseWorkflowContext,
  branchState: Record<string, unknown>,
): BaseWorkflowContext {
  let state = branchState;
  const workflow = new ParallelWorkflowRuntimeControl(() => context.workflow);

  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === 'state') {
        return state;
      }

      if (property === 'workflow') {
        return workflow;
      }

      if (property === 'snapshot') {
        return () => cloneRecord(state);
      }

      if (property === 'attachWorkflowRuntime') {
        return () => undefined;
      }

      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (property === 'state') {
        state = isRecord(value) ? value : {};

        return true;
      }

      return Reflect.set(target, property, value, receiver);
    },
  });
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(value) as Record<string, unknown>;
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON clone below.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    if (Array.isArray(value)) {
      return [...value] as T;
    }

    if (isRecord(value)) {
      return { ...value } as T;
    }

    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

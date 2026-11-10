/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  collectWaits,
  type ParallelBranchFrame,
  type ParallelFrame,
  type StepFrame,
} from '../checkpoint';
import type { BaseWorkflowContext } from '../context';
import {
  createLinkedAbortController,
  getAbortReason,
  throwIfAborted,
  WorkflowCancellationError,
} from '../errors';
import type { RunnerRuntimeControl } from '../runner-runtime-control';
import { cloneRecord, cloneValue, isRecord } from '../utils/clone';
import type {
  CompiledStep,
  ExecutionState,
  ParallelStep,
} from '../workflow-types';

import { markStepsCancelled } from './skip-helpers';
import type { StepExecutorEnv } from './types';

type BranchResult =
  | { status: 'fulfilled'; index: number; outputDelta: Record<string, unknown> }
  | {
      status: 'suspended';
      index: number;
      outputDelta: Record<string, unknown>;
      frame: StepFrame;
    }
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
 * A branch may suspend. The block then waits until every branch has settled
 * (fulfilled, suspended, or failed) before suspending itself, so a sibling that
 * was still running finishes exactly once instead of being re-run on resume.
 *
 * @param env Executor environment providing helpers and workflow context.
 * @param step The parallel step definition including strategy and children.
 * @param state Mutable workflow execution state.
 * @param path Path tokens locating this parallel block in the workflow.
 * @param frame Frame returned when the block previously suspended: fulfilled
 * branches are not launched again, parked ones stay parked unless this pass
 * resolves one of their waits, and those resume from their frame.
 * @returns A frame if any branch is left suspended, otherwise void.
 */
export async function executeParallel(
  env: StepExecutorEnv,
  step: ParallelStep,
  state: ExecutionState,
  path: Array<number | string>,
  frame?: ParallelFrame,
): Promise<ParallelFrame | void> {
  if (step.steps.length === 0) {
    return undefined;
  }

  throwIfAborted(env.signal);

  const outcomes = new Map<number, BranchResult>();
  const launches: Array<{
    child: CompiledStep;
    index: number;
    recorded?: ParallelBranchFrame;
  }> = [];
  step.steps.forEach((child, index) => {
    const recorded = frame?.branches[index];
    const kept = recorded ? keepRecordedBranch(env, index, recorded) : null;
    if (kept) {
      outcomes.set(index, kept);
    } else {
      launches.push({ child, index, recorded });
    }
  });

  const baseOutput = cloneRecord(state.output);
  const baseContextState = cloneRecord(env.context.state);
  const branches = launches.map(({ child, index, recorded }) =>
    launchBranch({
      env,
      child,
      index,
      path,
      parentState: state,
      baseOutput,
      baseContextState,
      recorded,
    }),
  );

  return settleBlock(env, step, branches, outcomes, state);
}

/**
 * Settle a recorded branch that has nothing to run in this pass: a fulfilled
 * branch never runs again, and a parked branch stays exactly as it was
 * unless this pass resolves one of its waits.
 *
 * @returns Its outcome, or null when the branch has to be launched.
 */
function keepRecordedBranch(
  env: StepExecutorEnv,
  index: number,
  recorded: ParallelBranchFrame,
): BranchResult | null {
  if (recorded.status === 'fulfilled') {
    return { status: 'fulfilled', index, outputDelta: recorded.outputDelta };
  }

  const resolved = collectWaits(recorded.child).some((wait) =>
    env.resolutions.has(wait.waitId),
  );

  return resolved
    ? null
    : {
        status: 'suspended',
        index,
        outputDelta: recorded.outputDelta,
        frame: recorded.child,
      };
}

/**
 * Collect branch results as they settle. A failed or cancelled branch fails
 * the block; under `wait_any` the first fulfilled branch wins it. Otherwise
 * the block suspends once every branch settled with at least one suspended,
 * and completes when all of them fulfilled.
 */
async function settleBlock(
  env: StepExecutorEnv,
  step: ParallelStep,
  branches: BranchHandle[],
  outcomes: Map<number, BranchResult>,
  state: ExecutionState,
): Promise<ParallelFrame | void> {
  const pending = new Set(branches);

  while (pending.size > 0) {
    const { branch, result } = await raceNext(pending);
    pending.delete(branch);
    outcomes.set(result.index, result);

    if (result.status === 'failed' || result.status === 'cancelled') {
      await abandonBranches(env, branches, pending, outcomes, result.error);
      throw result.error;
    }

    if (result.status === 'fulfilled' && step.strategy === 'wait_any') {
      // Parked losers will never be resumed; drop their waits with the race.
      await abandonBranches(
        env,
        branches,
        pending,
        outcomes,
        new WorkflowCancellationError('Parallel wait_any winner selected.'),
        'Parallel wait_any branch lost the race.',
      );
      mergeBranchOutputs(state, new Map([[result.index, result]]));

      return undefined;
    }
  }

  // Without a winner, every branch of a wait_any block is suspended.
  if (hasSuspendedBranch(outcomes)) {
    return buildParallelFrame(step, outcomes);
  }

  mergeBranchOutputs(state, outcomes);
}

/**
 * Give up on the block: cancel the branches still running, let every branch
 * settle, then drop the waits of every branch left suspended, including one
 * that suspended while it was being cancelled.
 */
async function abandonBranches(
  env: StepExecutorEnv,
  branches: BranchHandle[],
  pending: Set<BranchHandle>,
  outcomes: Map<number, BranchResult>,
  reason: unknown,
  snapshotReason = 'Parallel branch execution was cancelled.',
): Promise<void> {
  cancelBranches(env, pending, reason, snapshotReason);
  for (const result of await settleBranches(branches)) {
    outcomes.set(result.index, result);
  }

  cancelSuspendedBranches(env, outcomes, reason);
}

function launchBranch({
  env,
  child,
  index,
  path,
  parentState,
  baseOutput,
  baseContextState,
  recorded,
}: {
  env: StepExecutorEnv;
  child: CompiledStep;
  index: number;
  path: Array<number | string>;
  parentState: ExecutionState;
  baseOutput: Record<string, unknown>;
  baseContextState: Record<string, unknown>;
  recorded?: ParallelBranchFrame;
}): BranchHandle {
  const { controller, unlink } = createLinkedAbortController(env.signal);
  const trackedOutput = createTrackedOutput(baseOutput, recorded?.outputDelta);
  const branchState: ExecutionState = {
    input: parentState.input,
    output: trackedOutput.output,
    iteration: parentState.iteration ? { ...parentState.iteration } : undefined,
    accumulator: cloneValue(parentState.accumulator),
    iterationStack: [...parentState.iterationStack],
  };
  const branchRuntime = env.runtime.fork();
  const branchContext = createParallelBranchContext(
    env.context,
    cloneRecord(baseContextState),
    branchRuntime,
  );
  const branchEnv = env.fork({
    context: branchContext,
    signal: controller.signal,
    runtime: branchRuntime,
  });
  const childPath = [...path, 'parallel', index];
  const promise = runBranch(
    branchEnv,
    child,
    branchState,
    childPath,
    trackedOutput,
    index,
    recorded?.status === 'suspended' ? recorded.child : undefined,
  ).finally(unlink);

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
  frame?: StepFrame,
): Promise<BranchResult> {
  try {
    throwIfAborted(env.signal);

    const suspended = await env.executeStep(
      child,
      branchState,
      childPath,
      frame,
    );

    // A branch can suspend while it is being cancelled: its wait was opened
    // all the same, so the block needs its frame to drop it.
    if (suspended) {
      return {
        status: 'suspended',
        index,
        outputDelta: trackedOutput.getDelta(),
        frame: suspended,
      };
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

/** Wait for every branch to settle; `runBranch` never rejects. */
async function settleBranches(
  branches: BranchHandle[],
): Promise<BranchResult[]> {
  return Promise.all(branches.map((branch) => branch.promise));
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

/**
 * Mark the parked waits of suspended branches cancelled once the block can
 * no longer resume them.
 */
function cancelSuspendedBranches(
  env: StepExecutorEnv,
  outcomes: Map<number, BranchResult>,
  reason: unknown,
): void {
  const message =
    reason instanceof Error ? reason.message : 'Parallel branch was cancelled.';

  for (const outcome of outcomes.values()) {
    if (outcome.status !== 'suspended') {
      continue;
    }

    for (const wait of collectWaits(outcome.frame)) {
      const stepExecution = env.recordStepExecution(wait.step, {
        status: 'cancelled',
        endedAt: Date.now(),
        reason: message,
        error: { message },
      });
      env.markSnapshot(wait.step, 'cancelled', message);
      env.emit('hook:step:cancelled', {
        runId: env.runId,
        step: wait.step,
        stepExecution,
        error: reason instanceof Error ? reason : new Error(message),
        wait,
      });
    }
  }
}

function hasSuspendedBranch(outcomes: Map<number, BranchResult>): boolean {
  return [...outcomes.values()].some(
    (outcome) => outcome.status === 'suspended',
  );
}

function buildParallelFrame(
  step: ParallelStep,
  outcomes: Map<number, BranchResult>,
): ParallelFrame {
  return {
    kind: 'parallel',
    stepId: step.id,
    branches: step.steps.map((_, index): ParallelBranchFrame => {
      const outcome = outcomes.get(index);

      if (outcome?.status === 'fulfilled') {
        return { status: 'fulfilled', outputDelta: outcome.outputDelta };
      }

      if (outcome?.status === 'suspended') {
        return {
          status: 'suspended',
          outputDelta: outcome.outputDelta,
          child: outcome.frame,
        };
      }

      throw new Error(
        `Parallel branch ${index} of "${step.id}" did not settle before suspending.`,
      );
    }),
  };
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

/**
 * Give a branch its own copy of the parent output that remembers which keys
 * the branch wrote. A resumed branch starts from the delta it had recorded.
 */
function createTrackedOutput(
  baseOutput: Record<string, unknown>,
  recordedDelta?: Record<string, unknown>,
): TrackedOutput {
  const writtenKeys = new Set<string>(Object.keys(recordedDelta ?? {}));
  const target = cloneRecord(baseOutput);
  if (recordedDelta) {
    Object.assign(target, cloneRecord(recordedDelta));
  }

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

/**
 * Isolate a branch's context state and route `context.workflow` to the
 * branch's own runtime scope, so its steps can suspend independently.
 */
function createParallelBranchContext(
  context: BaseWorkflowContext,
  branchState: Record<string, unknown>,
  runtime: RunnerRuntimeControl,
): BaseWorkflowContext {
  let state = branchState;

  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === 'state') {
        return state;
      }

      if (property === 'workflow') {
        return runtime;
      }

      if (property === 'getWorkflowRuntime') {
        return () => runtime;
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

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  buildWaitId,
  type RecordedResult,
  type TaskFrame,
  type WaitInfo,
} from '../checkpoint';
import type { StepExecutionRecord } from '../context';
import {
  createLinkedAbortController,
  getAbortReason,
  isWorkflowResumeRejectedError,
  throwIfAborted,
  WorkflowCancellationError,
  type WorkflowResumeRejectedError,
} from '../errors';
import type {
  RunnerRuntimeControl,
  RuntimeSuspensionRequest,
  StepReplaySeed,
} from '../runner-runtime-control';
import { cloneAsJson, cloneValue } from '../utils/clone';
import type { StepInfo } from '../workflow-event-emitter';
import type { CompiledTask, ExecutionState, TaskStep } from '../workflow-types';
import { evaluateMapping } from '../workflow-values';

import { buildEvaluationScope } from './scope';
import type { StepExecutorEnv } from './types';

type TaskProgressOutcome =
  | { type: 'completed'; value: unknown }
  | { type: 'failed'; error: unknown }
  | { type: 'cancelled'; error: Error }
  | { type: 'suspended'; request: RuntimeSuspensionRequest };

/**
 * Execute a task step, returning a frame when its action suspends.
 *
 * Given a frame, the step either stays parked (its wait is not resolved by
 * this pass) or re-runs its action body: earlier `suspend()` calls resolve
 * from the frame, including the one this pass resolved. A body that refuses
 * that payload returns the frame unchanged, so the wait stays open.
 *
 * @param env Executor environment with compiled workflow and helpers.
 * @param step The compiled task step to execute.
 * @param state Mutable workflow execution state.
 * @param _path Location of the step within the workflow (unused in this executor).
 * @param frame Frame returned when this step previously suspended.
 * @returns A frame if the task suspends, otherwise void.
 */
export async function executeTaskStep(
  env: StepExecutorEnv,
  step: TaskStep,
  state: ExecutionState,
  _path: Array<number | string>,
  frame?: TaskFrame,
): Promise<TaskFrame | void> {
  void _path;
  const task = env.compiled.tasks[step.taskName];
  if (!task) {
    throw new Error(`Task "${step.taskName}" is not defined.`);
  }

  // A parked wait that this pass does not resolve stays exactly as it was.
  if (frame && !env.resolutions.has(frame.wait.waitId)) {
    return frame;
  }

  const stepInfo = env.buildInstanceStepInfo(step, state.iterationStack);
  throwIfCancelled(env, stepInfo, frame);

  // Resumed bodies reuse the inputs they first ran with: re-evaluating could
  // differ, e.g. when an expression depends on the event that woke the run.
  const inputs = frame
    ? cloneValue(frame.inputs)
    : await evaluateMapping(task.inputs, buildEvaluationScope(env, state));
  throwIfCancelled(env, stepInfo, frame);
  // Kept apart from the object the body gets, so that a body changing its
  // inputs cannot change the inputs every later pass replays.
  const recordedInputs = frame ? frame.inputs : copyInputs(inputs);
  const resumeData = frame ? env.resolutions.get(frame.wait.waitId) : undefined;
  const stepExecution = env.recordStepExecution(stepInfo, {
    action: task.actionName,
    status: 'running',
    startedAt: Date.now(),
    endedAt: undefined,
    reason: undefined,
    input: inputs,
    context: { before: env.context.snapshot() },
  });
  env.runtime.beginStep(stepInfo, {
    seed: frame ? buildReplaySeed(frame, resumeData) : undefined,
  });
  env.markSnapshot(stepInfo, 'running');
  if (frame) {
    env.emit('hook:step:resumed', {
      runId: env.runId,
      step: stepInfo,
      stepExecution,
      wait: frame.wait,
      resumeData,
    });
  } else {
    env.emit('hook:step:start', {
      runId: env.runId,
      step: stepInfo,
      stepExecution,
    });
  }

  // Each action gets its own signal so a suspension can stop its body
  // without cancelling anything else.
  const { controller, unlink } = createLinkedAbortController(env.signal);
  let outcome: TaskProgressOutcome;
  try {
    throwIfAborted(env.signal);

    const actionPromise = Promise.resolve().then(() =>
      task.action.run(
        inputs,
        env.context,
        task.settings,
        task.bindings,
        controller.signal,
      ),
    );
    outcome = await waitForTaskProgress(
      controller.signal,
      env.runtime,
      actionPromise,
    );
  } catch (error) {
    env.runtime.endStep();
    throw error;
  } finally {
    unlink();
  }

  switch (outcome.type) {
    case 'suspended':
      env.runtime.endStep();
      // The body is parked on a promise that never settles. Aborting it clears
      // its timeout and stops its retry loop; resuming re-runs it instead.
      controller.abort(
        new WorkflowCancellationError(`Step "${stepInfo.id}" suspended.`),
      );

      return suspendTask(env, step, stepInfo, recordedInputs, outcome.request);
    case 'completed':
      try {
        env.runtime.endStep({ completed: true });
      } catch (error) {
        recordTaskFailure(env, stepInfo, error);
        throw error;
      }

      await completeTask(env, stepInfo, task, state, outcome.value);

      return undefined;
    case 'failed': {
      const { error } = outcome;
      // Only a body that already read the resolved payload can refuse it.
      const rejected =
        frame !== undefined &&
        isWorkflowResumeRejectedError(error) &&
        env.runtime.hasReachedResolvedSuspension();
      env.runtime.endStep();
      if (rejected) {
        return keepWaiting(env, stepInfo, frame, error);
      }

      recordTaskFailure(env, stepInfo, error);
      throw error;
    }
    case 'cancelled':
      env.runtime.endStep();
      recordTaskCancellation(env, stepInfo, outcome.error, frame?.wait);
      throw outcome.error;
  }
}

/**
 * Copy the inputs a body first runs with, the way the checkpoint stores them.
 * Inputs JSON cannot encode are returned as they are: building the checkpoint
 * reports them if the step suspends.
 */
const copyInputs = (
  inputs: Record<string, unknown>,
): Record<string, unknown> => {
  try {
    return cloneAsJson(inputs);
  } catch {
    return inputs;
  }
};
/**
 * Record the task cancelled and throw when the run was aborted before its
 * body started.
 */
const throwIfCancelled = (
  env: StepExecutorEnv,
  stepInfo: StepInfo,
  frame?: TaskFrame,
): void => {
  if (!env.signal.aborted) {
    return;
  }

  const error = getAbortReason(env.signal);
  recordTaskCancellation(env, stepInfo, error, frame?.wait);
  throw error;
};
/**
 * Seed a resumed body with every answer it already got, including the one
 * this pass resolved, and the suspension it is expected to reach again.
 */
const buildReplaySeed = (
  frame: TaskFrame,
  resumeData: unknown,
): StepReplaySeed => ({
  awaitResults: {
    ...readRecordedResults(frame.awaitResults),
    [frame.wait.suspendKey]: resumeData,
  },
  expected: {
    suspendKey: frame.wait.suspendKey,
    reason: frame.wait.reason,
  },
});
const waitForTaskProgress = async (
  signal: AbortSignal,
  runtime: RunnerRuntimeControl,
  actionPromise: Promise<unknown>,
): Promise<TaskProgressOutcome> => {
  const completion = actionPromise.then(
    (value): TaskProgressOutcome => ({ type: 'completed', value }),
    (error): TaskProgressOutcome => ({ type: 'failed', error }),
  );
  const suspension = runtime
    .waitForSuspension()
    .then<TaskProgressOutcome>((request) => ({ type: 'suspended', request }));
  let cleanupCancellation = () => undefined;
  const cancellation = new Promise<TaskProgressOutcome>((resolve) => {
    if (signal.aborted) {
      resolve({ type: 'cancelled', error: getAbortReason(signal) });

      return;
    }

    const onAbort = () => {
      resolve({ type: 'cancelled', error: getAbortReason(signal) });
    };

    signal.addEventListener('abort', onAbort, { once: true });
    cleanupCancellation = () => {
      signal.removeEventListener('abort', onAbort);
    };
  });

  try {
    return await Promise.race([completion, suspension, cancellation]);
  } finally {
    cleanupCancellation();
  }
};
const completeTask = async (
  env: StepExecutorEnv,
  stepInfo: StepInfo,
  task: CompiledTask,
  state: ExecutionState,
  result: unknown,
) => {
  await env.captureTaskOutput(task, state, result);
  const stepExecution = endStepExecution(env, stepInfo, 'completed', {
    output: result,
  });
  env.emit('hook:step:success', {
    runId: env.runId,
    step: stepInfo,
    stepExecution,
  });
};
const suspendTask = (
  env: StepExecutorEnv,
  step: TaskStep,
  stepInfo: StepInfo,
  inputs: Record<string, unknown>,
  request: RuntimeSuspensionRequest,
): TaskFrame => {
  const wait: WaitInfo = {
    waitId: buildWaitId(stepInfo.id, request.suspendKey),
    step: stepInfo,
    suspendKey: request.suspendKey,
    reason: request.reason,
    data: request.data,
    ...(request.accepts ? { accepts: request.accepts } : {}),
    ...(request.payloadOptional ? { payloadOptional: true } : {}),
  };
  const stepExecution = endStepExecution(
    env,
    stepInfo,
    'suspended',
    { reason: request.reason },
    request.reason,
  );
  env.emit('hook:step:suspended', {
    runId: env.runId,
    step: stepInfo,
    stepExecution,
    wait,
  });

  return {
    kind: 'task',
    stepId: step.id,
    inputs,
    awaitResults: recordResults(request.awaitResults),
    wait,
  };
};
/** Wrap each answer so that one without payload survives JSON. */
const recordResults = (
  results: Record<string, unknown>,
): Record<string, RecordedResult> =>
  Object.fromEntries(
    Object.entries(results).map(([key, value]) => [key, { value }]),
  );
const readRecordedResults = (
  recorded: Record<string, RecordedResult>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(recorded).map(([key, result]) => [key, result.value]),
  );
/**
 * Put a resumed step back in its suspended state after its body refused the
 * resume payload, and hand back the frame it resumed from.
 */
const keepWaiting = (
  env: StepExecutorEnv,
  stepInfo: StepInfo,
  frame: TaskFrame,
  error: WorkflowResumeRejectedError,
): TaskFrame => {
  const stepExecution = endStepExecution(
    env,
    stepInfo,
    'suspended',
    { reason: frame.wait.reason },
    frame.wait.reason,
  );
  env.emit('hook:step:resume_rejected', {
    runId: env.runId,
    step: stepInfo,
    stepExecution,
    wait: frame.wait,
    error,
  });
  env.rejectResume({ waitId: frame.wait.waitId, error });

  return frame;
};
const recordTaskFailure = (
  env: StepExecutorEnv,
  stepInfo: StepInfo,
  error: unknown,
) => {
  const stepExecution = endStepExecutionWithError(
    env,
    stepInfo,
    'failed',
    error,
  );
  env.emit('hook:step:error', {
    runId: env.runId,
    step: stepInfo,
    stepExecution,
    error,
  });
};
/**
 * Record a cancelled task. A task cancelled while resolving a wait drops that
 * wait, so the event carries it.
 */
const recordTaskCancellation = (
  env: StepExecutorEnv,
  stepInfo: StepInfo,
  error: unknown,
  wait?: WaitInfo,
) => {
  const stepExecution = endStepExecutionWithError(
    env,
    stepInfo,
    'cancelled',
    error,
  );
  env.emit('hook:step:cancelled', {
    runId: env.runId,
    step: stepInfo,
    stepExecution,
    error,
    ...(wait ? { wait } : {}),
  });
};
/**
 * Close the step's execution record with the status the step ended (or
 * paused) with, and mirror that status on its snapshot.
 *
 * @returns The updated execution record, for the event announcing it.
 */
const endStepExecution = (
  env: StepExecutorEnv,
  stepInfo: StepInfo,
  status: 'completed' | 'suspended' | 'failed' | 'cancelled',
  details: Pick<StepExecutionRecord, 'output' | 'reason' | 'error'>,
  snapshotReason?: string,
): StepExecutionRecord => {
  const stepExecution = env.recordStepExecution(stepInfo, {
    status,
    endedAt: Date.now(),
    ...details,
    context: { after: env.context.snapshot() },
  });
  env.markSnapshot(stepInfo, status, snapshotReason);

  return stepExecution;
};
const endStepExecutionWithError = (
  env: StepExecutorEnv,
  stepInfo: StepInfo,
  status: 'failed' | 'cancelled',
  error: unknown,
): StepExecutionRecord =>
  endStepExecution(
    env,
    stepInfo,
    status,
    {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { message: String(error) },
    },
    error instanceof Error ? error.message : String(error),
  );

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { LoopFrame } from '../checkpoint';
import type {
  EvaluationScope,
  ExecutionState,
  ForEachLoopStep,
  LoopStep,
  WhileLoopStep,
} from '../workflow-types';
import { evaluateValue } from '../workflow-values';

import { buildEvaluationScope } from './scope';
import type { StepExecutorEnv } from './types';

/**
 * Execute a loop step by iterating over input items and executing child steps.
 *
 * @param env Executor environment with helpers and workflow context.
 * @param step The loop step configuration.
 * @param state Mutable workflow execution state.
 * @param path Path tokens locating this loop within the workflow.
 * @param frame Frame returned when an iteration previously suspended; the
 * loop resumes that iteration with the items and accumulator it recorded.
 * @returns A frame if an iteration suspends, otherwise void.
 */
export async function executeLoop(
  env: StepExecutorEnv,
  step: LoopStep,
  state: ExecutionState,
  path: Array<number | string>,
  frame?: LoopFrame,
): Promise<LoopFrame | void> {
  if (step.loopType === 'for_each') {
    return executeForEachLoop(env, step, state, path, frame);
  }

  return executeWhileLoop(env, step, state, path, frame);
}

async function executeForEachLoop(
  env: StepExecutorEnv,
  step: ForEachLoopStep,
  state: ExecutionState,
  path: Array<number | string>,
  frame?: LoopFrame,
): Promise<LoopFrame | void> {
  // The item list is resolved once, when the loop starts; a resumed loop
  // keeps iterating over the same items even if `in` would now differ.
  const items = frame
    ? (frame.items ?? [])
    : await resolveItems(env, step, state);
  let accumulator = frame
    ? frame.accumulator
    : (step.accumulate?.initial ?? state.accumulator);

  for (let index = frame?.index ?? 0; index < items.length; index += 1) {
    const item = items[index];
    const iterationState: ExecutionState = {
      ...state,
      iteration: { item, index },
      accumulator,
      iterationStack: [...state.iterationStack, index],
    };
    const child = await env.executeFlow(
      step.steps,
      iterationState,
      [...path, index],
      frame && index === frame.index ? frame.child : undefined,
    );

    if (child) {
      return {
        kind: 'loop',
        stepId: step.id,
        index,
        items,
        accumulator,
        child,
      };
    }

    const postScope = buildEvaluationScope(env, iterationState, {
      iteration: { item, index },
      accumulator,
    });

    accumulator = await updateAccumulator(step, postScope, accumulator);

    const shouldStop = await shouldStopLoop(step, postScope);
    if (shouldStop) {
      break;
    }

    state.output = iterationState.output;
  }

  finalizeAccumulatorState(step, state, accumulator);

  return undefined;
}

async function executeWhileLoop(
  env: StepExecutorEnv,
  step: WhileLoopStep,
  state: ExecutionState,
  path: Array<number | string>,
  frame?: LoopFrame,
): Promise<LoopFrame | void> {
  let accumulator = frame
    ? frame.accumulator
    : (step.accumulate?.initial ?? state.accumulator);

  for (let index = frame?.index ?? 0; ; index += 1) {
    const resumedChild =
      frame && index === frame.index ? frame.child : undefined;

    // The guard of a resumed iteration already passed before it suspended.
    if (!resumedChild) {
      const conditionScope = buildEvaluationScope(env, state, {
        iteration: { item: undefined, index },
        accumulator,
      });
      const shouldContinue = await evaluateValue(step.while, conditionScope);
      if (!Boolean(shouldContinue)) {
        break;
      }
    }

    const iterationState: ExecutionState = {
      ...state,
      iteration: { item: undefined, index },
      accumulator,
      iterationStack: [...state.iterationStack, index],
    };
    const child = await env.executeFlow(
      step.steps,
      iterationState,
      [...path, index],
      resumedChild,
    );

    if (child) {
      return { kind: 'loop', stepId: step.id, index, accumulator, child };
    }

    const postScope = buildEvaluationScope(env, iterationState, {
      iteration: { item: undefined, index },
      accumulator,
    });

    accumulator = await updateAccumulator(step, postScope, accumulator);
    state.output = iterationState.output;
  }

  finalizeAccumulatorState(step, state, accumulator);

  return undefined;
}

async function resolveItems(
  env: StepExecutorEnv,
  step: ForEachLoopStep,
  state: ExecutionState,
): Promise<unknown[]> {
  const items = await evaluateValue(
    step.forEach.in,
    buildEvaluationScope(env, state),
  );

  return Array.isArray(items) ? items : [];
}

function finalizeAccumulatorState(
  step: LoopStep,
  state: ExecutionState,
  accumulator: unknown,
): void {
  if (step.accumulate && step.name) {
    state.output[step.name] = { [step.accumulate.as]: accumulator };
  }

  if (step.accumulate) {
    state.accumulator = accumulator;
  }
}

/**
 * Update the loop accumulator using the configured merge expression.
 *
 * @param step The loop step containing accumulation settings.
 * @param scope Current evaluation scope for expressions.
 * @param previous Previous accumulator value to merge with.
 * @returns The updated accumulator value.
 */
export async function updateAccumulator(
  step: LoopStep,
  scope: EvaluationScope,
  previous: unknown,
): Promise<unknown> {
  if (!step.accumulate) {
    return previous;
  }

  return evaluateValue(step.accumulate.merge, {
    ...scope,
    accumulator: previous,
  });
}

/**
 * Determine whether loop execution should stop based on the `until` condition.
 *
 * @param step The loop step configuration.
 * @param scope Current evaluation scope for expressions.
 * @returns True if the loop should stop, otherwise false.
 */
export async function shouldStopLoop(
  step: LoopStep,
  scope: EvaluationScope,
): Promise<boolean> {
  if (step.loopType !== 'for_each' || !step.until) {
    return false;
  }

  const result = await evaluateValue(step.until, scope);

  return Boolean(result);
}

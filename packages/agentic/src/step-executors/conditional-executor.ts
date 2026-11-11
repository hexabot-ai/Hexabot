/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ConditionalFrame } from '../checkpoint';
import type { ConditionalStep, ExecutionState } from '../workflow-types';
import { evaluateValue } from '../workflow-values';

import { buildEvaluationScope } from './scope';
import { markStepsSkipped } from './skip-helpers';
import type { StepExecutorEnv } from './types';

/**
 * Evaluate a conditional step by checking branches in order and executing the first match.
 *
 * @param env Executor environment providing helpers and workflow context.
 * @param step The conditional step definition.
 * @param state Mutable workflow execution state.
 * @param path Path tokens locating this step within the workflow tree.
 * @param frame Frame returned when the chosen branch previously suspended; its
 * branch is re-entered without evaluating conditions again.
 * @returns A frame if the chosen branch suspends, otherwise void.
 */
export async function executeConditional(
  env: StepExecutorEnv,
  step: ConditionalStep,
  state: ExecutionState,
  path: Array<number | string>,
  frame?: ConditionalFrame,
): Promise<ConditionalFrame | void> {
  const branchIndex = frame
    ? frame.branchIndex
    : await chooseBranch(env, step, state);
  if (branchIndex === undefined) {
    step.branches.forEach((branch) =>
      markStepsSkipped(env, branch.steps, state.iterationStack),
    );

    return undefined;
  }

  if (!frame) {
    step.branches.forEach((candidate, candidateIndex) => {
      if (candidateIndex !== branchIndex) {
        markStepsSkipped(env, candidate.steps, state.iterationStack);
      }
    });
  }

  const child = await env.executeFlow(
    step.branches[branchIndex].steps,
    state,
    [...path, 'branch', branchIndex],
    frame?.child,
  );

  if (child) {
    return { kind: 'conditional', stepId: step.id, branchIndex, child };
  }

  return undefined;
}

const chooseBranch = async (
  env: StepExecutorEnv,
  step: ConditionalStep,
  state: ExecutionState,
): Promise<number | undefined> => {
  const scope = buildEvaluationScope(env, state);

  for (let index = 0; index < step.branches.length; index += 1) {
    const branch = step.branches[index];
    const conditionResult =
      branch.condition !== undefined
        ? await evaluateValue(branch.condition, scope)
        : true;

    if (conditionResult) {
      return index;
    }
  }

  return undefined;
};

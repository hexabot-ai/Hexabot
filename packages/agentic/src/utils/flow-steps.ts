/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { FlowStep } from '../dsl.types';

type DefinitionPath = Array<string | number>;

/** A `do` step: the task it runs, and where the reference sits. */
export type TaskReference = {
  taskId: string;
  path: DefinitionPath;
};

/**
 * The step lists nested in a flow step, each with its path relative to the
 * step: one for `parallel` and `loop`, one per branch for `conditional`.
 */
const nestedStepLists = (
  step: FlowStep,
): Array<{ steps: FlowStep[]; path: DefinitionPath }> => {
  if ('parallel' in step) {
    return [{ steps: step.parallel.steps, path: ['parallel', 'steps'] }];
  }

  if ('conditional' in step) {
    return step.conditional.when.map((branch, branchIndex) => ({
      steps: branch.steps,
      path: ['conditional', 'when', branchIndex, 'steps'],
    }));
  }

  if ('loop' in step) {
    return [{ steps: step.loop.steps, path: ['loop', 'steps'] }];
  }

  return [];
};

/**
 * List every task reference of a flow, depth first, in flow order.
 *
 * @param steps The flow, or a nested step list.
 * @param basePath Path of `steps` inside the workflow definition.
 */
export const collectTaskReferences = (
  steps: FlowStep[],
  basePath: DefinitionPath = ['flow'],
): TaskReference[] =>
  steps.flatMap((step, index) => {
    const stepPath = [...basePath, index];

    if ('do' in step) {
      return [{ taskId: step.do, path: [...stepPath, 'do'] }];
    }

    return nestedStepLists(step).flatMap(({ steps: nested, path }) =>
      collectTaskReferences(nested, [...stepPath, ...path]),
    );
  });

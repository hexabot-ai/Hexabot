/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType, type StepInfo } from '../workflow-event-emitter';
import type { CompiledStep } from '../workflow-types';

import type { StepExecutorEnv } from './types';

type SkipStepEnv = Pick<
  StepExecutorEnv,
  'runId' | 'buildInstanceStepInfo' | 'markSnapshot' | 'emit'
>;

/**
 * Visit steps depth first, entering parallel and conditional children. Loop
 * bodies are not entered: their step instances depend on iterations that
 * never ran.
 */
const forEachStepInTree = (
  steps: CompiledStep[],
  visit: (step: CompiledStep) => void,
): void => {
  for (const step of steps) {
    visit(step);

    if (step.type === StepType.Parallel) {
      forEachStepInTree(step.steps, visit);
    } else if (step.type === StepType.Conditional) {
      step.branches.forEach((branch) => forEachStepInTree(branch.steps, visit));
    }
  }
};
/** Mark every step of the tree with `status`, then announce it. */
const markStepTree = (
  env: SkipStepEnv,
  steps: CompiledStep[],
  iterationStack: number[],
  status: 'skipped' | 'cancelled',
  reason: string | undefined,
  announce: (stepInfo: StepInfo) => void,
) => {
  forEachStepInTree(steps, (step) => {
    const stepInfo = env.buildInstanceStepInfo(step, iterationStack);
    env.markSnapshot(stepInfo, status, reason);
    announce(stepInfo);
  });
};

export const markStepsSkipped = (
  env: SkipStepEnv,
  steps: CompiledStep[],
  iterationStack: number[],
  reason?: string,
) => {
  markStepTree(env, steps, iterationStack, 'skipped', reason, (stepInfo) =>
    env.emit('hook:step:skipped', { runId: env.runId, step: stepInfo, reason }),
  );
};

export const markStepsCancelled = (
  env: SkipStepEnv,
  steps: CompiledStep[],
  iterationStack: number[],
  reason?: string,
) => {
  markStepTree(env, steps, iterationStack, 'cancelled', reason, (stepInfo) =>
    env.emit('hook:step:cancelled', {
      runId: env.runId,
      step: stepInfo,
      error: new Error(reason ?? 'Step execution was cancelled.'),
    }),
  );
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { EvaluationScope, ExecutionState } from '../workflow-types';

import type { StepExecutorEnv } from './types';

/**
 * Expose the live state of a step to its expressions.
 *
 * @param env Executor environment, for the context state.
 * @param state Execution state of the step.
 * @param overrides The iteration and accumulator a loop evaluates with.
 * @returns The scope expressions are evaluated against.
 */
export const buildEvaluationScope = (
  env: Pick<StepExecutorEnv, 'context'>,
  state: ExecutionState,
  overrides: Pick<EvaluationScope, 'iteration' | 'accumulator'> = {},
): EvaluationScope => ({
  input: state.input,
  context: env.context.state,
  output: state.output,
  iteration: state.iteration,
  accumulator: state.accumulator,
  ...overrides,
});

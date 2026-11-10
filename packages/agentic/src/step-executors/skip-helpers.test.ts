/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType, type StepInfo } from '../workflow-event-emitter';
import type { CompiledStep } from '../workflow-types';

import { markStepsCancelled, markStepsSkipped } from './skip-helpers';

const task = (id: string): CompiledStep => ({
  id,
  type: StepType.Task,
  label: id,
  taskName: id,
});
// parallel(task a, conditional(task b | loop(task d))), task e
const steps: CompiledStep[] = [
  {
    id: 'p',
    type: StepType.Parallel,
    label: 'p',
    strategy: 'wait_all',
    steps: [
      task('a'),
      {
        id: 'c',
        type: StepType.Conditional,
        label: 'c',
        branches: [
          { id: 'c-0', steps: [task('b')] },
          {
            id: 'c-1',
            steps: [
              {
                id: 'l',
                type: StepType.Loop,
                label: 'l',
                loopType: 'while',
                while: { kind: 'literal', value: false },
                steps: [task('d')],
              },
            ],
          },
        ],
      },
    ],
  },
  task('e'),
];
const createEnv = () => ({
  runId: 'run-1',
  buildInstanceStepInfo: jest.fn(
    (step: CompiledStep, iterationStack: number[]): StepInfo => ({
      id: `${step.id}[${iterationStack.join('.')}]`,
      name: step.label,
      type: step.type,
    }),
  ),
  markSnapshot: jest.fn(),
  emit: jest.fn(),
});
const VISITED = ['p', 'a', 'c', 'b', 'l', 'e'];

describe('markStepsSkipped', () => {
  it('marks steps and the steps nested in their branches, but not loop bodies', () => {
    const env = createEnv();

    markStepsSkipped(env, steps, [2], 'branch not taken');

    expect(env.markSnapshot.mock.calls).toEqual(
      VISITED.map((id) => [
        { id: `${id}[2]`, name: id, type: expect.any(String) },
        'skipped',
        'branch not taken',
      ]),
    );
    expect(env.emit.mock.calls).toEqual(
      VISITED.map((id) => [
        'hook:step:skipped',
        {
          runId: 'run-1',
          step: expect.objectContaining({ id: `${id}[2]` }),
          reason: 'branch not taken',
        },
      ]),
    );
  });
});

describe('markStepsCancelled', () => {
  it('marks steps and the steps nested in their branches, but not loop bodies', () => {
    const env = createEnv();

    markStepsCancelled(env, steps, [], 'lost the race');

    expect(env.markSnapshot.mock.calls).toEqual(
      VISITED.map((id) => [
        expect.objectContaining({ id: `${id}[]` }),
        'cancelled',
        'lost the race',
      ]),
    );
    expect(env.emit.mock.calls).toEqual(
      VISITED.map((id) => [
        'hook:step:cancelled',
        {
          runId: 'run-1',
          step: expect.objectContaining({ id: `${id}[]` }),
          error: new Error('lost the race'),
        },
      ]),
    );
  });

  it('falls back to a generic error without a reason', () => {
    const env = createEnv();

    markStepsCancelled(env, [task('a')], []);

    expect(env.markSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a[]' }),
      'cancelled',
      undefined,
    );
    expect(env.emit).toHaveBeenCalledWith('hook:step:cancelled', {
      runId: 'run-1',
      step: expect.objectContaining({ id: 'a[]' }),
      error: new Error('Step execution was cancelled.'),
    });
  });
});

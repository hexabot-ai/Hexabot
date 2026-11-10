/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { FlowStep } from '../dsl.types';

import { collectTaskReferences } from './flow-steps';

describe('collectTaskReferences', () => {
  it('lists the task references of every nested step list, in flow order', () => {
    const flow: FlowStep[] = [
      { do: 'first' },
      {
        parallel: {
          steps: [
            { do: 'second' },
            {
              conditional: {
                when: [
                  { condition: '=true', steps: [{ do: 'third' }] },
                  {
                    else: true,
                    steps: [
                      {
                        loop: {
                          type: 'while',
                          while: '=false',
                          steps: [{ do: 'fourth' }, { do: 'first' }],
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ];

    expect(collectTaskReferences(flow)).toEqual([
      { taskId: 'first', path: ['flow', 0, 'do'] },
      { taskId: 'second', path: ['flow', 1, 'parallel', 'steps', 0, 'do'] },
      {
        taskId: 'third',
        path: [
          'flow',
          1,
          'parallel',
          'steps',
          1,
          'conditional',
          'when',
          0,
          'steps',
          0,
          'do',
        ],
      },
      {
        taskId: 'fourth',
        path: [
          'flow',
          1,
          'parallel',
          'steps',
          1,
          'conditional',
          'when',
          1,
          'steps',
          0,
          'loop',
          'steps',
          0,
          'do',
        ],
      },
      {
        taskId: 'first',
        path: [
          'flow',
          1,
          'parallel',
          'steps',
          1,
          'conditional',
          'when',
          1,
          'steps',
          0,
          'loop',
          'steps',
          1,
          'do',
        ],
      },
    ]);
  });

  it('locates references under the given base path', () => {
    expect(collectTaskReferences([{ do: 'task' }], ['defs', 'x'])).toEqual([
      { taskId: 'task', path: ['defs', 'x', 0, 'do'] },
    ]);
  });

  it('finds no reference in empty or unknown steps', () => {
    expect(collectTaskReferences([])).toEqual([]);
    expect(
      collectTaskReferences([{ unknown: {} } as unknown as FlowStep]),
    ).toEqual([]);
    expect(
      collectTaskReferences([
        { parallel: { steps: [] } },
        { loop: { type: 'while', while: '=false', steps: [] } },
      ]),
    ).toEqual([]);
  });
});

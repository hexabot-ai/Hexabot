/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../action/action';
import type { Action } from '../action/action.types';
import {
  validateCheckpoint,
  type WaitInfo,
  type WorkflowCheckpoint,
} from '../checkpoint';
import { BaseWorkflowContext } from '../context';
import type { Settings, WorkflowDefinition } from '../dsl.types';
import {
  NonDeterministicWorkflowError,
  WorkflowCheckpointInvalidError,
  WorkflowDefinitionDriftError,
  WorkflowResumeError,
  WorkflowResumeRejectedError,
  WorkflowWaitAmbiguousError,
  WorkflowWaitNotFoundError,
} from '../errors';
import { compileWorkflow } from '../workflow-compiler';
import {
  WorkflowEventEmitter,
  type WorkflowEventEmitterLike,
} from '../workflow-event-emitter';
import { WorkflowRunner } from '../workflow-runner';
import type { WorkflowRunResult } from '../workflow-types';

import { createTaskDefs } from './test-helpers';

class TestContext extends BaseWorkflowContext<
  Record<string, unknown>,
  WorkflowEventEmitter
> {
  public eventEmitter: WorkflowEventEmitterLike<WorkflowEventEmitter> =
    new WorkflowEventEmitter();
}

/** Number of times each action body started, across every attempt. */
let bodyRuns: Record<string, number> = {};
const countRun = (name: string) => {
  bodyRuns[name] = (bodyRuns[name] ?? 0) + 1;
};
const labelSchema = z.object({ label: z.string() });
const replySchema = z.object({ reply: z.string() });
const record = defineAction<
  { label: string },
  { label: string },
  TestContext,
  Settings
>({
  name: 'record',
  inputSchema: labelSchema,
  outputSchema: labelSchema,
  execute: async ({ input }) => {
    countRun('record');

    return { label: input.label };
  },
});
const ask = defineAction<
  { label: string },
  { label: string; reply: string },
  TestContext,
  Settings
>({
  name: 'ask',
  inputSchema: labelSchema,
  outputSchema: z.object({ label: z.string(), reply: z.string() }),
  execute: async ({ input, context }) => {
    countRun('ask');
    const { reply } = replySchema.parse(
      await context.workflow.suspend({
        reason: 'awaiting_reply',
        data: { label: input.label },
      }),
    );

    return { label: input.label, reply };
  },
});
const askTwice = defineAction<
  { label: string },
  { first: string; second: string },
  TestContext,
  Settings
>({
  name: 'ask_twice',
  inputSchema: labelSchema,
  outputSchema: z.object({ first: z.string(), second: z.string() }),
  execute: async ({ context }) => {
    countRun('ask_twice');
    const first = replySchema.parse(
      await context.workflow.suspend({ reason: 'first' }),
    );
    const second = replySchema.parse(
      await context.workflow.suspend({ key: 'confirm', reason: 'second' }),
    );

    return { first: first.reply, second: second.reply };
  },
});
const stamp = defineAction<
  Record<string, never>,
  { at: Date },
  TestContext,
  Settings
>({
  name: 'stamp',
  outputSchema: z.object({ at: z.date() }),
  execute: async () => {
    countRun('stamp');

    return { at: new Date(0) };
  },
});
const actions = { record, ask, ask_twice: askTwice, stamp };
const compile = (definition: WorkflowDefinition) =>
  compileWorkflow(definition, { actions });
const noRetries = { retries: { enabled: false } } as Settings;

type Fixture = {
  name: string;
  definition: WorkflowDefinition;
  /** Choose the wait to resolve next; defaults to the first open wait. */
  pick?: (waits: WaitInfo[]) => WaitInfo;
  expectedOutput: Record<string, unknown>;
  expectedResumes: number;
  expectedRuns: Record<string, number>;
};

type Mode = 'in-process' | 'durable';

/**
 * Drive a fixture to completion, answering waits with `r<turn>`.
 *
 * In `durable` mode every suspension goes through a JSON round trip into a
 * brand-new compiled workflow, runner, and context: nothing in memory
 * survives from one turn to the next.
 */
const drive = async (fixture: Fixture, mode: Mode) => {
  bodyRuns = {};

  let runner = new WorkflowRunner(compile(fixture.definition));
  let result: WorkflowRunResult = await runner.start({
    inputData: {},
    context: new TestContext({}),
  });
  let turn = 0;

  while (result.status === 'suspended') {
    expect(turn).toBeLessThan(20);
    const wait = (fixture.pick ?? ((waits) => waits[0]))(result.waits);

    if (mode === 'durable') {
      const persisted = JSON.parse(
        JSON.stringify({
          checkpoint: result.checkpoint,
          snapshot: result.snapshot,
        }),
      );
      runner = WorkflowRunner.fromCheckpoint(compile(fixture.definition), {
        checkpoint: persisted.checkpoint,
        snapshot: persisted.snapshot,
        context: new TestContext({}),
      });
    }

    result = await runner.resume({
      waitId: wait.waitId,
      resumeData: { reply: `r${turn}` },
    });
    turn += 1;
  }

  if (result.status === 'failed') {
    throw result.error;
  }

  return { output: result.output, resumes: turn, runs: { ...bodyRuns } };
};
const fixtures: Fixture[] = [
  {
    name: 'sequential steps',
    definition: {
      defs: createTaskDefs({
        first: { action: 'record', inputs: { label: 'a' } },
        question: { action: 'ask', inputs: { label: 'b' } },
        last: { action: 'record', inputs: { label: 'c' } },
      }),
      flow: [{ do: 'first' }, { do: 'question' }, { do: 'last' }],
      outputs: {
        first: '=$output.first.label',
        reply: '=$output.question.reply',
        last: '=$output.last.label',
      },
    },
    expectedOutput: { first: 'a', reply: 'r0', last: 'c' },
    expectedResumes: 1,
    expectedRuns: { record: 2, ask: 2 },
  },
  {
    name: 'output values that are not plain JSON',
    definition: {
      defs: createTaskDefs({
        clock: { action: 'stamp' },
        question: { action: 'ask', inputs: { label: 'q' } },
      }),
      flow: [{ do: 'clock' }, { do: 'question' }],
      outputs: { at: '=$output.clock.at' },
    },
    // Both modes resume from what a host stores: the Date as an ISO string.
    expectedOutput: { at: '1970-01-01T00:00:00.000Z' },
    expectedResumes: 1,
    expectedRuns: { stamp: 1, ask: 2 },
  },
  {
    name: 'conditional branch',
    definition: {
      defs: createTaskDefs({
        question: { action: 'ask', inputs: { label: 'q' } },
        skipped: { action: 'record', inputs: { label: 'never' } },
        after: {
          action: 'record',
          inputs: { label: '=$output.question.reply' },
        },
      }),
      flow: [
        {
          conditional: {
            when: [
              { condition: '=true', steps: [{ do: 'question' }] },
              { else: true, steps: [{ do: 'skipped' }] },
            ],
          },
        },
        { do: 'after' },
      ],
      outputs: { after: '=$output.after.label' },
    },
    expectedOutput: { after: 'r0' },
    expectedResumes: 1,
    expectedRuns: { record: 1, ask: 2 },
  },
  {
    name: 'for_each accumulator reading $iteration.item',
    definition: {
      defs: createTaskDefs({
        question: { action: 'ask', inputs: { label: '=$iteration.item' } },
      }),
      flow: [
        {
          loop: {
            type: 'for_each',
            name: 'items',
            for_each: { item: 'item', in: '=["a", "b", "c"]' },
            accumulate: {
              as: 'acc',
              initial: [],
              merge:
                '=$append($accumulator, [$output.question.label & ":" & $output.question.reply])',
            },
            steps: [{ do: 'question' }],
          },
        },
      ],
      outputs: { acc: '=$output.items.acc' },
    },
    expectedOutput: { acc: ['a:r0', 'b:r1', 'c:r2'] },
    expectedResumes: 3,
    expectedRuns: { ask: 6 },
  },
  {
    name: 'nested for_each and while loops',
    definition: {
      defs: createTaskDefs({
        question: {
          action: 'ask',
          inputs: { label: '="q" & $string($iteration.index)' },
        },
        done: { action: 'record', inputs: { label: 'done' } },
      }),
      flow: [
        {
          loop: {
            type: 'for_each',
            name: 'outer',
            for_each: { item: 'item', in: '=["a", "b"]' },
            accumulate: {
              as: 'acc',
              initial: [],
              merge:
                '=$append($accumulator, [$iteration.item & "=" & $join($output.inner.replies, "+")])',
            },
            steps: [
              {
                loop: {
                  type: 'while',
                  name: 'inner',
                  while: '=$count($accumulator) < 2',
                  accumulate: {
                    as: 'replies',
                    initial: [],
                    merge: '=$append($accumulator, [$output.question.reply])',
                  },
                  steps: [{ do: 'question' }],
                },
              },
            ],
          },
        },
        { do: 'done' },
      ],
      outputs: { acc: '=$output.outer.acc' },
    },
    expectedOutput: { acc: ['a=r0+r1', 'b=r2+r3'] },
    expectedResumes: 4,
    expectedRuns: { ask: 8, record: 1 },
  },
  {
    name: 'action with two suspend points',
    definition: {
      defs: createTaskDefs({
        confirm: { action: 'ask_twice', inputs: { label: 'x' } },
        after: { action: 'record', inputs: { label: 'after' } },
      }),
      flow: [{ do: 'confirm' }, { do: 'after' }],
      outputs: {
        first: '=$output.confirm.first',
        second: '=$output.confirm.second',
      },
    },
    expectedOutput: { first: 'r0', second: 'r1' },
    expectedResumes: 2,
    expectedRuns: { ask_twice: 3, record: 1 },
  },
  ...(['first', 'last'] as const).map(
    (order): Fixture => ({
      name: `parallel wait_all with two waits resumed ${order} first`,
      definition: {
        defs: createTaskDefs({
          ask_a: { action: 'ask', inputs: { label: 'a' } },
          middle: { action: 'record', inputs: { label: 'middle' } },
          ask_b: { action: 'ask', inputs: { label: 'b' } },
          after: { action: 'record', inputs: { label: 'after' } },
        }),
        flow: [
          {
            parallel: {
              strategy: 'wait_all',
              steps: [{ do: 'ask_a' }, { do: 'middle' }, { do: 'ask_b' }],
            },
          },
          { do: 'after' },
        ],
        outputs: {
          a: '=$output.ask_a.reply',
          middle: '=$output.middle.label',
          b: '=$output.ask_b.reply',
        },
      },
      pick: (waits) => (order === 'first' ? waits[0] : waits[waits.length - 1]),
      expectedOutput:
        order === 'first'
          ? { a: 'r0', middle: 'middle', b: 'r1' }
          : { a: 'r1', middle: 'middle', b: 'r0' },
      expectedResumes: 2,
      expectedRuns: { ask: 4, record: 2 },
    }),
  ),
  {
    name: 'parallel wait_any where a sibling fulfills while another waits',
    definition: {
      defs: createTaskDefs({
        question: { action: 'ask', inputs: { label: 'q' } },
        quick: { action: 'record', inputs: { label: 'quick' } },
      }),
      flow: [
        {
          parallel: {
            strategy: 'wait_any',
            steps: [{ do: 'question' }, { do: 'quick' }],
          },
        },
      ],
      outputs: {
        quick: '=$output.quick.label',
        question: '=$exists($output.question)',
      },
    },
    expectedOutput: { quick: 'quick', question: false },
    expectedResumes: 0,
    expectedRuns: { ask: 1, record: 1 },
  },
  {
    name: 'parallel wait_any where the first resolved wait wins',
    definition: {
      defs: createTaskDefs({
        ask_a: { action: 'ask', inputs: { label: 'a' } },
        ask_b: { action: 'ask', inputs: { label: 'b' } },
      }),
      flow: [
        {
          parallel: {
            strategy: 'wait_any',
            steps: [{ do: 'ask_a' }, { do: 'ask_b' }],
          },
        },
      ],
      outputs: {
        b: '=$output.ask_b.reply',
        a: '=$exists($output.ask_a)',
      },
    },
    pick: (waits) => waits[1],
    expectedOutput: { b: 'r0', a: false },
    expectedResumes: 1,
    expectedRuns: { ask: 3 },
  },
  {
    name: 'loop inside parallel inside loop',
    definition: {
      defs: createTaskDefs({
        question: { action: 'ask', inputs: { label: '=$iteration.item' } },
        side: {
          action: 'record',
          inputs: { label: '="side-" & $string($iteration.item)' },
        },
      }),
      flow: [
        {
          loop: {
            type: 'for_each',
            name: 'outer',
            for_each: { item: 'n', in: '=[1, 2]' },
            accumulate: {
              as: 'acc',
              initial: [],
              merge:
                '=$append($accumulator, [$output.side.label & ":" & $output.question.reply])',
            },
            steps: [
              {
                parallel: {
                  strategy: 'wait_all',
                  steps: [
                    {
                      loop: {
                        type: 'for_each',
                        name: 'inner',
                        for_each: { item: 'letter', in: '=["a", "b"]' },
                        steps: [{ do: 'question' }],
                      },
                    },
                    { do: 'side' },
                  ],
                },
              },
            ],
          },
        },
      ],
      outputs: { acc: '=$output.outer.acc' },
    },
    expectedOutput: { acc: ['side-1:r1', 'side-2:r3'] },
    expectedResumes: 4,
    expectedRuns: { ask: 8, record: 2 },
  },
  {
    name: '$accumulator of a finished loop read after a suspension',
    definition: {
      defs: createTaskDefs({
        tick: {
          action: 'record',
          inputs: { label: '="n" & $string($iteration.item)' },
        },
        question: { action: 'ask', inputs: { label: 'q' } },
        total: {
          action: 'record',
          inputs: { label: '=$string($accumulator)' },
        },
      }),
      flow: [
        {
          loop: {
            type: 'for_each',
            for_each: { item: 'n', in: '=[1, 2, 3]' },
            accumulate: { as: 'count', initial: 0, merge: '=$accumulator + 1' },
            steps: [{ do: 'tick' }],
          },
        },
        { do: 'question' },
        { do: 'total' },
      ],
      outputs: { total: '=$output.total.label' },
    },
    expectedOutput: { total: '3' },
    expectedResumes: 1,
    expectedRuns: { record: 4, ask: 2 },
  },
  {
    name: '$accumulator of an inner loop read after a suspension in the outer loop',
    definition: {
      defs: createTaskDefs({
        tick: { action: 'record', inputs: { label: 'tick' } },
        question: { action: 'ask', inputs: { label: 'q' } },
        after: {
          action: 'record',
          inputs: { label: '=$string($accumulator)' },
        },
      }),
      flow: [
        {
          loop: {
            type: 'for_each',
            name: 'outer',
            for_each: { item: 'item', in: '=["a", "b"]' },
            accumulate: {
              as: 'seen',
              initial: [],
              merge: '=$append($accumulator, [$output.after.label])',
            },
            steps: [
              {
                loop: {
                  type: 'for_each',
                  for_each: { item: 'n', in: '=[1, 2]' },
                  accumulate: {
                    as: 'count',
                    initial: 10,
                    merge: '=$accumulator + 1',
                  },
                  steps: [{ do: 'tick' }],
                },
              },
              { do: 'question' },
              { do: 'after' },
            ],
          },
        },
      ],
      outputs: { seen: '=$output.outer.seen' },
    },
    // Steps after the inner loop see its result, not the outer accumulator.
    expectedOutput: { seen: ['12', '12'] },
    expectedResumes: 2,
    expectedRuns: { record: 6, ask: 4 },
  },
];

describe('checkpoint durability', () => {
  it.each(fixtures)(
    '$name behaves the same in process and across fresh runners',
    async (fixture) => {
      const inProcess = await drive(fixture, 'in-process');
      const durable = await drive(fixture, 'durable');

      expect(inProcess.output).toEqual(fixture.expectedOutput);
      expect(durable.output).toEqual(inProcess.output);
      expect(inProcess.resumes).toBe(fixture.expectedResumes);
      expect(durable.resumes).toBe(fixture.expectedResumes);
      // Completed steps and parallel siblings run exactly once; a suspended
      // body runs once, then once more per resolved wait.
      expect(inProcess.runs).toEqual(fixture.expectedRuns);
      expect(durable.runs).toEqual(fixture.expectedRuns);
    },
  );
});

describe('checkpoint validation', () => {
  const definition: WorkflowDefinition = {
    defs: createTaskDefs({
      first: { action: 'record', inputs: { label: 'a' } },
      question: { action: 'ask', inputs: { label: '=$iteration.item' } },
    }),
    flow: [
      { do: 'first' },
      {
        loop: {
          type: 'for_each',
          name: 'items',
          for_each: { item: 'item', in: '=["a", "b"]' },
          until: '=false',
          steps: [{ do: 'question' }],
        },
      },
    ],
    outputs: { reply: '=$output.question.reply' },
  };
  const suspend = async (source: WorkflowDefinition = definition) => {
    const runner = new WorkflowRunner(compile(source));
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    if (result.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }

    bodyRuns = {};

    return JSON.parse(JSON.stringify(result.checkpoint)) as WorkflowCheckpoint;
  };
  const expectRejected = <E extends Error>(
    checkpoint: unknown,
    type: new (...args: any[]) => E,
    compiled = compile(definition),
    waitId?: string,
  ): E => {
    const result = validateCheckpoint(compiled, checkpoint, {
      waitId,
    });
    if (result.ok) {
      throw new Error('Expected the checkpoint to be rejected');
    }
    expect(result.error).toBeInstanceOf(type);
    if (waitId === undefined) {
      expect(() =>
        WorkflowRunner.fromCheckpoint(compiled, {
          checkpoint,
          context: new TestContext({}),
        }),
      ).toThrow(type);
    }
    expect(bodyRuns).toEqual({});

    return result.error as E;
  };

  it('accepts a checkpoint and a wait it holds', async () => {
    const checkpoint = await suspend();
    const result = validateCheckpoint(compile(definition), checkpoint, {
      waitId: checkpoint.waits[0].waitId,
    });

    expect(result.ok).toBe(true);
    expect(checkpoint.waits.map((wait) => wait.step.id)).toEqual([
      '1.items.0:question[0]',
    ]);
  });

  it('reports a missing checkpoint', () => {
    expect(expectRejected(undefined, WorkflowCheckpointInvalidError).code).toBe(
      'missing',
    );
  });

  it('reports an unsupported version', async () => {
    const checkpoint = { ...(await suspend()), version: 2 };

    expect(
      expectRejected(checkpoint, WorkflowCheckpointInvalidError).code,
    ).toBe('unsupported_version');
  });

  it('reports a malformed checkpoint with its issues', async () => {
    const checkpoint = await suspend();
    const broken = { ...checkpoint, root: { kind: 'sequence', index: -1 } };
    const error = expectRejected(broken, WorkflowCheckpointInvalidError);

    expect(error.code).toBe('malformed');
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  it('reports frames that do not line up with the flow', async () => {
    const checkpoint = await suspend();
    const broken = {
      ...checkpoint,
      root: { ...checkpoint.root, index: 0 },
    };
    const error = expectRejected(broken, WorkflowCheckpointInvalidError);

    expect(error.code).toBe('structure');
    expect(error.path).toEqual(['root', 0]);
  });

  it('reports a waits index that disagrees with the frames', async () => {
    const checkpoint = await suspend();
    const broken = {
      ...checkpoint,
      waits: [{ ...checkpoint.waits[0], waitId: 'other@index:1' }],
    };

    expect(expectRejected(broken, WorkflowCheckpointInvalidError).code).toBe(
      'structure',
    );
  });

  describe('frames checked against the compiled flow', () => {
    const nested: WorkflowDefinition = {
      defs: createTaskDefs({
        ask_a: { action: 'ask', inputs: { label: 'a' } },
        ask_b: { action: 'ask', inputs: { label: 'b' } },
      }),
      flow: [
        {
          conditional: {
            when: [
              {
                condition: '=true',
                steps: [
                  {
                    loop: {
                      type: 'for_each',
                      name: 'outer',
                      for_each: { item: 'item', in: '=["x", "y"]' },
                      steps: [
                        {
                          parallel: {
                            strategy: 'wait_all',
                            steps: [
                              { do: 'ask_a' },
                              {
                                loop: {
                                  type: 'while',
                                  name: 'inner',
                                  while: '=$count($accumulator) < 1',
                                  accumulate: {
                                    as: 'seen',
                                    initial: [],
                                    merge: '=$append($accumulator, [1])',
                                  },
                                  steps: [{ do: 'ask_b' }],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
      outputs: {},
    };
    // root -> conditional -> for_each -> parallel -> [task, while -> task]
    const conditionalFrame = (checkpoint: any) => checkpoint.root.child;
    const forEachFrame = (checkpoint: any) =>
      conditionalFrame(checkpoint).child.child;
    const parallelFrame = (checkpoint: any) =>
      forEachFrame(checkpoint).child.child;
    const loopPath = ['root', 0, 'branch', 0, 0];
    const parallelPath = [...loopPath, 0, 0];

    it.each<[string, (checkpoint: any) => void, Array<string | number>]>([
      [
        'a sequence position out of range',
        (checkpoint) => (checkpoint.root.index = 5),
        ['root'],
      ],
      [
        'a conditional branch that does not exist',
        (checkpoint) => (conditionalFrame(checkpoint).branchIndex = 3),
        ['root', 0],
      ],
      [
        'a for_each iteration past its items',
        (checkpoint) => (forEachFrame(checkpoint).index = 2),
        loopPath,
      ],
      [
        'a for_each frame without items',
        (checkpoint) => delete forEachFrame(checkpoint).items,
        loopPath,
      ],
      [
        'a while frame carrying items',
        (checkpoint) =>
          (parallelFrame(checkpoint).branches[1].child.items = []),
        [...parallelPath, 'parallel', 1],
      ],
      [
        'a parallel branch count that differs from the flow',
        (checkpoint) => parallelFrame(checkpoint).branches.pop(),
        parallelPath,
      ],
      [
        'a parallel frame without a suspended branch',
        (checkpoint) => {
          parallelFrame(checkpoint).branches = [
            { status: 'fulfilled', outputDelta: {} },
            { status: 'fulfilled', outputDelta: {} },
          ];
        },
        parallelPath,
      ],
      [
        'two frames holding the same wait',
        (checkpoint) => {
          const [first, second] = parallelFrame(checkpoint).branches;
          second.child.child.child.wait.waitId = first.child.wait.waitId;
          checkpoint.waits[1].waitId = first.child.wait.waitId;
        },
        ['waits'],
      ],
    ])('reports %s', async (_label, tamper, path) => {
      const checkpoint = await suspend(nested);
      tamper(checkpoint);
      const error = expectRejected(
        checkpoint,
        WorkflowCheckpointInvalidError,
        compile(nested),
      );

      expect(error.code).toBe('structure');
      expect(error.path).toEqual(path);
    });

    it('reports a wait_any block that records a fulfilled branch', async () => {
      const race: WorkflowDefinition = {
        defs: createTaskDefs({
          ask_a: { action: 'ask', inputs: { label: 'a' } },
          ask_b: { action: 'ask', inputs: { label: 'b' } },
        }),
        flow: [
          {
            parallel: {
              strategy: 'wait_any',
              steps: [{ do: 'ask_a' }, { do: 'ask_b' }],
            },
          },
        ],
        outputs: {},
      };
      const checkpoint: any = await suspend(race);
      checkpoint.root.child.branches[0] = {
        status: 'fulfilled',
        outputDelta: {},
      };
      checkpoint.waits = checkpoint.waits.slice(1);
      const error = expectRejected(
        checkpoint,
        WorkflowCheckpointInvalidError,
        compile(race),
      );

      expect(error.code).toBe('structure');
      expect(error.message).toMatch(/cannot record a fulfilled branch/);
    });
  });

  it.each([
    [
      'a renamed task',
      (next: WorkflowDefinition) => {
        next.defs = createTaskDefs({
          first: { action: 'record', inputs: { label: 'a' } },
          prompt: { action: 'ask', inputs: { label: '=$iteration.item' } },
        });
        (next.flow[1] as any).loop.steps = [{ do: 'prompt' }];
      },
    ],
    [
      'a step inserted before the wait',
      (next: WorkflowDefinition) => {
        next.flow.unshift({ do: 'first' });
      },
    ],
    [
      'a changed until expression',
      (next: WorkflowDefinition) => {
        (next.flow[1] as any).loop.until = '=true';
      },
    ],
  ])('reports drift after %s', async (_label, mutate) => {
    const checkpoint = await suspend();
    const next = structuredClone(definition);
    mutate(next);

    expectRejected(checkpoint, WorkflowDefinitionDriftError, compile(next));
  });

  it('reports a wait that is not open', async () => {
    const checkpoint = await suspend();
    const error = expectRejected(
      checkpoint,
      WorkflowWaitNotFoundError,
      compile(definition),
      'missing@index:1',
    );

    expect(error.openWaitIds).toEqual([checkpoint.waits[0].waitId]);

    const runner = WorkflowRunner.fromCheckpoint(compile(definition), {
      checkpoint,
      context: new TestContext({}),
    });
    await expect(
      runner.resume({ waitId: 'missing@index:1', resumeData: {} }),
    ).rejects.toBeInstanceOf(WorkflowWaitNotFoundError);
    expect(bodyRuns).toEqual({});

    // The rejected call leaves the run suspended on the same open wait.
    expect(runner.getStatus()).toBe('suspended');
    const resumed = await runner.resume({
      waitId: checkpoint.waits[0].waitId,
      resumeData: { reply: 'a' },
    });

    expect(resumed.status).toBe('suspended');
    if (resumed.status === 'suspended') {
      expect(resumed.waits[0].step.id).toBe('1.items.0:question[1]');
    }
  });
});

describe('suspended action bodies', () => {
  it('re-resolves suspend results when a resumed body is retried', async () => {
    let failures = 0;
    const flaky = defineAction<
      Record<string, never>,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'flaky',
      outputSchema: replySchema,
      execute: async ({ context }) => {
        countRun('flaky');
        const resumed = replySchema.parse(await context.workflow.suspend());
        if (failures === 0) {
          failures += 1;
          throw new Error('transient');
        }

        return resumed;
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          step: {
            action: 'flaky',
            settings: {
              retries: {
                enabled: true,
                max_attempts: 2,
                backoff_ms: 0,
                max_delay_ms: 0,
                jitter: 0,
                multiplier: 1,
              },
            },
          },
        }),
        flow: [{ do: 'step' }],
        outputs: { reply: '=$output.step.reply' },
      },
      { actions: { flaky } },
    );
    bodyRuns = {};
    const runner = new WorkflowRunner(compiled);
    const started = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    expect(started.status).toBe('suspended');

    const resumed = await runner.resume({ resumeData: { reply: 'ok' } });

    expect(resumed.status).toBe('finished');
    if (resumed.status === 'finished') {
      expect(resumed.output).toEqual({ reply: 'ok' });
    }
    // Start, then the failing re-run, then its retry.
    expect(bodyRuns).toEqual({ flaky: 3 });
  });

  it('stops the timeout of a suspended body', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const compiled = compileWorkflow(
        {
          defs: createTaskDefs({
            question: {
              action: 'ask',
              inputs: { label: 'q' },
              settings: { timeout_ms: 30 },
            },
          }),
          flow: [{ do: 'question' }],
          outputs: { reply: '=$output.question.reply' },
        },
        { actions },
      );
      const runner = new WorkflowRunner(compiled);
      await runner.start({ inputData: {}, context: new TestContext({}) });
      await new Promise((resolve) => setTimeout(resolve, 80));

      const resumed = await runner.resume({ resumeData: { reply: 'late' } });

      expect(resumed.status).toBe('finished');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('fails the run when a branch fails while a sibling is suspended', async () => {
    const boom = defineAction<
      Record<string, never>,
      never,
      TestContext,
      Settings
    >({
      name: 'boom',
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('boom');
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          question: { action: 'ask', inputs: { label: 'q' } },
          explode: { action: 'boom', settings: noRetries },
        }),
        flow: [
          {
            parallel: {
              strategy: 'wait_all',
              steps: [{ do: 'question' }, { do: 'explode' }],
            },
          },
        ],
        outputs: {},
      },
      { actions: { ...actions, boom } },
    );
    const runner = new WorkflowRunner(compiled);
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect((result.error as Error).message).toBe('boom');
      expect(result.snapshot.actions['0.parallel.0:question']).toMatchObject({
        status: 'cancelled',
      });
    }
  });

  it('requires a waitId when several waits are open', async () => {
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          ask_a: { action: 'ask', inputs: { label: 'a' } },
          ask_b: { action: 'ask', inputs: { label: 'b' } },
        }),
        flow: [
          {
            parallel: {
              strategy: 'wait_all',
              steps: [{ do: 'ask_a' }, { do: 'ask_b' }],
            },
          },
        ],
        outputs: {},
      },
      { actions },
    );
    const runner = new WorkflowRunner(compiled);
    const started = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(started.status).toBe('suspended');
    if (started.status !== 'suspended') {
      return;
    }
    expect(started.waits.map((wait) => wait.waitId)).toEqual([
      '0.parallel.0:ask_a@index:1',
      '0.parallel.1:ask_b@index:1',
    ]);
    const ambiguous = runner.resume({ resumeData: {} });
    await expect(ambiguous).rejects.toThrow(/pass a waitId/);
    await expect(ambiguous).rejects.toBeInstanceOf(WorkflowWaitAmbiguousError);
    await expect(
      runner.resume({ waitId: 'nope', resumeData: {} }),
    ).rejects.toBeInstanceOf(WorkflowWaitNotFoundError);
  });

  it('fails instead of suspending when the run state is not JSON-serializable', async () => {
    const counter = defineAction<
      Record<string, never>,
      { total: bigint },
      TestContext,
      Settings
    >({
      name: 'counter',
      outputSchema: z.object({ total: z.bigint() }),
      execute: async () => ({ total: BigInt(1) }),
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          count: { action: 'counter' },
          question: { action: 'ask', inputs: { label: 'q' } },
        }),
        flow: [{ do: 'count' }, { do: 'question' }],
        outputs: {},
      },
      { actions: { ...actions, counter } },
    );
    const runner = new WorkflowRunner(compiled);
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect((result.error as Error).message).toMatch(
        /^Cannot checkpoint the suspended run: its state is not JSON-serializable/,
      );
    }
    expect(runner.getCheckpoint()).toBeUndefined();
  });

  it('resumes a body with the inputs recorded when it suspended', async () => {
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        question: { action: 'ask', inputs: { label: '=$context.topic' } },
      }),
      flow: [{ do: 'question' }],
      outputs: { label: '=$output.question.label' },
    };
    const started = await new WorkflowRunner(compile(definition)).start({
      inputData: {},
      context: new TestContext({ topic: 'billing' }),
    });
    if (started.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }

    // Re-evaluating the inputs against the new context would read "shipping".
    const restored = WorkflowRunner.fromCheckpoint(compile(definition), {
      checkpoint: JSON.parse(JSON.stringify(started.checkpoint)),
      context: new TestContext({ topic: 'shipping' }),
    });
    const resumed = await restored.resume({ resumeData: { reply: 'ok' } });

    expect(resumed).toMatchObject({
      status: 'finished',
      output: { label: 'billing' },
    });
  });

  it('keeps the suspend position of a body that runs another action', async () => {
    const lookup = defineAction<
      Record<string, never>,
      string,
      TestContext,
      Settings
    >({
      name: 'lookup',
      outputSchema: z.string(),
      execute: async () => 'found',
    });
    const wizard = defineAction<
      Record<string, never>,
      { first: string; second: string },
      TestContext,
      Settings
    >({
      name: 'wizard',
      outputSchema: z.object({ first: z.string(), second: z.string() }),
      execute: async ({ context }) => {
        const first = replySchema.parse(await context.workflow.suspend());
        // Its attempt must not rewind the suspend cursor of this step.
        await lookup.run({}, context);
        const second = replySchema.parse(await context.workflow.suspend());

        return { first: first.reply, second: second.reply };
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({ steps: { action: 'wizard' } }),
        flow: [{ do: 'steps' }],
        outputs: {
          first: '=$output.steps.first',
          second: '=$output.steps.second',
        },
      },
      { actions: { wizard, lookup } },
    );
    const runner = new WorkflowRunner(compiled);
    await runner.start({ inputData: {}, context: new TestContext({}) });

    const middle = await runner.resume({ resumeData: { reply: 'r0' } });

    expect(middle.status).toBe('suspended');
    if (middle.status === 'suspended') {
      expect(middle.waits[0].suspendKey).toBe('index:2');
    }
    await expect(
      runner.resume({ resumeData: { reply: 'r1' } }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { first: 'r0', second: 'r1' },
    });
  });

  it('re-resolves the suspends of a nested action run that is retried', async () => {
    let failures = 0;
    const confirm = defineAction<
      Record<string, never>,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'confirm',
      outputSchema: replySchema,
      execute: async ({ context }) => {
        countRun('confirm');
        const reply = replySchema.parse(
          await context.workflow.suspend({ reason: 'confirm' }),
        );
        if (failures === 0) {
          failures += 1;
          throw new Error('transient');
        }

        return reply;
      },
    });
    const twoAttempts = {
      retries: {
        enabled: true,
        max_attempts: 2,
        backoff_ms: 0,
        max_delay_ms: 0,
        jitter: 0,
        multiplier: 1,
      },
    };
    const wizard = defineAction<
      Record<string, never>,
      { first: string; second: string },
      TestContext,
      Settings
    >({
      name: 'wizard',
      outputSchema: z.object({ first: z.string(), second: z.string() }),
      execute: async ({ context }) => {
        const first = replySchema.parse(
          await context.workflow.suspend({ reason: 'first' }),
        );
        // Its retry starts over from its own first suspend, `index:2`.
        const second = await confirm.run({}, context, twoAttempts);

        return { first: first.reply, second: second.reply };
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({ steps: { action: 'wizard' } }),
        flow: [{ do: 'steps' }],
        outputs: {
          first: '=$output.steps.first',
          second: '=$output.steps.second',
        },
      },
      { actions: { wizard, confirm } },
    );
    bodyRuns = {};
    const runner = new WorkflowRunner(compiled);
    await runner.start({ inputData: {}, context: new TestContext({}) });
    await runner.resume({ resumeData: { reply: 'r0' } });

    await expect(
      runner.resume({ resumeData: { reply: 'r1' } }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { first: 'r0', second: 'r1' },
    });
    // Reached on the first resume, then the failing run and its retry.
    expect(bodyRuns).toEqual({ confirm: 3 });
  });

  it('re-resolves suspend results of a retried action run behind a wrapper', async () => {
    let failures = 0;
    const flaky = defineAction<
      Record<string, never>,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'flaky',
      outputSchema: replySchema,
      execute: async ({ context }) => {
        const resumed = replySchema.parse(await context.workflow.suspend());
        if (failures === 0) {
          failures += 1;
          throw new Error('transient');
        }

        return resumed;
      },
    });
    // A decorator around the action, e.g. to add logging or metrics.
    const wrapped: Action<Record<string, never>, { reply: string }> = {
      name: 'wrapped',
      description: 'Logs around flaky',
      inputSchema: flaky.inputSchema,
      outputSchema: flaky.outputSchema,
      settingSchema: flaky.settingSchema,
      execute: (args) => flaky.execute(args as never),
      parseInput: (payload) => flaky.parseInput(payload),
      parseOutput: (payload) => flaky.parseOutput(payload),
      parseSettings: (payload) => flaky.parseSettings(payload),
      run: (payload, context, settings, bindings, signal) =>
        flaky.run(payload, context as TestContext, settings, bindings, signal),
    };
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          step: {
            action: 'wrapped',
            settings: {
              retries: {
                enabled: true,
                max_attempts: 2,
                backoff_ms: 0,
                max_delay_ms: 0,
                jitter: 0,
                multiplier: 1,
              },
            },
          },
        }),
        flow: [{ do: 'step' }],
        outputs: { reply: '=$output.step.reply' },
      },
      { actions: { wrapped: wrapped as Action } },
    );
    const runner = new WorkflowRunner(compiled);
    await runner.start({ inputData: {}, context: new TestContext({}) });

    await expect(
      runner.resume({ resumeData: { reply: 'ok' } }),
    ).resolves.toMatchObject({ status: 'finished', output: { reply: 'ok' } });
  });

  it('fails when a body reuses a suspend key', async () => {
    const reusing = defineAction<
      Record<string, never>,
      unknown,
      TestContext,
      Settings
    >({
      name: 'reusing',
      execute: async ({ context }) => {
        await context.workflow.suspend({ key: 'reply' });

        return context.workflow.suspend({ key: 'reply' });
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          step: { action: 'reusing', settings: noRetries },
        }),
        flow: [{ do: 'step' }],
        outputs: {},
      },
      { actions: { reusing } },
    );
    const runner = new WorkflowRunner(compiled);
    await runner.start({ inputData: {}, context: new TestContext({}) });

    // Without the check, the second call would resolve with the first answer.
    const resumed = await runner.resume({ resumeData: 'first' });

    expect(resumed.status).toBe('failed');
    if (resumed.status === 'failed') {
      expect((resumed.error as Error).message).toMatch(
        /key "reply" is used more than once in step "0:step"/,
      );
    }
  });

  it('fails when a resumed body completes without reaching its suspension', async () => {
    let suspends = true;
    const optional = defineAction<
      Record<string, never>,
      unknown,
      TestContext,
      Settings
    >({
      name: 'optional',
      execute: async ({ context }) =>
        suspends ? context.workflow.suspend({ reason: 'maybe' }) : 'skipped',
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({ step: { action: 'optional' } }),
        flow: [{ do: 'step' }],
        outputs: {},
      },
      { actions: { optional } },
    );
    const runner = new WorkflowRunner(compiled);
    await runner.start({ inputData: {}, context: new TestContext({}) });
    suspends = false;

    const resumed = await runner.resume({ resumeData: {} });

    expect(resumed.status).toBe('failed');
    if (resumed.status === 'failed') {
      expect(resumed.error).toBeInstanceOf(NonDeterministicWorkflowError);
      expect(resumed.snapshot.actions['0:step']).toMatchObject({
        status: 'failed',
      });
    }
  });

  it('fails when a resumed body reaches a new suspension before its own', async () => {
    let asksFirst = false;
    const growing = defineAction<
      Record<string, never>,
      unknown,
      TestContext,
      Settings
    >({
      name: 'growing',
      execute: async ({ context }) => {
        if (asksFirst) {
          await context.workflow.suspend({ key: 'intro' });
        }

        return context.workflow.suspend({ key: 'answer' });
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          step: { action: 'growing', settings: noRetries },
        }),
        flow: [{ do: 'step' }],
        outputs: {},
      },
      { actions: { growing } },
    );
    const runner = new WorkflowRunner(compiled);
    await runner.start({ inputData: {}, context: new TestContext({}) });
    asksFirst = true;

    const resumed = await runner.resume({ resumeData: {} });

    expect(resumed.status).toBe('failed');
    if (resumed.status === 'failed') {
      expect(resumed.error).toBeInstanceOf(NonDeterministicWorkflowError);
      expect((resumed.error as Error).message).toMatch(
        /reached unexpected suspend "key:intro" before expected "key:answer"/,
      );
    }
  });

  it('fails when a resumed body reaches its suspension with a different reason', async () => {
    let reason = 'first';
    const drifting = defineAction<
      Record<string, never>,
      unknown,
      TestContext,
      Settings
    >({
      name: 'drifting',
      execute: async ({ context }) => {
        countRun('drifting');

        return context.workflow.suspend({ reason });
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          step: {
            action: 'drifting',
            settings: {
              retries: {
                enabled: true,
                max_attempts: 3,
                backoff_ms: 0,
                max_delay_ms: 0,
                jitter: 0,
                multiplier: 1,
              },
            },
          },
        }),
        flow: [{ do: 'step' }],
        outputs: {},
      },
      { actions: { drifting } },
    );
    bodyRuns = {};
    const runner = new WorkflowRunner(compiled);
    await runner.start({ inputData: {}, context: new TestContext({}) });
    reason = 'second';

    const resumed = await runner.resume({ resumeData: {} });

    expect(resumed.status).toBe('failed');
    if (resumed.status === 'failed') {
      expect(resumed.error).toBeInstanceOf(NonDeterministicWorkflowError);
    }
    // A retry would replay the same body into the same mismatch.
    expect(bodyRuns).toEqual({ drifting: 2 });
  });
});

describe('events and snapshots', () => {
  /** Record `<event> <step id>` for the step events of a context. */
  const recordStepEvents = (context: TestContext) => {
    const log: string[] = [];

    (
      ['hook:step:start', 'hook:step:resumed', 'hook:step:cancelled'] as const
    ).forEach((event) =>
      context.eventEmitter.on(event, ({ step }) => {
        log.push(`${event} ${step.id}`);
      }),
    );

    return log;
  };
  const race: WorkflowDefinition = {
    defs: createTaskDefs({
      ask_a: { action: 'ask', inputs: { label: 'a' } },
      ask_b: { action: 'ask', inputs: { label: 'b' } },
    }),
    flow: [
      {
        parallel: {
          strategy: 'wait_any',
          steps: [{ do: 'ask_a' }, { do: 'ask_b' }],
        },
      },
    ],
    outputs: { b: '=$output.ask_b.reply' },
  };

  it('publishes every open wait when the run suspends', async () => {
    const context = new TestContext({});
    const suspended = jest.fn();
    context.eventEmitter.on('hook:workflow:suspended', suspended);

    const started = await new WorkflowRunner(compile(race), {
      runId: 'run-1',
    }).start({ inputData: {}, context });
    if (started.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }

    expect(started.waits).toHaveLength(2);
    expect(suspended).toHaveBeenCalledTimes(1);
    expect(suspended).toHaveBeenCalledWith({
      runId: 'run-1',
      waits: started.waits,
    });
  });

  it('resumes the resolved step and cancels the parked losers of wait_any', async () => {
    const context = new TestContext({});
    const log = recordStepEvents(context);
    const runner = new WorkflowRunner(compile(race));
    const started = await runner.start({ inputData: {}, context });
    if (started.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }
    log.length = 0;

    const resumed = await runner.resume({
      waitId: started.waits[1].waitId,
      resumeData: { reply: 'b' },
    });

    expect(resumed.status).toBe('finished');
    expect(log).toContain('hook:step:resumed 0.parallel.1:ask_b');
    expect(log).toContain('hook:step:cancelled 0.parallel.0:ask_a');
    expect(log).not.toContain('hook:step:start 0.parallel.1:ask_b');
    expect(resumed.snapshot.actions).toMatchObject({
      '0.parallel.0:ask_a': { status: 'cancelled' },
      '0.parallel.1:ask_b': { status: 'completed' },
    });
    expect(runner.getStepLog()).toMatchObject({
      '0.parallel.0:ask_a': { status: 'cancelled' },
      '0.parallel.1:ask_b': { status: 'completed' },
    });
  });

  it.each(['wait_any', 'wait_all'] as const)(
    'drops the wait of a %s branch that suspends while it is cancelled',
    async (strategy) => {
      const late = defineAction<
        { ticks: number },
        unknown,
        TestContext,
        Settings
      >({
        name: 'late',
        inputSchema: z.object({ ticks: z.number() }),
        execute: async ({ input, context }) => {
          for (let tick = 0; tick < input.ticks; tick += 1) {
            await Promise.resolve();
          }

          return context.workflow.suspend({ reason: 'late' });
        },
      });
      const boom = defineAction<
        Record<string, never>,
        never,
        TestContext,
        Settings
      >({
        name: 'boom',
        execute: async () => {
          throw new Error('boom');
        },
      });
      // wait_any: the sibling wins; wait_all: the sibling fails.
      const sibling =
        strategy === 'wait_any'
          ? { action: 'record', inputs: { label: 'quick' } }
          : { action: 'boom', settings: noRetries };
      const failures: string[] = [];

      // Sweep how long the branch runs before suspending, so that its
      // suspension lands before, during and after the sibling settles.
      for (const lateFirst of [true, false]) {
        for (let ticks = 0; ticks <= 30; ticks += 1) {
          const context = new TestContext({});
          const opened: string[] = [];
          const dropped: string[] = [];
          context.eventEmitter.on('hook:step:suspended', ({ wait }) => {
            opened.push(wait.waitId);
          });
          context.eventEmitter.on('hook:step:cancelled', ({ wait }) => {
            if (wait) {
              dropped.push(wait.waitId);
            }
          });
          const steps = [{ do: 'late' }, { do: 'sibling' }];
          const runner = new WorkflowRunner(
            compileWorkflow(
              {
                defs: createTaskDefs({
                  late: { action: 'late', inputs: { ticks } },
                  sibling,
                }),
                flow: [
                  {
                    parallel: {
                      strategy,
                      steps: lateFirst ? steps : [...steps].reverse(),
                    },
                  },
                ],
                outputs: {},
              },
              { actions: { ...actions, late, boom } },
            ),
          );
          const result = await runner.start({ inputData: {}, context });
          const lateId = `0.parallel.${lateFirst ? 0 : 1}:late`;
          const statuses = [
            result.status,
            result.snapshot.actions[lateId]?.status,
            runner.getStepLog()[lateId]?.status,
          ];

          if (
            result.status !==
              (strategy === 'wait_any' ? 'finished' : 'failed') ||
            statuses.includes('suspended') ||
            dropped.join() !== opened.join()
          ) {
            failures.push(
              `${ticks} ticks, late ${lateFirst ? 'first' : 'last'}: ` +
                `statuses ${statuses.join('/')}, opened [${opened}], dropped [${dropped}]`,
            );
          }
        }
      }

      expect(failures).toEqual([]);
    },
  );

  it('identifies the wait in every wait event, across processes', async () => {
    // What a host keeps per wait, e.g. a notification sent or an expiry timer.
    const tracked = new Map<string, string>();
    const startContext = new TestContext({});
    startContext.eventEmitter.on('hook:step:suspended', ({ wait }) => {
      tracked.set(wait.waitId, 'notified');
    });
    const started = await new WorkflowRunner(compile(race)).start({
      inputData: {},
      context: startContext,
    });
    if (started.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }
    expect([...tracked.keys()]).toEqual(
      started.waits.map((wait) => wait.waitId),
    );

    const stored = JSON.parse(JSON.stringify(started));
    const context = new TestContext({});
    const resumed = jest.fn();
    context.eventEmitter.on('hook:step:resumed', resumed);
    context.eventEmitter.on('hook:step:cancelled', ({ wait }) => {
      if (wait) {
        tracked.set(wait.waitId, 'dropped');
      }
    });
    const runner = WorkflowRunner.fromCheckpoint(compile(race), {
      checkpoint: stored.checkpoint,
      snapshot: stored.snapshot,
      context,
    });
    const [loser, winner] = stored.waits as WaitInfo[];

    await expect(
      runner.resume({ waitId: winner.waitId, resumeData: { reply: 'b' } }),
    ).resolves.toMatchObject({ status: 'finished' });
    expect(resumed).toHaveBeenCalledWith(
      expect.objectContaining({ wait: winner, resumeData: { reply: 'b' } }),
    );
    expect(tracked).toEqual(
      new Map([
        [loser.waitId, 'dropped'],
        [winner.waitId, 'notified'],
      ]),
    );
  });

  it('cancels a wait_any loser whose action is still running', async () => {
    const slow = defineAction<
      Record<string, never>,
      never,
      TestContext,
      Settings
    >({
      name: 'slow',
      execute: ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({
          loser: { action: 'slow' },
          winner: { action: 'record', inputs: { label: 'quick' } },
        }),
        flow: [
          {
            parallel: {
              strategy: 'wait_any',
              steps: [{ do: 'loser' }, { do: 'winner' }],
            },
          },
        ],
        outputs: { label: '=$output.winner.label' },
      },
      { actions: { ...actions, slow } },
    );
    const context = new TestContext({});
    const log = recordStepEvents(context);
    const runner = new WorkflowRunner(compiled);
    const result = await runner.start({ inputData: {}, context });

    expect(result).toMatchObject({
      status: 'finished',
      output: { label: 'quick' },
    });
    expect(result.snapshot.actions['0.parallel.0:loser']).toMatchObject({
      status: 'cancelled',
    });
    expect(runner.getStepLog()['0.parallel.0:loser']).toMatchObject({
      status: 'cancelled',
    });
    expect(log).toContain('hook:step:cancelled 0.parallel.0:loser');
  });
});

describe('runner and context API', () => {
  it('exposes the checkpoint while suspended and clears it once finished', async () => {
    const runner = new WorkflowRunner(
      compile({
        defs: createTaskDefs({
          question: { action: 'ask', inputs: { label: 'q' } },
        }),
        flow: [{ do: 'question' }],
        outputs: {},
      }),
    );
    const started = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    if (started.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }

    expect(runner.getCheckpoint()).toEqual(started.checkpoint);

    await runner.resume({ resumeData: { reply: 'ok' } });

    expect(runner.getCheckpoint()).toBeUndefined();
  });

  it('resolves suspend() with the payload as the checkpoint records it, not as passed', async () => {
    const inspect = defineAction<
      Record<string, never>,
      { reply: unknown },
      TestContext,
      Settings
    >({
      name: 'inspect',
      outputSchema: z.object({ reply: z.unknown() }),
      execute: async ({ context }) => ({
        reply: await context.workflow.suspend(),
      }),
    });
    const runner = new WorkflowRunner(
      compileWorkflow(
        {
          defs: createTaskDefs({
            first: { action: 'inspect' },
            second: { action: 'inspect' },
          }),
          flow: [{ do: 'first' }, { do: 'second' }],
          outputs: { first: '=$output.first', second: '=$output.second' },
        },
        { actions: { inspect } },
      ),
    );
    await runner.start({ inputData: {}, context: new TestContext({}) });

    await runner.resume({ resumeData: { at: new Date(0), note: undefined } });
    const finished = await runner.resume({});

    expect(finished).toMatchObject({
      status: 'finished',
      output: { first: { reply: { at: '1970-01-01T00:00:00.000Z' } } },
    });
    // A resume without payload stays without payload.
    if (finished.status === 'finished') {
      expect(finished.output.second).toEqual({});
    }
  });
});

describe('resume payloads', () => {
  const answerSchema = z.object({
    reply: z.string().refine((reply) => reply !== 'forbidden', 'forbidden'),
    count: z.coerce.number().default(1),
  });
  const answer = defineAction<
    Record<string, never>,
    { reply: string; count: number },
    TestContext,
    Settings
  >({
    name: 'answer',
    outputSchema: z.object({ reply: z.string(), count: z.number() }),
    execute: async ({ context }) => {
      countRun('answer');

      return context.workflow.suspend({
        reason: 'awaiting_answer',
        accepts: answerSchema,
      });
    },
  });
  const knownOrders = new Set(['order-1']);
  const lookup = defineAction<
    Record<string, never>,
    { orderId: string },
    TestContext,
    Settings
  >({
    name: 'lookup',
    outputSchema: z.object({ orderId: z.string() }),
    execute: async ({ context }) => {
      countRun('lookup');
      const { orderId } = await context.workflow.suspend({
        reason: 'awaiting_order',
        accepts: z.object({ orderId: z.string() }),
      });
      if (!knownOrders.has(orderId)) {
        throw new WorkflowResumeRejectedError(`Unknown order "${orderId}".`);
      }

      return { orderId };
    },
  });
  const payloadActions = { ...actions, answer, lookup };
  const compilePayload = (definition: WorkflowDefinition) =>
    compileWorkflow(definition, { actions: payloadActions });
  const single: WorkflowDefinition = {
    defs: createTaskDefs({ question: { action: 'answer' } }),
    flow: [{ do: 'question' }],
    outputs: { answer: '=$output.question' },
  };
  const retrying = {
    retries: {
      enabled: true,
      max_attempts: 3,
      backoff_ms: 0,
      max_delay_ms: 0,
      jitter: 0,
      multiplier: 1,
    },
  } as Settings;
  const suspendedResult = (result: WorkflowRunResult) => {
    if (result.status !== 'suspended') {
      throw new Error(`Expected the run to suspend, got ${result.status}`);
    }

    return result;
  };
  /** Record `<event> <step id>` for resume and cancellation events. */
  const recordResumeEvents = (context: TestContext) => {
    const log: string[] = [];

    (
      [
        'hook:step:resumed',
        'hook:step:resume_rejected',
        'hook:step:cancelled',
        'hook:workflow:resume_rejected',
      ] as const
    ).forEach((event) =>
      context.eventEmitter.on(event, (payload) => {
        const step = 'step' in payload ? payload.step : payload.wait.step;
        log.push(`${event} ${step.id}`);
      }),
    );

    return log;
  };

  beforeEach(() => {
    bodyRuns = {};
  });

  it('refuses a payload the wait does not accept without running the body', async () => {
    const context = new TestContext({});
    const log = recordResumeEvents(context);
    const rejected = jest.fn();
    context.eventEmitter.on('hook:workflow:resume_rejected', rejected);
    const runner = new WorkflowRunner(compilePayload(single), {
      runId: 'run-1',
    });
    const started = suspendedResult(
      await runner.start({ inputData: {}, context }),
    );
    const [wait] = started.waits;
    expect(wait.accepts).toMatchObject({
      type: 'object',
      properties: { reply: { type: 'string' } },
      required: ['reply'],
    });

    const refused = suspendedResult(
      await runner.resume({ waitId: wait.waitId, resumeData: { reply: 1 } }),
    );

    expect(refused.rejection).toEqual({
      waitId: wait.waitId,
      error: expect.any(WorkflowResumeRejectedError),
    });
    expect(refused.rejection?.error.issues).toEqual([
      expect.stringMatching(/^reply: /),
    ]);
    expect(refused.checkpoint).toBe(started.checkpoint);
    expect(refused.waits).toEqual(started.waits);
    expect(runner.getStatus()).toBe('suspended');
    expect(bodyRuns).toEqual({ answer: 1 });
    expect(log).toEqual(['hook:workflow:resume_rejected 0:question']);
    expect(rejected).toHaveBeenCalledWith({
      runId: 'run-1',
      wait,
      resumeData: { reply: 1 },
      error: refused.rejection?.error,
    });

    // The same waitId, e.g. from a link already sent, still works.
    await expect(
      runner.resume({
        waitId: wait.waitId,
        resumeData: { reply: 'ok', count: '3' },
      }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { answer: { reply: 'ok', count: 3 } },
    });
  });

  it('lets a host refuse a payload before claiming the run', async () => {
    const started = suspendedResult(
      await new WorkflowRunner(compilePayload(single)).start({
        inputData: {},
        context: new TestContext({}),
      }),
    );
    const stored = JSON.parse(JSON.stringify(started.checkpoint));
    const [{ waitId }] = started.waits;
    const compiled = compilePayload(single);
    const refused = validateCheckpoint(compiled, stored, {
      waitId,
      resumeData: { count: 2 },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toBeInstanceOf(WorkflowResumeRejectedError);
      expect(refused.error.message).toContain(`wait "${waitId}"`);
    }

    // Without waitId the only open wait is checked.
    expect(
      validateCheckpoint(compiled, stored, { resumeData: undefined }).ok,
    ).toBe(false);
    expect(
      validateCheckpoint(compiled, stored, {
        waitId,
        resumeData: { reply: 'ok' },
      }).ok,
    ).toBe(true);
    // No payload given, nothing to check.
    expect(validateCheckpoint(compiled, stored, { waitId }).ok).toBe(true);
  });

  it('picks the wait to check the way resume() does', async () => {
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        left: { action: 'answer' },
        right: { action: 'answer' },
      }),
      flow: [
        {
          parallel: {
            strategy: 'wait_all',
            steps: [{ do: 'left' }, { do: 'right' }],
          },
        },
      ],
      outputs: {},
    };
    const started = suspendedResult(
      await new WorkflowRunner(compilePayload(definition)).start({
        inputData: {},
        context: new TestContext({}),
      }),
    );
    const stored = JSON.parse(JSON.stringify(started.checkpoint));
    const compiled = compilePayload(definition);
    const openWaitIds = started.waits.map((wait) => wait.waitId);
    // With two open waits and no waitId, neither can check the payload.
    const checked = validateCheckpoint(compiled, stored, {
      resumeData: { reply: 1 },
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.error).toBeInstanceOf(WorkflowWaitAmbiguousError);
      expect((checked.error as WorkflowWaitAmbiguousError).openWaitIds).toEqual(
        openWaitIds,
      );
    }
    // Without a payload to check, the checkpoint alone is valid.
    expect(validateCheckpoint(compiled, stored).ok).toBe(true);

    const runner = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: stored,
      context: new TestContext({}),
    });
    const resumed = runner.resume({ resumeData: { reply: 'ok' } });
    await expect(resumed).rejects.toBeInstanceOf(WorkflowWaitAmbiguousError);
    await expect(resumed).rejects.toBeInstanceOf(WorkflowResumeError);
    expect(runner.getStatus()).toBe('suspended');
  });

  it('resumes a wait whose payload is optional without a payload', async () => {
    const noteSchema = z.object({ note: z.string() });
    const notes = defineAction<
      Record<string, never>,
      { first: string; second: string },
      TestContext,
      Settings
    >({
      name: 'notes',
      outputSchema: z.object({ first: z.string(), second: z.string() }),
      execute: async ({ context }) => {
        countRun('notes');
        const first = await context.workflow.suspend({
          accepts: noteSchema.optional(),
        });
        const second = await context.workflow.suspend({
          key: 'second',
          accepts: noteSchema,
        });

        return { first: first?.note ?? 'none', second: second.note };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({ step: { action: 'notes' } }),
      flow: [{ do: 'step' }],
      outputs: { first: '=$output.step.first', second: '=$output.step.second' },
    };
    const compiled = compileWorkflow(definition, { actions: { notes } });
    const persist = (result: WorkflowRunResult) =>
      JSON.parse(JSON.stringify(suspendedResult(result).checkpoint));
    const started = suspendedResult(
      await new WorkflowRunner(compiled).start({
        inputData: {},
        context: new TestContext({}),
      }),
    );
    expect(started.waits[0].payloadOptional).toBe(true);

    const stored = persist(started);
    expect(
      validateCheckpoint(compiled, stored, { resumeData: undefined }).ok,
    ).toBe(true);
    expect(
      validateCheckpoint(compiled, stored, { resumeData: { note: 1 } }).ok,
    ).toBe(false);

    // The absent payload survives the checkpoint's JSON round trip.
    const middle = await WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: stored,
      context: new TestContext({}),
    }).resume({});
    const next = persist(middle);
    expect(next.waits[0].payloadOptional).toBeUndefined();
    expect(
      validateCheckpoint(compiled, next, { resumeData: undefined }).ok,
    ).toBe(false);

    const restored = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: next,
      context: new TestContext({}),
    });
    await expect(
      restored.resume({ resumeData: { note: 'later' } }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { first: 'none', second: 'later' },
    });
    expect(bodyRuns).toEqual({ notes: 3 });
  });

  it('fails a suspend whose accepts schema no JSON payload can match', async () => {
    const dated = defineAction<
      Record<string, never>,
      unknown,
      TestContext,
      Settings
    >({
      name: 'dated',
      execute: async ({ context }) => {
        countRun('dated');

        return context.workflow.suspend({
          accepts: z.object({ at: z.date(), tags: z.set(z.string()) }),
        });
      },
    });
    const runner = new WorkflowRunner(
      compileWorkflow(
        {
          defs: createTaskDefs({
            step: { action: 'dated', settings: noRetries },
          }),
          flow: [{ do: 'step' }],
          outputs: {},
        },
        { actions: { dated } },
      ),
    );
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    // Opening the wait would leave a run nothing can ever resume.
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect((result.error as Error).message).toMatch(
        /in step "0:step" can never match a JSON payload: at \(date\), tags \(set\)\./,
      );
    }
  });

  it('parses the JSON form of a payload through its accepts schema', async () => {
    const dated = defineAction<
      Record<string, never>,
      { at: string; isDate: boolean },
      TestContext,
      Settings
    >({
      name: 'dated',
      outputSchema: z.object({ at: z.string(), isDate: z.boolean() }),
      execute: async ({ context }) => {
        const { at } = await context.workflow.suspend({
          accepts: z.object({ at: z.coerce.date() }),
        });

        return { at: at.toISOString(), isDate: at instanceof Date };
      },
    });
    const runner = new WorkflowRunner(
      compileWorkflow(
        {
          defs: createTaskDefs({ step: { action: 'dated' } }),
          flow: [{ do: 'step' }],
          outputs: { step: '=$output.step' },
        },
        { actions: { dated } },
      ),
    );
    await runner.start({ inputData: {}, context: new TestContext({}) });

    await expect(
      runner.resume({ resumeData: { at: new Date(0) } }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { step: { at: '1970-01-01T00:00:00.000Z', isDate: true } },
    });
  });

  it('keeps the wait open when the body refuses the payload', async () => {
    const started = suspendedResult(
      await new WorkflowRunner(compilePayload(single)).start({
        inputData: {},
        context: new TestContext({}),
      }),
    );
    const stored = JSON.parse(
      JSON.stringify({
        checkpoint: started.checkpoint,
        snapshot: started.snapshot,
      }),
    );
    const context = new TestContext({});
    const log = recordResumeEvents(context);
    const stepRejected = jest.fn();
    context.eventEmitter.on('hook:step:resume_rejected', stepRejected);
    const runner = WorkflowRunner.fromCheckpoint(compilePayload(single), {
      checkpoint: stored.checkpoint,
      snapshot: stored.snapshot,
      context,
    });
    const stepLog = runner.getStepLog();
    // Passes the JSON Schema; only the refinement in the body refuses it.
    const refused = suspendedResult(
      await runner.resume({ resumeData: { reply: 'forbidden' } }),
    );

    expect(refused.rejection?.error).toBeInstanceOf(
      WorkflowResumeRejectedError,
    );
    expect(refused.rejection?.error.message).toMatch(
      /^Resume payload for step "0:question" was rejected: reply: forbidden/,
    );
    // Everything the runner reports is left as it was before the resume.
    expect(refused.checkpoint).toEqual(stored.checkpoint);
    expect(refused.snapshot).toEqual(stored.snapshot);
    expect(runner.getStepLog()).toEqual(stepLog);
    expect(bodyRuns).toEqual({ answer: 2 });
    expect(log).toEqual([
      'hook:step:resumed 0:question',
      'hook:step:resume_rejected 0:question',
      'hook:workflow:resume_rejected 0:question',
    ]);
    expect(stepRejected).toHaveBeenCalledWith(
      expect.objectContaining({ wait: stored.checkpoint.waits[0] }),
    );

    await expect(
      runner.resume({ resumeData: { reply: 'fine' } }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { answer: { reply: 'fine', count: 1 } },
    });
  });

  it('lets an action refuse a payload itself, without retrying it', async () => {
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        order: { action: 'lookup', settings: retrying },
      }),
      flow: [{ do: 'order' }],
      outputs: { orderId: '=$output.order.orderId' },
    };
    const runner = new WorkflowRunner(compilePayload(definition));
    const started = suspendedResult(
      await runner.start({ inputData: {}, context: new TestContext({}) }),
    );
    const refused = suspendedResult(
      await runner.resume({ resumeData: { orderId: 'order-404' } }),
    );

    expect(refused.rejection?.error.message).toBe('Unknown order "order-404".');
    expect(refused.waits).toEqual(started.waits);
    expect(bodyRuns).toEqual({ lookup: 2 });

    await expect(
      runner.resume({ resumeData: { orderId: 'order-1' } }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { orderId: 'order-1' },
    });
  });

  it('recognises a refusal thrown by another copy of the package', async () => {
    // What the class looks like when an extension imports the other (CJS or
    // ESM) build: same name, different constructor.
    class ForeignResumeRejectedError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'WorkflowResumeRejectedError';
      }
    }
    const foreign = defineAction<
      Record<string, never>,
      never,
      TestContext,
      Settings
    >({
      name: 'foreign',
      execute: async ({ context }) => {
        countRun('foreign');
        await context.workflow.suspend();

        throw new ForeignResumeRejectedError('Unknown order.');
      },
    });
    const runner = new WorkflowRunner(
      compileWorkflow(
        {
          defs: createTaskDefs({
            step: { action: 'foreign', settings: retrying },
          }),
          flow: [{ do: 'step' }],
          outputs: {},
        },
        { actions: { foreign } },
      ),
    );
    const started = suspendedResult(
      await runner.start({ inputData: {}, context: new TestContext({}) }),
    );
    const refused = suspendedResult(await runner.resume({ resumeData: {} }));

    expect(refused.rejection?.error.message).toBe('Unknown order.');
    expect(refused.waits).toEqual(started.waits);
    expect(bodyRuns).toEqual({ foreign: 2 });
  });

  it('refuses a payload JSON cannot store', async () => {
    const runner = new WorkflowRunner(compilePayload(single));
    await runner.start({ inputData: {}, context: new TestContext({}) });

    const refused = suspendedResult(
      await runner.resume({ resumeData: { reply: BigInt(1) } }),
    );

    expect(refused.rejection?.error.message).toMatch(
      /cannot be stored as JSON/,
    );
    expect(bodyRuns).toEqual({ answer: 1 });
  });

  it.each(['wait_all', 'wait_any'] as const)(
    'keeps every wait of a %s block open when one payload is refused',
    async (strategy) => {
      const definition: WorkflowDefinition = {
        defs: createTaskDefs({
          left: { action: 'answer' },
          right: { action: 'answer' },
        }),
        flow: [
          {
            parallel: { strategy, steps: [{ do: 'left' }, { do: 'right' }] },
          },
        ],
        outputs: { left: '=$output.left.reply', right: '=$output.right.reply' },
      };
      const context = new TestContext({});
      const log = recordResumeEvents(context);
      const runner = new WorkflowRunner(compilePayload(definition));
      const started = suspendedResult(
        await runner.start({ inputData: {}, context }),
      );
      const stepLog = runner.getStepLog();
      const [left, right] = started.waits;
      const refused = suspendedResult(
        await runner.resume({
          waitId: left.waitId,
          resumeData: { reply: 'forbidden' },
        }),
      );

      expect(refused.rejection?.waitId).toBe(left.waitId);
      expect(refused.waits).toEqual(started.waits);
      expect(refused.snapshot).toEqual(started.snapshot);
      expect(runner.getStepLog()).toEqual(stepLog);
      expect(log).not.toContainEqual(expect.stringMatching(/cancelled/));

      const next = await runner.resume({
        waitId: right.waitId,
        resumeData: { reply: 'R' },
      });
      if (strategy === 'wait_any') {
        expect(next).toMatchObject({ status: 'finished' });

        return;
      }

      expect(suspendedResult(next).waits).toEqual([left]);
      await expect(
        runner.resume({ waitId: left.waitId, resumeData: { reply: 'L' } }),
      ).resolves.toMatchObject({
        status: 'finished',
        output: { left: 'L', right: 'R' },
      });
    },
  );

  it('keeps the loop position of a refused wait', async () => {
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({ question: { action: 'answer' } }),
      flow: [
        {
          loop: {
            type: 'for_each',
            name: 'items',
            for_each: { item: 'item', in: '=["a", "b"]' },
            accumulate: {
              as: 'replies',
              initial: [],
              merge: '=$append($accumulator, [$output.question.reply])',
            },
            steps: [{ do: 'question' }],
          },
        },
      ],
      outputs: { replies: '=$output.items.replies' },
    };
    const resumeDurably = async (
      result: WorkflowRunResult,
      resumeData: unknown,
    ) => {
      const stored = JSON.parse(JSON.stringify(suspendedResult(result)));

      return WorkflowRunner.fromCheckpoint(compilePayload(definition), {
        checkpoint: stored.checkpoint,
        snapshot: stored.snapshot,
        context: new TestContext({}),
      }).resume({ resumeData });
    };
    const started = await new WorkflowRunner(compilePayload(definition)).start({
      inputData: {},
      context: new TestContext({}),
    });
    const first = suspendedResult(started).waits[0].waitId;
    expect(first).toMatch(/\[0\]@/);

    const refused = suspendedResult(
      await resumeDurably(started, { reply: 'forbidden' }),
    );
    expect(refused.rejection).toBeDefined();
    expect(refused.waits[0].waitId).toBe(first);

    const second = await resumeDurably(refused, { reply: 'a' });
    expect(suspendedResult(second).waits[0].waitId).toMatch(/\[1\]@/);
    await expect(resumeDurably(second, { reply: 'b' })).resolves.toMatchObject({
      status: 'finished',
      output: { replies: ['a', 'b'] },
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { LoopFrame, SequenceFrame } from '../checkpoint';
import { BaseWorkflowContext } from '../context';
import { StepType, type EventEmitterLike } from '../workflow-event-emitter';
import type { CompiledStep, ExecutionState, LoopStep } from '../workflow-types';
import { compileValue } from '../workflow-values';

import {
  executeLoop,
  shouldStopLoop,
  updateAccumulator,
} from './loop-executor';
import type { StepExecutorEnv } from './types';

class TestContext extends BaseWorkflowContext {
  public eventEmitter: EventEmitterLike = { emit: jest.fn(), on: jest.fn() };

  constructor() {
    super({});
  }
}

const createState = (): ExecutionState => ({
  input: {},
  output: {},
  iterationStack: [],
});
const createEnv = (executeFlow: jest.Mock): StepExecutorEnv => {
  const compiled = {
    definition: {} as any,
    tasks: {},
    flow: [],
    outputMapping: {},
    inputParser: { parse: (value: unknown) => value } as any,
  } as any;
  const env = {
    compiled,
    context: new TestContext(),
    signal: new AbortController().signal,
    runId: 'run-loop',
    runtime: {} as StepExecutorEnv['runtime'],
    resolutions: new Map<string, unknown>(),
    rejectResume: jest.fn(),
    buildInstanceStepInfo: jest.fn(),
    markSnapshot: jest.fn(),
    recordStepExecution: jest.fn(),
    emit: jest.fn(),
    captureTaskOutput: jest.fn(),
    executeFlow,
    executeStep: jest.fn(),
    fork: jest.fn(),
  } as StepExecutorEnv;

  env.fork = jest.fn((overrides) => ({ ...env, ...overrides }));

  return env;
};
const createTaskStep = (id: string): CompiledStep => ({
  id,
  type: StepType.Task,
  label: id,
  taskName: `task_${id}`,
});
const childFrame: SequenceFrame = {
  kind: 'sequence',
  index: 0,
  child: {
    kind: 'task',
    stepId: 'child',
    inputs: {},
    awaitResults: {},
    wait: {
      waitId: 'child[0]@index:1',
      step: { id: 'child[0]', name: 'child', type: StepType.Task },
      suspendKey: 'index:1',
    },
  },
};
const recordItem = async (
  _steps: CompiledStep[],
  iterationState: ExecutionState,
) => {
  iterationState.output[`item_${iterationState.iteration?.index}`] =
    iterationState.iteration?.item;

  return undefined;
};

describe('executeLoop', () => {
  it('iterates items, accumulates values, and stops when the until condition is met', async () => {
    const flowCalls: Array<{ index: number; item: unknown }> = [];
    const executeFlow = jest.fn(
      async (_steps: CompiledStep[], iterationState: ExecutionState) => {
        flowCalls.push(
          iterationState.iteration as { index: number; item: unknown },
        );
        iterationState.output[`item_${iterationState.iteration?.index}`] =
          iterationState.iteration?.item;

        return undefined;
      },
    );
    const env = createEnv(executeFlow);
    const state = createState();
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'for_each',
      label: 'loop',
      name: 'collector',
      forEach: { item: 'entry', in: { kind: 'literal', value: [2, 4, 6] } },
      until: compileValue('=$accumulator >= 6'),
      accumulate: {
        as: 'sum',
        initial: 0,
        merge: compileValue('=$accumulator + $iteration.item'),
      },
      steps: [createTaskStep('child')],
    };
    const result = await executeLoop(env, step, state, []);

    expect(result).toBeUndefined();
    expect(flowCalls).toEqual([
      { item: 2, index: 0 },
      { item: 4, index: 1 },
      { item: 6, index: 2 },
    ]);
    expect(state.output.collector).toEqual({ sum: 12 });
    expect(state.accumulator).toBe(12);
    expect(state.output).toMatchObject({ item_0: 2, item_1: 4, item_2: 6 });
  });

  it('stops before the last item once until holds, seeing the accumulator before the merge', async () => {
    const executeFlow = jest.fn(recordItem);
    const state = createState();
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'for_each',
      label: 'loop',
      name: 'collector',
      forEach: { item: 'entry', in: { kind: 'literal', value: [1, 2, 3, 4] } },
      // At index 2 the accumulator is still 1 + 2, before this item is merged.
      until: compileValue('=$accumulator >= 3'),
      accumulate: {
        as: 'sum',
        initial: 0,
        merge: compileValue('=$accumulator + $iteration.item'),
      },
      steps: [createTaskStep('child')],
    };

    await expect(
      executeLoop(createEnv(executeFlow), step, state, []),
    ).resolves.toBeUndefined();
    expect(executeFlow).toHaveBeenCalledTimes(3);
    expect(state.output.collector).toEqual({ sum: 6 });
    expect(state.output).not.toHaveProperty('item_3');
  });

  it('records the suspended iteration and resumes it with the recorded items and accumulator', async () => {
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'for_each',
      label: 'loop',
      name: 'collector',
      forEach: { item: 'entry', in: { kind: 'literal', value: [1, 2] } },
      accumulate: {
        as: 'sum',
        initial: 0,
        merge: compileValue('=$accumulator + $iteration.item'),
      },
      steps: [createTaskStep('child')],
    };
    const suspendingFlow = jest
      .fn()
      .mockImplementationOnce(recordItem)
      .mockResolvedValueOnce(childFrame);
    const frame = await executeLoop(
      createEnv(suspendingFlow),
      step,
      createState(),
      [],
    );

    expect(frame).toEqual({
      kind: 'loop',
      stepId: 'loop',
      index: 1,
      items: [1, 2],
      accumulator: 1,
      child: childFrame,
    });

    // The item list is not re-evaluated: a resumed loop keeps its items.
    const resumedStep: LoopStep = {
      ...step,
      forEach: { item: 'entry', in: { kind: 'literal', value: [9, 9, 9] } },
    };
    const resumingFlow = jest.fn(recordItem);
    const state = createState();
    const result = await executeLoop(
      createEnv(resumingFlow),
      resumedStep,
      state,
      [],
      frame as LoopFrame,
    );

    expect(result).toBeUndefined();
    expect(resumingFlow).toHaveBeenCalledTimes(1);
    expect(resumingFlow).toHaveBeenCalledWith(
      step.steps,
      expect.objectContaining({
        iteration: { item: 2, index: 1 },
        accumulator: 1,
        iterationStack: [1],
      }),
      [1],
      childFrame,
    );
    expect(state.output.collector).toEqual({ sum: 3 });
    expect(state.accumulator).toBe(3);
  });

  it('evaluates while loops before each iteration and can exit without running', async () => {
    const executeFlow = jest.fn();
    const env = createEnv(executeFlow);
    const state = createState();
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'while',
      label: 'loop',
      while: compileValue('=$exists($output.await_phone_reply) = true'),
      steps: [createTaskStep('child')],
    };
    const result = await executeLoop(env, step, state, []);

    expect(result).toBeUndefined();
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it('resumes a while iteration without re-checking its guard', async () => {
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'while',
      label: 'loop',
      name: 'collector',
      while: compileValue(
        '=$exists($output.should_continue) and $output.should_continue = true',
      ),
      accumulate: {
        as: 'count',
        initial: 0,
        merge: compileValue('=$accumulator + 1'),
      },
      steps: [createTaskStep('child')],
    };
    const state = createState();
    state.output.should_continue = true;

    const frame = await executeLoop(
      createEnv(jest.fn().mockResolvedValueOnce(childFrame)),
      step,
      state,
      [],
    );

    expect(frame).toEqual({
      kind: 'loop',
      stepId: 'loop',
      index: 0,
      accumulator: 0,
      child: childFrame,
    });

    // The guard is now false, but the suspended iteration already passed it.
    const resumed = createState();
    resumed.output.should_continue = false;
    const executeFlow = jest.fn().mockResolvedValue(undefined);
    const result = await executeLoop(
      createEnv(executeFlow),
      step,
      resumed,
      [],
      frame as LoopFrame,
    );

    expect(result).toBeUndefined();
    expect(executeFlow).toHaveBeenCalledTimes(1);
    expect(executeFlow).toHaveBeenCalledWith(
      step.steps,
      expect.objectContaining({ iteration: { item: undefined, index: 0 } }),
      [0],
      childFrame,
    );
    expect(resumed.output.collector).toEqual({ count: 1 });
  });
});

describe('loop helpers', () => {
  it('updates accumulator and stop conditions based on configuration', async () => {
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'for_each',
      label: 'loop',
      forEach: { item: 'entry', in: { kind: 'literal', value: [] } },
      steps: [],
    };
    const scope = {
      input: {},
      context: new TestContext().state,
      output: {},
      iteration: { item: 1, index: 0 },
      accumulator: 5,
    };

    await expect(updateAccumulator(step, scope, 5)).resolves.toBe(5);
    await expect(shouldStopLoop(step, scope)).resolves.toBe(false);
  });

  it('treats a for_each frame without recorded items as an empty item list', async () => {
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'for_each',
      label: 'loop',
      name: 'collector',
      forEach: { item: 'entry', in: { kind: 'literal', value: [1, 2] } },
      accumulate: { as: 'sum', initial: 0, merge: compileValue('=0') },
      steps: [createTaskStep('child')],
    };
    const flow = jest.fn(recordItem);
    const state = createState();

    await expect(
      executeLoop(createEnv(flow), step, state, [], {
        kind: 'loop',
        stepId: 'loop',
        index: 0,
        accumulator: 7,
        child: childFrame,
      }),
    ).resolves.toBeUndefined();
    expect(flow).not.toHaveBeenCalled();
    expect(state.output.collector).toEqual({ sum: 7 });
  });

  it('does not stop while loops through until semantics', async () => {
    const step: LoopStep = {
      id: 'loop',
      type: StepType.Loop,
      loopType: 'while',
      label: 'loop',
      while: compileValue('=true'),
      steps: [],
    };
    const scope = {
      input: {},
      context: new TestContext().state,
      output: {},
      iteration: { item: undefined, index: 0 },
      accumulator: 0,
    };

    await expect(shouldStopLoop(step, scope)).resolves.toBe(false);
  });
});

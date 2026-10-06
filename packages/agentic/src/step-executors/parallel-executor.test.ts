/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ParallelFrame, StepFrame, TaskFrame } from '../checkpoint';
import { BaseWorkflowContext } from '../context';
import { RunnerRuntimeControl } from '../runner-runtime-control';
import {
  StepType,
  type EventEmitterLike,
  type StepInfo,
} from '../workflow-event-emitter';
import type {
  CompiledStep,
  ExecutionState,
  ParallelStep,
} from '../workflow-types';

import { executeParallel } from './parallel-executor';
import type { StepExecutorEnv } from './types';

class TestContext extends BaseWorkflowContext {
  public eventEmitter: EventEmitterLike = { emit: jest.fn(), on: jest.fn() };

  constructor() {
    super({});
  }
}

/** What a branch sees when the parallel executor runs its child step. */
type ChildBranch = {
  signal: AbortSignal;
  frame?: StepFrame;
  context: BaseWorkflowContext;
};

type ChildRunner = (
  child: CompiledStep,
  branchState: ExecutionState,
  path: Array<number | string>,
  branch: ChildBranch,
) => Promise<StepFrame | void>;

type TestEnv = StepExecutorEnv & {
  runChild: jest.Mock<ReturnType<ChildRunner>, Parameters<ChildRunner>>;
};

const createState = (): ExecutionState => ({
  input: {},
  output: {},
  iterationStack: [],
});
const createChild = (id: string): CompiledStep => ({
  id,
  type: StepType.Task,
  label: id,
  taskName: `task_${id}`,
});
const createEnv = (): TestEnv => {
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
    runId: 'run-1',
    runtime: new RunnerRuntimeControl(),
    resolutions: new Map<string, unknown>(),
    rejectResume: jest.fn(),
    buildInstanceStepInfo: jest.fn((step: CompiledStep): StepInfo => {
      return { id: step.id, name: step.label, type: step.type };
    }),
    markSnapshot: jest.fn(),
    recordStepExecution: jest.fn(),
    emit: jest.fn(),
    captureTaskOutput: jest.fn(),
    executeFlow: jest.fn(),
    executeStep: jest.fn(),
    fork: jest.fn(),
    runChild: jest.fn(),
  } as TestEnv;

  env.fork = jest.fn((overrides) => {
    const forked = { ...env, ...overrides } as StepExecutorEnv;

    forked.executeStep = (step, state, path, frame) =>
      env.runChild(step, state, path, {
        signal: forked.signal,
        frame,
        context: forked.context,
      });

    return forked;
  });

  return env;
};
const createStep = (strategy: ParallelStep['strategy']): ParallelStep => ({
  id: 'parallel',
  type: StepType.Parallel,
  label: 'parallel',
  strategy,
  steps: [createChild('a'), createChild('b')],
});
const createTaskFrame = (id: string): TaskFrame => ({
  kind: 'task',
  stepId: id,
  inputs: {},
  awaitResults: {},
  wait: {
    waitId: `${id}@index:1`,
    step: { id, name: id, type: StepType.Task },
    suspendKey: 'index:1',
  },
});
const rejectOnAbort = (signal: AbortSignal) =>
  new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('executeParallel', () => {
  it('starts all children before waiting when using wait_all', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_all');
    const started: string[] = [];
    const resolvers: Array<() => void> = [];

    env.runChild.mockImplementation((child) => {
      started.push(child.id);

      return new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    });

    const resultPromise = executeParallel(env, step, state, [0]);
    await flushPromises();

    expect(started).toEqual(['a', 'b']);
    expect(env.runChild).toHaveBeenCalledTimes(2);

    resolvers.forEach((resolve) => resolve());
    await expect(resultPromise).resolves.toBeUndefined();
  });

  it('merges wait_all output deltas in child-index order', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_all');

    state.output.existing = 'keep';
    env.runChild.mockImplementation(async (child, branchState) => {
      branchState.output.shared = child.id;
      branchState.output[`${child.id}_only`] = true;
    });

    await executeParallel(env, step, state, []);

    expect(state.output).toEqual({
      existing: 'keep',
      shared: 'b',
      a_only: true,
      b_only: true,
    });
  });

  it('fails wait_all fast and aborts unfinished siblings', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_all');
    const failure = new Error('branch failed');

    env.runChild.mockImplementation((child, _branchState, _path, branch) => {
      if (child.id === 'a') {
        return Promise.reject(failure);
      }

      return rejectOnAbort(branch.signal);
    });

    await expect(executeParallel(env, step, state, [])).rejects.toThrow(
      'branch failed',
    );
    expect(env.markSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
      'cancelled',
      'branch failed',
    );
  });

  it('wait_any starts every child, keeps only the winner output, and cancels losers', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_any');
    const started: string[] = [];

    env.runChild.mockImplementation(
      async (child, branchState, _path, branch) => {
        started.push(child.id);
        if (child.id === 'b') {
          branchState.output.winner = child.id;

          return undefined;
        }

        return rejectOnAbort(branch.signal);
      },
    );

    await executeParallel(env, step, state, []);

    expect(started).toEqual(['a', 'b']);
    expect(state.output).toEqual({ winner: 'b' });
    expect(env.markSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      'cancelled',
      'Parallel wait_any winner selected.',
    );
  });

  it('wait_any fails fast before any successful winner', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_any');

    env.runChild.mockImplementation((child, branchState, _path, branch) => {
      if (child.id === 'a') {
        return Promise.reject(new Error('no winner'));
      }

      branchState.output.loser = true;

      return rejectOnAbort(branch.signal);
    });

    await expect(executeParallel(env, step, state, [])).rejects.toThrow(
      'no winner',
    );
    expect(state.output).toEqual({});
    expect(env.markSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
      'cancelled',
      'no winner',
    );
  });

  it('lets running siblings settle before suspending, recording every branch', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_all');
    const order: string[] = [];

    env.runChild.mockImplementation(async (child, branchState) => {
      if (child.id === 'a') {
        branchState.output.a_partial = 1;
        order.push('a suspended');

        return createTaskFrame('a');
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
      branchState.output.b_done = true;
      order.push('b completed');

      return undefined;
    });

    const frame = await executeParallel(env, step, state, []);

    expect(order).toEqual(['a suspended', 'b completed']);
    expect(frame).toEqual({
      kind: 'parallel',
      stepId: 'parallel',
      branches: [
        {
          status: 'suspended',
          outputDelta: { a_partial: 1 },
          child: createTaskFrame('a'),
        },
        { status: 'fulfilled', outputDelta: { b_done: true } },
      ],
    });
    // Nothing is merged into the parent until the whole block completes.
    expect(state.output).toEqual({});
  });

  it('resumes only suspended branches and merges recorded siblings', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_all');
    const frame: ParallelFrame = {
      kind: 'parallel',
      stepId: 'parallel',
      branches: [
        {
          status: 'suspended',
          outputDelta: { a_partial: 1 },
          child: createTaskFrame('a'),
        },
        { status: 'fulfilled', outputDelta: { b_done: true } },
      ],
    };
    const seen: Array<{ id: string; frame?: StepFrame; output: unknown }> = [];
    env.resolutions = new Map([[createTaskFrame('a').wait.waitId, 'reply']]);

    env.runChild.mockImplementation(
      async (child, branchState, _path, branch) => {
        seen.push({
          id: child.id,
          frame: branch.frame,
          output: { ...branchState.output },
        });
        branchState.output.a_done = true;

        return undefined;
      },
    );

    const result = await executeParallel(env, step, state, [], frame);

    expect(result).toBeUndefined();
    expect(seen).toEqual([
      { id: 'a', frame: createTaskFrame('a'), output: { a_partial: 1 } },
    ]);
    expect(state.output).toEqual({ a_partial: 1, a_done: true, b_done: true });
  });

  it('gives each branch its own runtime scope', async () => {
    const env = createEnv();
    const step = createStep('wait_all');
    const scopes: unknown[] = [];

    env.runChild.mockImplementation(async (_child, _state, _path, branch) => {
      scopes.push(branch.context.workflow);
      expect(branch.context.getWorkflowRuntime()).toBe(branch.context.workflow);
    });

    await executeParallel(env, step, createState(), []);

    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBeInstanceOf(RunnerRuntimeControl);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(scopes[0]).not.toBe(env.runtime);
  });

  it('wait_any suspends when every branch is parked', async () => {
    const env = createEnv();
    const step = createStep('wait_any');

    env.runChild.mockImplementation(async (child) => createTaskFrame(child.id));

    await expect(
      executeParallel(env, step, createState(), []),
    ).resolves.toEqual({
      kind: 'parallel',
      stepId: 'parallel',
      branches: [
        { status: 'suspended', outputDelta: {}, child: createTaskFrame('a') },
        { status: 'suspended', outputDelta: {}, child: createTaskFrame('b') },
      ],
    });
  });

  it('wait_any drops the waits of parked losers once a branch wins', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_any');

    env.runChild.mockImplementation(async (child, branchState) => {
      if (child.id === 'a') {
        return createTaskFrame('a');
      }

      await flushPromises();
      branchState.output.winner = child.id;

      return undefined;
    });

    await expect(
      executeParallel(env, step, state, []),
    ).resolves.toBeUndefined();
    expect(state.output).toEqual({ winner: 'b' });
    expect(env.markSnapshot).toHaveBeenCalledWith(
      createTaskFrame('a').wait.step,
      'cancelled',
      'Parallel wait_any winner selected.',
    );
    expect(env.recordStepExecution).toHaveBeenCalledWith(
      createTaskFrame('a').wait.step,
      expect.objectContaining({
        status: 'cancelled',
        reason: 'Parallel wait_any winner selected.',
      }),
    );
    expect(env.emit).toHaveBeenCalledWith('hook:step:cancelled', {
      runId: 'run-1',
      step: createTaskFrame('a').wait.step,
      error: expect.objectContaining({
        message: 'Parallel wait_any winner selected.',
      }),
      wait: createTaskFrame('a').wait,
    });
  });

  it('drops parked waits when a resumed branch fails', async () => {
    const env = createEnv();
    const state = createState();
    const step = createStep('wait_all');
    const failure = new Error('resumed branch failed');
    const frame: ParallelFrame = {
      kind: 'parallel',
      stepId: 'parallel',
      branches: [
        { status: 'suspended', outputDelta: {}, child: createTaskFrame('a') },
        { status: 'suspended', outputDelta: {}, child: createTaskFrame('b') },
      ],
    };

    // Branch b's wait is not resolved by this pass: it stays parked.
    env.resolutions = new Map([[createTaskFrame('a').wait.waitId, 'reply']]);
    env.runChild.mockImplementation(async () => {
      await flushPromises();
      throw failure;
    });

    await expect(executeParallel(env, step, state, [], frame)).rejects.toBe(
      failure,
    );
    expect(env.runChild).toHaveBeenCalledTimes(1);
    expect(env.markSnapshot).toHaveBeenCalledWith(
      createTaskFrame('b').wait.step,
      'cancelled',
      'resumed branch failed',
    );
    expect(env.recordStepExecution).toHaveBeenCalledWith(
      createTaskFrame('b').wait.step,
      expect.objectContaining({
        status: 'cancelled',
        error: { message: 'resumed branch failed' },
      }),
    );
    expect(env.emit).toHaveBeenCalledWith(
      'hook:step:cancelled',
      expect.objectContaining({
        step: createTaskFrame('b').wait.step,
        wait: createTaskFrame('b').wait,
      }),
    );
    expect(state.output).toEqual({});
  });

  it('keeps branches parked without launching them when this pass does not resolve their wait', async () => {
    const env = createEnv();
    const step = createStep('wait_all');
    const frame: ParallelFrame = {
      kind: 'parallel',
      stepId: 'parallel',
      branches: [
        {
          status: 'suspended',
          outputDelta: { a_partial: 1 },
          child: createTaskFrame('a'),
        },
        { status: 'suspended', outputDelta: {}, child: createTaskFrame('b') },
      ],
    };
    env.resolutions = new Map([[createTaskFrame('b').wait.waitId, 'reply']]);
    env.runChild.mockImplementation(async (_child, branchState) => {
      branchState.output.b_done = true;
    });

    const result = await executeParallel(env, step, createState(), [], frame);

    // Only the resolved branch gets a scope, a context and a copy of $output.
    expect(env.fork).toHaveBeenCalledTimes(1);
    expect(env.runChild).toHaveBeenCalledTimes(1);
    expect(env.runChild.mock.calls[0][0].id).toBe('b');
    expect(result).toEqual({
      kind: 'parallel',
      stepId: 'parallel',
      branches: [
        frame.branches[0],
        { status: 'fulfilled', outputDelta: { b_done: true } },
      ],
    });
  });
});

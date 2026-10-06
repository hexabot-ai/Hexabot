/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { SequenceFrame } from '../checkpoint';
import { BaseWorkflowContext } from '../context';
import { StepType, type EventEmitterLike } from '../workflow-event-emitter';
import type {
  CompiledStep,
  ConditionalStep,
  ExecutionState,
} from '../workflow-types';

import { executeConditional } from './conditional-executor';
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
const createTaskStep = (id: string): CompiledStep => ({
  id,
  type: StepType.Task,
  label: id,
  taskName: `task_${id}`,
});
const createEnv = (): StepExecutorEnv => {
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
    runtime: {} as StepExecutorEnv['runtime'],
    resolutions: new Map<string, unknown>(),
    rejectResume: jest.fn(),
    buildInstanceStepInfo: jest.fn(),
    markSnapshot: jest.fn(),
    recordStepExecution: jest.fn(),
    emit: jest.fn(),
    captureTaskOutput: jest.fn(),
    executeFlow: jest.fn(),
    executeStep: jest.fn(),
    fork: jest.fn(),
  } as StepExecutorEnv;

  env.fork = jest.fn((overrides) => ({ ...env, ...overrides }));

  return env;
};

describe('executeConditional', () => {
  it('executes the first matching branch', async () => {
    const env = createEnv();
    const state = createState();
    const step: ConditionalStep = {
      id: 'conditional',
      type: StepType.Conditional,
      label: 'conditional',
      branches: [
        {
          id: 'branch-0',
          condition: { kind: 'literal', value: false },
          steps: [createTaskStep('a')],
        },
        {
          id: 'branch-1',
          condition: { kind: 'literal', value: true },
          steps: [createTaskStep('b')],
        },
        {
          id: 'branch-2',
          condition: { kind: 'literal', value: true },
          steps: [createTaskStep('c')],
        },
      ],
    };
    env.executeFlow = jest.fn().mockResolvedValue(undefined);

    const result = await executeConditional(env, step, state, [0]);

    expect(result).toBeUndefined();
    expect(env.executeFlow).toHaveBeenCalledTimes(1);
    expect(env.executeFlow).toHaveBeenCalledWith(
      step.branches[1].steps,
      state,
      [0, 'branch', 1],
      undefined,
    );
  });

  it('records the chosen branch when it suspends', async () => {
    const env = createEnv();
    const state = createState();
    const child: SequenceFrame = {
      kind: 'sequence',
      index: 0,
      child: {
        kind: 'task',
        stepId: 'b',
        inputs: {},
        awaitResults: {},
        wait: {
          waitId: 'b@index:1',
          step: { id: 'b', name: 'b', type: StepType.Task },
          suspendKey: 'index:1',
        },
      },
    };
    env.executeFlow = jest.fn().mockResolvedValue(child);

    const step: ConditionalStep = {
      id: 'conditional',
      type: StepType.Conditional,
      label: 'conditional',
      branches: [
        {
          id: 'branch-0',
          condition: { kind: 'literal', value: false },
          steps: [createTaskStep('a')],
        },
        { id: 'branch-1', steps: [createTaskStep('b')] },
      ],
    };
    const frame = await executeConditional(env, step, state, []);

    expect(frame).toEqual({
      kind: 'conditional',
      stepId: 'conditional',
      branchIndex: 1,
      child,
    });
  });

  it('re-enters the recorded branch without evaluating conditions again', async () => {
    const env = createEnv();
    const state = createState();
    const child: SequenceFrame = {
      kind: 'sequence',
      index: 0,
      child: {
        kind: 'task',
        stepId: 'b',
        inputs: {},
        awaitResults: {},
        wait: {
          waitId: 'b@index:1',
          step: { id: 'b', name: 'b', type: StepType.Task },
          suspendKey: 'index:1',
        },
      },
    };
    env.executeFlow = jest.fn().mockResolvedValue(undefined);

    const step: ConditionalStep = {
      id: 'conditional',
      type: StepType.Conditional,
      label: 'conditional',
      branches: [
        {
          id: 'branch-0',
          condition: { kind: 'literal', value: true },
          steps: [createTaskStep('a')],
        },
        { id: 'branch-1', steps: [createTaskStep('b')] },
      ],
    };
    const result = await executeConditional(env, step, state, [2], {
      kind: 'conditional',
      stepId: 'conditional',
      branchIndex: 1,
      child,
    });

    expect(result).toBeUndefined();
    expect(env.executeFlow).toHaveBeenCalledWith(
      step.branches[1].steps,
      state,
      [2, 'branch', 1],
      child,
    );
    // Skipped branches were already reported when the branch was chosen.
    expect(env.markSnapshot).not.toHaveBeenCalled();
  });

  it('returns undefined when no branch matches', async () => {
    const env = createEnv();
    const state = createState();
    const step: ConditionalStep = {
      id: 'conditional',
      type: StepType.Conditional,
      label: 'conditional',
      branches: [
        {
          id: 'branch-0',
          condition: { kind: 'literal', value: false },
          steps: [createTaskStep('a')],
        },
        {
          id: 'branch-1',
          condition: { kind: 'literal', value: false },
          steps: [createTaskStep('b')],
        },
      ],
    };
    const result = await executeConditional(env, step, state, []);

    expect(result).toBeUndefined();
    expect(env.executeFlow).not.toHaveBeenCalled();
  });
});

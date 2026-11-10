/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Action } from '../action/action.types';
import type { TaskFrame } from '../checkpoint';
import { BaseWorkflowContext, type StepExecutionRecord } from '../context';
import {
  NonDeterministicWorkflowError,
  WorkflowResumeRejectedError,
} from '../errors';
import { RunnerRuntimeControl } from '../runner-runtime-control';
import {
  type EventEmitterLike,
  type StepInfo,
  StepType,
} from '../workflow-event-emitter';
import type {
  CompiledTask,
  CompiledWorkflow,
  ExecutionState,
  TaskStep,
} from '../workflow-types';
import { compileValue } from '../workflow-values';

import { executeTaskStep } from './task-executor';
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
const createAction = (
  impl: jest.Mock,
): Action<unknown, unknown, BaseWorkflowContext, any> =>
  ({
    name: 'mock_action',
    description: 'runs a task',
    inputSchema: {} as any,
    outputSchema: {} as any,
    execute: jest.fn(),
    parseInput: jest.fn(),
    parseOutput: jest.fn(),
    parseSettings: jest.fn(),
    run: impl,
  }) as Action<unknown, unknown, BaseWorkflowContext, any>;
const createTask = (runImpl: jest.Mock): CompiledTask => ({
  name: 'test_task',
  definition: {} as any,
  actionName: 'mock_action',
  action: createAction(runImpl),
  inputs: { payload: { kind: 'literal', value: 123 } },
  settings: {} as any,
  bindings: {
    tools: { calculate: { action: 'calculate_score', settings: {} } },
  },
});
const createCompiled = (task: CompiledTask): CompiledWorkflow =>
  ({
    definition: {} as any,
    tasks: { [task.name]: task },
    flow: [],
    outputMapping: {},
    inputParser: { parse: (value: unknown) => value } as any,
  }) as CompiledWorkflow;
const createEnv = (
  compiled: CompiledWorkflow,
  stepInfo: StepInfo,
): StepExecutorEnv => {
  const stepRecords: Record<string, StepExecutionRecord> = {};
  const context = new TestContext();
  const runtime = new RunnerRuntimeControl();
  context.attachWorkflowRuntime(runtime);
  const env = {
    compiled,
    context,
    signal: new AbortController().signal,
    runId: 'run-123',
    runtime,
    resolutions: new Map<string, unknown>(),
    rejectResume: jest.fn(),
    buildInstanceStepInfo: jest.fn().mockReturnValue(stepInfo),
    markSnapshot: jest.fn(),
    recordStepExecution: jest.fn((step, update) => {
      const existing =
        stepRecords[step.id] ??
        ({
          id: step.id,
          name: step.name,
          status: 'pending',
        } satisfies StepExecutionRecord);
      const context =
        existing.context || update.context
          ? { ...existing.context, ...update.context }
          : undefined;
      const nextRecord = {
        ...existing,
        ...update,
        id: step.id,
        name: step.name,
        status: update.status ?? existing.status,
        context,
      } satisfies StepExecutionRecord;

      stepRecords[step.id] = nextRecord;

      return nextRecord;
    }),
    emit: jest.fn(),
    captureTaskOutput: jest.fn().mockResolvedValue(undefined),
    executeFlow: jest.fn(),
    executeStep: jest.fn(),
    fork: jest.fn(),
  } as StepExecutorEnv;

  env.fork = jest.fn((overrides) => ({ ...env, ...overrides }));

  return env;
};
const step: TaskStep = {
  id: '0:test_task',
  type: StepType.Task,
  label: 'test_task',
  taskName: 'test_task',
};
const stepInfo: StepInfo = {
  id: step.id,
  name: step.label,
  type: StepType.Task,
};

describe('executeTaskStep', () => {
  it('runs the task, records snapshots, and emits success events', async () => {
    const task = createTask(jest.fn().mockResolvedValue({ result: 'ok' }));
    const compiled = createCompiled(task);
    const env = createEnv(compiled, stepInfo);
    const state = createState();
    const result = await executeTaskStep(env, step, state, []);

    expect(result).toBeUndefined();
    expect(env.buildInstanceStepInfo).toHaveBeenCalledWith(
      step,
      state.iterationStack,
    );
    expect(task.action.run).toHaveBeenCalledWith(
      { payload: 123 },
      env.context,
      task.settings,
      task.bindings,
      expect.any(AbortSignal),
    );
    expect(env.markSnapshot).toHaveBeenNthCalledWith(1, stepInfo, 'running');
    expect(env.markSnapshot).toHaveBeenNthCalledWith(
      2,
      stepInfo,
      'completed',
      undefined,
    );
    expect(env.recordStepExecution).toHaveBeenNthCalledWith(
      1,
      stepInfo,
      expect.objectContaining({
        action: 'mock_action',
        status: 'running',
        startedAt: expect.any(Number),
        input: { payload: 123 },
        context: { before: {} },
      }),
    );
    expect(env.recordStepExecution).toHaveBeenNthCalledWith(
      2,
      stepInfo,
      expect.objectContaining({
        status: 'completed',
        endedAt: expect.any(Number),
        output: { result: 'ok' },
        context: { after: {} },
      }),
    );
    expect(env.captureTaskOutput).toHaveBeenCalledWith(task, state, {
      result: 'ok',
    });
    expect(env.emit).toHaveBeenCalledWith('hook:step:start', {
      runId: 'run-123',
      step: stepInfo,
      stepExecution: expect.objectContaining({
        id: stepInfo.id,
        status: 'running',
      }),
    });
    expect(env.emit).toHaveBeenCalledWith('hook:step:success', {
      runId: 'run-123',
      step: stepInfo,
      stepExecution: expect.objectContaining({
        id: stepInfo.id,
        status: 'completed',
      }),
    });
  });

  it('throws when the task is missing', async () => {
    const compiled = createCompiled(createTask(jest.fn()));
    compiled.tasks = {};
    const env = createEnv(compiled, stepInfo);
    const state = createState();

    await expect(executeTaskStep(env, step, state, [])).rejects.toThrow(
      'Task "test_task" is not defined.',
    );
    expect(env.buildInstanceStepInfo).not.toHaveBeenCalled();
  });

  it('returns a frame on suspension and re-runs the body once its wait is resolved', async () => {
    const task = createTask(
      jest.fn().mockImplementation(async (_inputs, context, ...rest) => {
        const signal = rest[2] as AbortSignal;
        const resumed = (await context.workflow.suspend({
          reason: 'awaiting_user',
          data: { channel: 'sms' },
        })) as { reply: string };

        return { reply: resumed.reply.toUpperCase(), aborted: signal.aborted };
      }),
    );
    const compiled = createCompiled(task);
    const env = createEnv(compiled, stepInfo);
    const state = createState();
    const frame = await executeTaskStep(env, step, state, []);

    expect(frame).toEqual({
      kind: 'task',
      stepId: step.id,
      inputs: { payload: 123 },
      awaitResults: {},
      wait: {
        waitId: '0:test_task@index:1',
        step: stepInfo,
        suspendKey: 'index:1',
        reason: 'awaiting_user',
        data: { channel: 'sms' },
      },
    });
    const [, , , , signal] = (task.action.run as jest.Mock).mock.calls[0];
    expect((signal as AbortSignal).aborted).toBe(true);
    expect(env.markSnapshot).toHaveBeenCalledWith(
      stepInfo,
      'suspended',
      'awaiting_user',
    );
    expect(env.emit).toHaveBeenCalledWith('hook:step:suspended', {
      runId: 'run-123',
      step: stepInfo,
      wait: (frame as TaskFrame).wait,
      stepExecution: expect.objectContaining({
        id: stepInfo.id,
        status: 'suspended',
      }),
    });

    const resumedEnv = {
      ...env,
      resolutions: new Map([['0:test_task@index:1', { reply: 'Sure' }]]),
    };
    const result = await executeTaskStep(
      resumedEnv,
      step,
      state,
      [],
      frame as TaskFrame,
    );

    expect(result).toBeUndefined();
    expect(task.action.run).toHaveBeenCalledTimes(2);
    expect(env.captureTaskOutput).toHaveBeenCalledWith(task, state, {
      reply: 'SURE',
      aborted: false,
    });
    expect(env.emit).toHaveBeenCalledWith('hook:step:resumed', {
      runId: 'run-123',
      step: stepInfo,
      stepExecution: expect.objectContaining({ status: 'running' }),
      wait: (frame as TaskFrame).wait,
      resumeData: { reply: 'Sure' },
    });
    expect(env.emit).toHaveBeenCalledWith('hook:step:success', {
      runId: 'run-123',
      step: stepInfo,
      stepExecution: expect.objectContaining({
        id: stepInfo.id,
        status: 'completed',
      }),
    });
  });

  it('leaves a parked frame untouched when this pass does not resolve its wait', async () => {
    const task = createTask(jest.fn());
    const env = createEnv(createCompiled(task), stepInfo);
    const frame: TaskFrame = {
      kind: 'task',
      stepId: step.id,
      inputs: { payload: 123 },
      awaitResults: {},
      wait: {
        waitId: '0:test_task@index:1',
        step: stepInfo,
        suspendKey: 'index:1',
      },
    };

    await expect(
      executeTaskStep(env, step, createState(), [], frame),
    ).resolves.toBe(frame);
    expect(task.action.run).not.toHaveBeenCalled();
    expect(env.markSnapshot).not.toHaveBeenCalled();
  });

  it('re-runs a resumed body with the inputs recorded in its frame', async () => {
    const task = createTask(
      jest.fn().mockImplementation(async (inputs, context) => ({
        inputs,
        reply: await context.workflow.suspend(),
      })),
    );
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      resolutions: new Map([['0:test_task@index:1', 'yes']]),
    };
    const state = createState();
    const frame: TaskFrame = {
      kind: 'task',
      stepId: step.id,
      // Differs from the compiled `{ payload: 123 }` on purpose.
      inputs: { payload: 'recorded' },
      awaitResults: {},
      wait: {
        waitId: '0:test_task@index:1',
        step: stepInfo,
        suspendKey: 'index:1',
      },
    };

    await expect(
      executeTaskStep(env, step, state, [], frame),
    ).resolves.toBeUndefined();
    expect(task.action.run).toHaveBeenCalledWith(
      { payload: 'recorded' },
      env.context,
      task.settings,
      task.bindings,
      expect.any(AbortSignal),
    );
    expect(env.captureTaskOutput).toHaveBeenCalledWith(task, state, {
      inputs: { payload: 'recorded' },
      reply: 'yes',
    });
  });

  it('fails a resumed body that completes without reaching its suspension', async () => {
    const task = createTask(jest.fn().mockResolvedValue('done'));
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      resolutions: new Map([['0:test_task@index:1', 'yes']]),
    };
    const frame: TaskFrame = {
      kind: 'task',
      stepId: step.id,
      inputs: { payload: 123 },
      awaitResults: {},
      wait: {
        waitId: '0:test_task@index:1',
        step: stepInfo,
        suspendKey: 'index:1',
      },
    };

    await expect(
      executeTaskStep(env, step, createState(), [], frame),
    ).rejects.toThrow(NonDeterministicWorkflowError);
    expect(env.captureTaskOutput).not.toHaveBeenCalled();
    expect(env.markSnapshot).toHaveBeenLastCalledWith(
      stepInfo,
      'failed',
      expect.stringContaining('completed without reaching suspension'),
    );
  });

  it('keeps the wait open when a resumed body refuses its payload', async () => {
    const refusal = new WorkflowResumeRejectedError('Unknown order.');
    const task = createTask(
      jest.fn().mockImplementation(async (_inputs, context) => {
        await context.workflow.suspend({ reason: 'awaiting_order' });
        throw refusal;
      }),
    );
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      resolutions: new Map([['0:test_task@index:1', 'order-404']]),
    };
    const frame: TaskFrame = {
      kind: 'task',
      stepId: step.id,
      inputs: { payload: 123 },
      awaitResults: {},
      wait: {
        waitId: '0:test_task@index:1',
        step: stepInfo,
        suspendKey: 'index:1',
        reason: 'awaiting_order',
      },
    };

    await expect(
      executeTaskStep(env, step, createState(), [], frame),
    ).resolves.toBe(frame);
    expect(env.rejectResume).toHaveBeenCalledWith({
      waitId: '0:test_task@index:1',
      error: refusal,
    });
    expect(env.captureTaskOutput).not.toHaveBeenCalled();
    expect(env.markSnapshot).toHaveBeenLastCalledWith(
      stepInfo,
      'suspended',
      'awaiting_order',
    );
    expect(env.emit).toHaveBeenLastCalledWith('hook:step:resume_rejected', {
      runId: 'run-123',
      step: stepInfo,
      stepExecution: expect.objectContaining({ status: 'suspended' }),
      wait: frame.wait,
      error: refusal,
    });
  });

  it('fails a body that refuses a payload it has not read', async () => {
    const refuse = jest
      .fn()
      .mockRejectedValue(new WorkflowResumeRejectedError('Too early.'));
    const frame: TaskFrame = {
      kind: 'task',
      stepId: step.id,
      inputs: { payload: 123 },
      awaitResults: {},
      wait: {
        waitId: '0:test_task@index:1',
        step: stepInfo,
        suspendKey: 'index:1',
      },
    };
    // Resumed, but refusing before reaching the resolved suspend() call.
    const resumedTask = createTask(refuse);
    const resumedEnv = {
      ...createEnv(createCompiled(resumedTask), stepInfo),
      resolutions: new Map([['0:test_task@index:1', 'yes']]),
    };
    await expect(
      executeTaskStep(resumedEnv, step, createState(), [], frame),
    ).rejects.toThrow('Too early.');
    expect(resumedEnv.rejectResume).not.toHaveBeenCalled();
    expect(resumedEnv.markSnapshot).toHaveBeenLastCalledWith(
      stepInfo,
      'failed',
      'Too early.',
    );

    // Not resumed at all.
    const freshEnv = createEnv(createCompiled(createTask(refuse)), stepInfo);
    await expect(
      executeTaskStep(freshEnv, step, createState(), []),
    ).rejects.toThrow('Too early.');
    expect(freshEnv.rejectResume).not.toHaveBeenCalled();
  });

  it('does not start the action when the run is already aborted', async () => {
    const task = createTask(jest.fn());
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      signal: controller.signal,
    };

    await expect(executeTaskStep(env, step, createState(), [])).rejects.toThrow(
      'stopped',
    );
    expect(task.action.run).not.toHaveBeenCalled();
    expect(env.markSnapshot).toHaveBeenCalledWith(
      stepInfo,
      'cancelled',
      'stopped',
    );
  });

  it('reports the wait a cancelled resume drops', async () => {
    const task = createTask(jest.fn());
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    const frame: TaskFrame = {
      kind: 'task',
      stepId: step.id,
      inputs: { payload: 123 },
      awaitResults: {},
      wait: {
        waitId: '0:test_task@index:1',
        step: stepInfo,
        suspendKey: 'index:1',
      },
    };
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      signal: controller.signal,
      resolutions: new Map([['0:test_task@index:1', 'yes']]),
    };

    await expect(
      executeTaskStep(env, step, createState(), [], frame),
    ).rejects.toThrow('stopped');
    expect(env.emit).toHaveBeenCalledWith(
      'hook:step:cancelled',
      expect.objectContaining({ step: stepInfo, wait: frame.wait }),
    );
  });

  it('records a cancellation when the run is aborted while the action runs', async () => {
    const task = createTask(
      jest.fn().mockImplementation(() => new Promise(() => undefined)),
    );
    const controller = new AbortController();
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      signal: controller.signal,
    };
    const execution = executeTaskStep(env, step, createState(), []);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(task.action.run).toHaveBeenCalledTimes(1);
    controller.abort(new Error('stopped'));

    await expect(execution).rejects.toThrow('stopped');
    expect(env.recordStepExecution).toHaveBeenLastCalledWith(
      stepInfo,
      expect.objectContaining({
        status: 'cancelled',
        error: { message: 'stopped', stack: expect.any(String) },
      }),
    );
    expect(env.markSnapshot).toHaveBeenLastCalledWith(
      stepInfo,
      'cancelled',
      'stopped',
    );
    expect(env.emit).toHaveBeenCalledWith('hook:step:cancelled', {
      runId: 'run-123',
      step: stepInfo,
      stepExecution: expect.objectContaining({ status: 'cancelled' }),
      error: expect.objectContaining({ message: 'stopped' }),
    });
  });

  it('marks failure and rethrows errors from the task', async () => {
    const task = createTask(jest.fn().mockRejectedValue(new Error('boom')));
    const compiled = createCompiled(task);
    const env = createEnv(compiled, stepInfo);
    const state = createState();

    await expect(executeTaskStep(env, step, state, [])).rejects.toThrow('boom');
    expect(env.recordStepExecution).toHaveBeenCalledWith(
      stepInfo,
      expect.objectContaining({
        status: 'failed',
        endedAt: expect.any(Number),
        error: { message: 'boom', stack: expect.any(String) },
        context: { after: {} },
      }),
    );
    expect(env.markSnapshot).toHaveBeenCalledWith(stepInfo, 'failed', 'boom');
    expect(env.emit).toHaveBeenCalledWith('hook:step:error', {
      runId: 'run-123',
      step: stepInfo,
      stepExecution: expect.objectContaining({
        id: stepInfo.id,
        status: 'failed',
      }),
      error: expect.any(Error),
    });
  });
  it('does not start the action when the run is aborted while its inputs are evaluated', async () => {
    const controller = new AbortController();
    const task = {
      ...createTask(jest.fn()),
      inputs: {
        payload: compileValue('=$stopRun()', {
          jsonataFunctions: {
            stopRun: () => {
              controller.abort(new Error('stopped'));

              return 1;
            },
          },
        }),
      },
    };
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      signal: controller.signal,
    };

    await expect(executeTaskStep(env, step, createState(), [])).rejects.toThrow(
      'stopped',
    );
    expect(task.action.run).not.toHaveBeenCalled();
    expect(env.recordStepExecution).toHaveBeenCalledTimes(1);
    expect(env.recordStepExecution).toHaveBeenCalledWith(
      stepInfo,
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(env.markSnapshot).toHaveBeenCalledWith(
      stepInfo,
      'cancelled',
      'stopped',
    );
  });

  it('releases the step when the run is aborted before its action starts', async () => {
    const task = createTask(jest.fn());
    const controller = new AbortController();
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      signal: controller.signal,
    };
    const endStep = jest.spyOn(env.runtime, 'endStep');
    env.emit = jest.fn((event) => {
      if (event === 'hook:step:start') {
        controller.abort(new Error('stopped'));
      }
    });

    await expect(executeTaskStep(env, step, createState(), [])).rejects.toThrow(
      'stopped',
    );
    expect(task.action.run).not.toHaveBeenCalled();
    expect(endStep).toHaveBeenCalledTimes(1);
    expect(env.runtime.hasRecordedResult()).toBe(false);
  });

  it('records a failure that is not an Error by its string form', async () => {
    const task = createTask(jest.fn().mockRejectedValue('boom'));
    const env = createEnv(createCompiled(task), stepInfo);

    await expect(executeTaskStep(env, step, createState(), [])).rejects.toBe(
      'boom',
    );
    expect(env.recordStepExecution).toHaveBeenCalledWith(
      stepInfo,
      expect.objectContaining({
        status: 'failed',
        error: { message: 'boom' },
      }),
    );
    expect(env.markSnapshot).toHaveBeenCalledWith(stepInfo, 'failed', 'boom');
    expect(env.emit).toHaveBeenCalledWith(
      'hook:step:error',
      expect.objectContaining({ error: 'boom' }),
    );
  });
  it('does not evaluate the inputs of a step whose run is already aborted', async () => {
    const evaluated = jest.fn(() => 1);
    const task = {
      ...createTask(jest.fn()),
      inputs: {
        payload: compileValue('=$probe()', {
          jsonataFunctions: { probe: evaluated },
        }),
      },
    };
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      signal: controller.signal,
    };

    await expect(executeTaskStep(env, step, createState(), [])).rejects.toThrow(
      'stopped',
    );
    expect(evaluated).not.toHaveBeenCalled();
  });

  it('detaches the action signal from the run once the step is over', async () => {
    let actionSignal: AbortSignal | undefined;
    const task = createTask(
      jest.fn(async (_input, _context, _settings, _bindings, signal) => {
        actionSignal = signal;

        return { ok: true };
      }),
    );
    const controller = new AbortController();
    const env = {
      ...createEnv(createCompiled(task), stepInfo),
      signal: controller.signal,
    };

    await executeTaskStep(env, step, createState(), []);
    controller.abort(new Error('later'));

    expect(actionSignal).toBeDefined();
    expect(actionSignal?.aborted).toBe(false);
  });
});

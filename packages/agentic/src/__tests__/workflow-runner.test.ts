/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../action/action';
import { BaseWorkflowContext } from '../context';
import type { Settings, WorkflowDefinition } from '../dsl.types';
import { ParallelSuspensionError } from '../errors';
import { compileWorkflow } from '../workflow-compiler';
import {
  StepType,
  WorkflowEventEmitter,
  type WorkflowEventEmitterLike,
  type WorkflowEventMap,
} from '../workflow-event-emitter';
import { WorkflowRunner } from '../workflow-runner';
import type { ExecutionState } from '../workflow-types';

import { createTaskDefs } from './test-helpers';

class MemoryEmitter implements WorkflowEventEmitterLike<{}> {
  private listeners: Partial<{
    [K in keyof WorkflowEventMap]: Array<
      (payload: WorkflowEventMap[K]) => void
    >;
  }> = {};

  emit<K extends keyof WorkflowEventMap>(
    event: K,
    payload: WorkflowEventMap[K],
  ) {
    this.listeners[event]?.forEach((listener) => listener(payload));

    return true;
  }

  on<K extends keyof WorkflowEventMap>(
    event: K,
    listener: (payload: WorkflowEventMap[K]) => void,
  ) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]?.push(listener);

    return this;
  }
}

class TestMemoryContext extends BaseWorkflowContext<
  Record<string, unknown>,
  MemoryEmitter
> {
  public eventEmitter: WorkflowEventEmitterLike<MemoryEmitter> =
    new MemoryEmitter();

  constructor(initial: Record<string, unknown>) {
    super(initial);
  }
}

class TestContext extends BaseWorkflowContext<
  Record<string, unknown>,
  WorkflowEventEmitter
> {
  public eventEmitter: WorkflowEventEmitterLike<WorkflowEventEmitter> =
    new WorkflowEventEmitter();

  constructor(initial: Record<string, unknown>) {
    super(initial);
  }
}

const baseRetries = {
  enabled: true,
  max_attempts: 1,
  backoff_ms: 0,
  max_delay_ms: 0,
  jitter: 0,
  multiplier: 1,
};
describe('WorkflowRunner', () => {
  it('applies global defaults and per-task overrides to runtime settings', async () => {
    const runtimeSettings: Settings[] = [];
    const inspectExecute = jest.fn(async ({ input, settings }) => {
      runtimeSettings.push(settings);

      return { label: input.label };
    });
    const inspectAction = defineAction<
      { label: string },
      { label: string },
      TestContext,
      Settings
    >({
      name: 'inspect_settings_action',
      inputSchema: z.object({ label: z.string() }),
      outputSchema: z.object({ label: z.string() }),
      execute: inspectExecute,
    });
    const defaultRetries = {
      enabled: true,
      max_attempts: 4,
      backoff_ms: 25,
      max_delay_ms: 2000,
      jitter: 0,
      multiplier: 1.2,
    };
    const definition: WorkflowDefinition = {
      defaults: {
        settings: {
          timeout_ms: 200,
          retries: defaultRetries,
        },
      },
      defs: createTaskDefs({
        inherit_task: {
          action: 'inspect_settings_action',
          inputs: { label: '="inherit"' },
        },
        override_timeout_task: {
          action: 'inspect_settings_action',
          inputs: { label: '="timeout_override"' },
          settings: {
            timeout_ms: 50,
          },
        },
        override_retries_task: {
          action: 'inspect_settings_action',
          inputs: { label: '="retries_override"' },
          settings: {
            retries: {
              ...defaultRetries,
              max_attempts: 1,
              multiplier: 1,
            },
          },
        },
      }),
      flow: [
        { do: 'inherit_task' },
        { do: 'override_timeout_task' },
        { do: 'override_retries_task' },
      ],
      outputs: {
        last: '=$output.override_retries_task.label',
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: { inspect_settings_action: inspectAction },
    });
    const runner = new WorkflowRunner(compiled, { runId: 'run-settings' });
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(result.status).toBe('finished');
    expect(inspectExecute).toHaveBeenCalledTimes(3);
    expect(runtimeSettings[0]).toEqual({
      timeout_ms: 200,
      retries: defaultRetries,
    });
    expect(runtimeSettings[1]).toEqual({
      timeout_ms: 50,
      retries: defaultRetries,
    });
    expect(runtimeSettings[2]).toEqual({
      timeout_ms: 200,
      retries: {
        ...defaultRetries,
        max_attempts: 1,
        multiplier: 1,
      },
    });
  });

  it('executes parallel, conditional, and loop steps while tracking snapshots', async () => {
    const firstExecute = jest.fn(async () => ({ value: 'alpha' }));
    const secondExecute = jest.fn(async () => ({ value: 'beta' }));
    const echoExecute = jest.fn(async ({ input }) => ({
      message: String(input.message),
    }));
    const firstAction = defineAction<
      unknown,
      { value: string },
      TestContext,
      Settings
    >({
      name: 'first_action',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: firstExecute,
    });
    const secondAction = defineAction<
      unknown,
      { value: string },
      TestContext,
      Settings
    >({
      name: 'second_action',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: secondExecute,
    });
    const echoAction = defineAction<
      { message?: unknown },
      { message: string },
      TestContext,
      Settings
    >({
      name: 'echo_action',
      inputSchema: z.object({ message: z.any() }),
      outputSchema: z.object({ message: z.string() }),
      execute: echoExecute,
    });
    const definition: WorkflowDefinition = {
      defaults: { settings: { timeout_ms: 0, retries: baseRetries } },
      defs: createTaskDefs({
        first_task: {
          action: 'first_action',
        },
        second_task: {
          action: 'second_action',
        },
        branch_task: {
          action: 'echo_action',
          inputs: {
            message: '=$exists($iteration) ? $iteration.item : "conditional"',
          },
        },
        loop_task: {
          action: 'echo_action',
          inputs: { message: '=$iteration.item' },
        },
      }),
      flow: [
        {
          parallel: {
            strategy: 'wait_any',
            steps: [{ do: 'first_task' }, { do: 'second_task' }],
          },
        },
        {
          conditional: {
            when: [
              {
                condition: '=$exists($output.first_task)',
                steps: [{ do: 'branch_task' }],
              },
              { else: true, steps: [{ do: 'second_task' }] },
            ],
          },
        },
        {
          loop: {
            type: 'for_each',
            name: 'collector',
            for_each: { item: 'entry', in: '=$input.items' },
            until: '=$iteration.index >= 1',
            accumulate: {
              as: 'sum',
              initial: 0,
              merge: '=$accumulator + $iteration.index',
            },
            steps: [{ do: 'loop_task' }],
          },
        },
      ],
      outputs: {
        summary: '=$output',
        total: '=$output.collector.sum',
      },
      inputs: {
        schema: {
          items: { type: 'array', items: { type: 'number' } },
        },
      },
    };
    const emitter = new WorkflowEventEmitter();
    const eventLog: string[] = [];
    emitter.on('hook:step:start', ({ step }) =>
      eventLog.push(`start:${step.name}`),
    );
    emitter.on('hook:step:success', ({ step }) =>
      eventLog.push(`success:${step.name}`),
    );

    const compiled = compileWorkflow(definition, {
      actions: {
        first_action: firstAction,
        second_action: secondAction,
        echo_action: echoAction,
      },
    });
    const runner = new WorkflowRunner(compiled, { runId: 'run-1' });
    const context = new TestContext({});
    context.eventEmitter = emitter;
    const result = await runner.start({
      inputData: { items: [10, 20] },
      context,
    });

    expect(result.status).toBe('finished');
    if (result.status === 'finished') {
      const summary = result.output.summary as Record<string, any>;
      expect(result.output.total).toBe(1);
      expect(summary.first_task.value).toBe('alpha');
      expect(summary.collector.sum).toBe(1);
      expect(summary.loop_task.message).toBe('20');
    }

    expect(firstExecute).toHaveBeenCalledTimes(1);
    expect(secondExecute).toHaveBeenCalledTimes(1);
    expect(echoExecute).toHaveBeenCalledTimes(3);
    expect(eventLog).toContain('start:second_task');
    expect(runner.getSnapshot().status).toBe('finished');
    const snapshots = runner.getSnapshot().actions;
    expect(snapshots['0.parallel.0:first_task']?.status).toBe('completed');
    expect(snapshots['0.parallel.1:second_task']?.status).toBe('cancelled');
    expect(snapshots['1.branch.0.0:branch_task']?.status).toBe('completed');
    expect(snapshots['1.branch.1.0:second_task']?.status).toBe('skipped');
  });

  it('supports conditional, loop, and nested parallel children inside a parallel step', async () => {
    const firstExecute = jest.fn(async () => ({ value: 'alpha' }));
    const secondExecute = jest.fn(async () => ({ value: 'beta' }));
    const echoExecute = jest.fn(async ({ input }) => ({
      message: String(input.message),
    }));
    const firstAction = defineAction<
      unknown,
      { value: string },
      TestContext,
      Settings
    >({
      name: 'first_action',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: firstExecute,
    });
    const secondAction = defineAction<
      unknown,
      { value: string },
      TestContext,
      Settings
    >({
      name: 'second_action',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: secondExecute,
    });
    const echoAction = defineAction<
      { message?: unknown },
      { message: string },
      TestContext,
      Settings
    >({
      name: 'echo_action',
      inputSchema: z.object({ message: z.any() }),
      outputSchema: z.object({ message: z.string() }),
      execute: echoExecute,
    });
    const definition: WorkflowDefinition = {
      defaults: { settings: { timeout_ms: 0, retries: baseRetries } },
      defs: createTaskDefs({
        first_task: {
          action: 'first_action',
        },
        second_task: {
          action: 'second_action',
        },
        loop_task: {
          action: 'echo_action',
          inputs: { message: '=$iteration.item' },
        },
      }),
      flow: [
        {
          parallel: {
            strategy: 'wait_all',
            steps: [
              { do: 'first_task' },
              {
                conditional: {
                  when: [
                    { condition: '=true', steps: [{ do: 'second_task' }] },
                  ],
                },
              },
              {
                loop: {
                  type: 'for_each',
                  name: 'inner_loop',
                  for_each: { item: 'item', in: '=["one","two"]' },
                  steps: [
                    {
                      parallel: {
                        strategy: 'wait_all',
                        steps: [{ do: 'loop_task' }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      outputs: {
        first: '=$output.first_task.value',
        second: '=$output.second_task.value',
        loop_last: '=$output.loop_task.message',
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        first_action: firstAction,
        second_action: secondAction,
        echo_action: echoAction,
      },
    });
    const runner = new WorkflowRunner(compiled, {
      runId: 'run-nested-parallel',
    });
    const context = new TestContext({});
    const result = await runner.start({
      inputData: {},
      context,
    });

    expect(result.status).toBe('finished');
    if (result.status === 'finished') {
      expect(result.output.first).toBe('alpha');
      expect(result.output.second).toBe('beta');
      expect(result.output.loop_last).toBe('two');
    }

    expect(firstExecute).toHaveBeenCalledTimes(1);
    expect(secondExecute).toHaveBeenCalledTimes(1);
    expect(echoExecute).toHaveBeenCalledTimes(2);
    const snapshots = runner.getSnapshot().actions;
    expect(snapshots['0.parallel.0:first_task']?.status).toBe('completed');
    expect(snapshots['0.parallel.1.branch.0.0:second_task']?.status).toBe(
      'completed',
    );
    expect(
      snapshots['0.parallel.2.inner_loop.0.parallel.0:loop_task[0]']?.status,
    ).toBe('completed');
    expect(
      snapshots['0.parallel.2.inner_loop.0.parallel.0:loop_task[1]']?.status,
    ).toBe('completed');
  });

  it('supports while loops with pre-check semantics and zero iterations', async () => {
    const echoExecute = jest.fn(async ({ input }) => ({
      message: String(input.message),
    }));
    const echoAction = defineAction<
      { message?: unknown },
      { message: string },
      TestContext,
      Settings
    >({
      name: 'echo_action',
      inputSchema: z.object({ message: z.any() }),
      outputSchema: z.object({ message: z.string() }),
      execute: echoExecute,
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        loop_task: {
          action: 'echo_action',
          inputs: { message: '="ran"' },
        },
      }),
      flow: [
        {
          loop: {
            type: 'while',
            name: 'while_loop',
            while: '=$exists($output.loop_task)',
            steps: [{ do: 'loop_task' }],
          },
        },
      ],
      outputs: {
        ran: '=$exists($output.loop_task)',
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        echo_action: echoAction,
      },
    });
    const runner = new WorkflowRunner(compiled, {
      runId: 'run-while-zero-iteration',
    });
    const context = new TestContext({});
    const result = await runner.start({
      inputData: {},
      context,
    });

    expect(result.status).toBe('finished');
    if (result.status === 'finished') {
      expect(result.output.ran).toBe(false);
    }
    expect(echoExecute).not.toHaveBeenCalled();
  });

  it('supports suspension and resume in while loops', async () => {
    const suspendAction = defineAction<
      { prompt: string },
      { reply: string; done: boolean },
      TestContext,
      Settings
    >({
      name: 'loop_suspend_action',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ reply: z.string(), done: z.boolean() }),
      execute: async ({ input, context }) => {
        const resumeData = (await context.workflow.suspend({
          reason: 'awaiting_reply',
          data: { prompt: input.prompt },
        })) as { reply: string };

        return {
          reply: resumeData.reply,
          done: resumeData.reply === 'stop',
        };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'loop_suspend_action',
          inputs: { prompt: '="Attempt " & $string($iteration.index)' },
        },
      }),
      flow: [
        {
          loop: {
            type: 'while',
            name: 'wait_until_stop',
            while:
              '=$not($exists($output.wait_step.done) and $output.wait_step.done = true)',
            steps: [{ do: 'wait_step' }],
          },
        },
      ],
      outputs: { reply: '=$output.wait_step.reply' },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        loop_suspend_action: suspendAction,
      },
    });
    const runner = new WorkflowRunner(compiled, { runId: 'run-while-suspend' });
    const context = new TestContext({});
    const startResult = await runner.start({ inputData: {}, context });

    expect(startResult.status).toBe('suspended');
    if (startResult.status !== 'suspended') {
      throw new Error('Workflow did not suspend as expected');
    }
    expect(startResult.step.id).toBe('0.wait_until_stop.0:wait_step[0]');

    const firstResume = await runner.resume({
      resumeData: { reply: 'continue' },
    });
    expect(firstResume.status).toBe('suspended');
    if (firstResume.status !== 'suspended') {
      throw new Error('Workflow did not suspend on second iteration');
    }
    expect(firstResume.step.id).toBe('0.wait_until_stop.0:wait_step[1]');

    const secondResume = await runner.resume({
      resumeData: { reply: 'stop' },
    });
    expect(secondResume.status).toBe('finished');
    if (secondResume.status === 'finished') {
      expect(secondResume.output.reply).toBe('stop');
    }
  });

  it('continues following steps after a repeatedly suspended while loop exits', async () => {
    const suspendAction = defineAction<
      { prompt: string },
      { reply: string; done: boolean },
      TestContext,
      Settings
    >({
      name: 'loop_suspend_action',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ reply: z.string(), done: z.boolean() }),
      execute: async ({ input, context }) => {
        const resumeData = (await context.workflow.suspend({
          reason: 'awaiting_reply',
          data: { prompt: input.prompt },
        })) as { reply: string };

        return {
          reply: resumeData.reply,
          done: resumeData.reply === 'stop',
        };
      },
    });
    const afterExecute = jest.fn(async ({ input }) => ({
      stored: `stored:${input.reply}`,
    }));
    const afterAction = defineAction<
      { reply: string },
      { stored: string },
      TestContext,
      Settings
    >({
      name: 'after_loop_action',
      inputSchema: z.object({ reply: z.string() }),
      outputSchema: z.object({ stored: z.string() }),
      execute: afterExecute,
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'loop_suspend_action',
          inputs: { prompt: '="Attempt " & $string($iteration.index)' },
        },
        after_loop_step: {
          action: 'after_loop_action',
          inputs: { reply: '=$output.wait_step.reply' },
        },
      }),
      flow: [
        {
          loop: {
            type: 'while',
            name: 'wait_until_stop',
            while:
              '=$not($exists($output.wait_step.done) and $output.wait_step.done = true)',
            steps: [{ do: 'wait_step' }],
          },
        },
        { do: 'after_loop_step' },
      ],
      outputs: {
        reply: '=$output.wait_step.reply',
        stored: '=$output.after_loop_step.stored',
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        loop_suspend_action: suspendAction,
        after_loop_action: afterAction,
      },
    });
    const runner = new WorkflowRunner(compiled, {
      runId: 'run-while-suspend-after',
    });
    const context = new TestContext({});
    const startResult = await runner.start({ inputData: {}, context });

    expect(startResult.status).toBe('suspended');
    const firstResume = await runner.resume({
      resumeData: { reply: 'continue' },
    });

    expect(firstResume.status).toBe('suspended');
    const secondResume = await runner.resume({
      resumeData: { reply: 'stop' },
    });

    expect(secondResume.status).toBe('finished');
    if (secondResume.status === 'finished') {
      expect(secondResume.output.reply).toBe('stop');
      expect(secondResume.output.stored).toBe('stored:stop');
    }
    expect(afterExecute).toHaveBeenCalledTimes(1);
    expect(afterExecute).toHaveBeenCalledWith(
      expect.objectContaining({ input: { reply: 'stop' } }),
    );
  });

  it('handles suspension and resumes with provided data', async () => {
    const suspendAction = defineAction<
      { prompt: string },
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'suspend_action',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ context }) => {
        const resumeData = (await context.workflow.suspend({
          reason: 'awaiting_user',
          data: { channel: 'sms' },
        })) as { reply: string };

        return { reply: resumeData.reply };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'suspend_action',
          inputs: { prompt: '="Ping"' },
        },
      }),
      flow: [{ do: 'wait_step' }],
      outputs: { reply: '=$output.wait_step.reply' },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        suspend_action: suspendAction,
      },
    });
    const runner = new WorkflowRunner(compiled, { runId: 'run-2' });
    const context = new TestContext({});
    const startResult = await runner.start({ inputData: {}, context });
    expect(startResult.status).toBe('suspended');
    if (startResult.status === 'suspended') {
      expect(startResult.reason).toBe('awaiting_user');
      expect(runner.getStatus()).toBe('suspended');
      expect(runner.getSnapshot().actions[startResult.step.id]?.status).toBe(
        'suspended',
      );
    }

    const resume = await runner.resume({ resumeData: { reply: 'Sure' } });
    expect(resume.status).toBe('finished');
    if (resume.status === 'finished') {
      expect(resume.output.reply).toBe('Sure');
      expect(runner.getLastResumeData()).toEqual({ reply: 'Sure' });
    }

    expect(() => context.workflow).toThrow();
  });

  it('fails when a parallel branch attempts to suspend', async () => {
    const suspendAction = defineAction<
      unknown,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'parallel_suspend_action',
      inputSchema: z.any(),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ context }) => {
        await context.workflow.suspend({ reason: 'not_allowed' });

        return { reply: 'unreachable' };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: { action: 'parallel_suspend_action' },
      }),
      flow: [
        {
          parallel: {
            strategy: 'wait_all',
            steps: [{ do: 'wait_step' }],
          },
        },
      ],
      outputs: { reply: '=$output.wait_step.reply' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { parallel_suspend_action: suspendAction },
    });
    const runner = new WorkflowRunner(compiled, {
      runId: 'run-parallel-suspend',
    });
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toBeInstanceOf(ParallelSuspensionError);
    }
    expect(
      runner.getSnapshot().actions['0.parallel.0:wait_step'],
    ).toMatchObject({
      status: 'failed',
      reason: 'workflow.suspend() is not supported inside a parallel block.',
    });
  });

  it('accepts emitter-like implementations without Node EventEmitter', async () => {
    const pingAction = defineAction<
      unknown,
      { ok: boolean },
      TestContext,
      Settings
    >({
      name: 'ping_action',
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        ping_step: { action: 'ping_action' },
      }),
      flow: [{ do: 'ping_step' }],
      outputs: { ok: '=$output.ping_step.ok' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { ping_action: pingAction },
    });
    const emitter = new MemoryEmitter();
    const events: Array<{
      event: keyof WorkflowEventMap;
      payload: WorkflowEventMap[keyof WorkflowEventMap];
    }> = [];

    emitter.on('hook:workflow:start', (payload) =>
      events.push({ event: 'hook:workflow:start', payload }),
    );
    emitter.on('hook:step:start', (payload) =>
      events.push({ event: 'hook:step:start', payload }),
    );
    emitter.on('hook:step:success', (payload) =>
      events.push({ event: 'hook:step:success', payload }),
    );
    emitter.on('hook:workflow:finish', (payload) =>
      events.push({ event: 'hook:workflow:finish', payload }),
    );

    const runner = new WorkflowRunner(compiled, { runId: 'custom-run' });
    const context = new TestMemoryContext({});
    context.eventEmitter = emitter;
    const result = await runner.start({ inputData: {}, context });

    expect(result.status).toBe('finished');
    expect(events.map((entry) => entry.event)).toEqual([
      'hook:workflow:start',
      'hook:step:start',
      'hook:step:success',
      'hook:workflow:finish',
    ]);
    const finish = events.find(
      (entry) => entry.event === 'hook:workflow:finish',
    );
    expect(finish?.payload.runId).toBe('custom-run');
  });

  it('exposes the configured event emitter on the context for actions', async () => {
    let observedEmitter:
      | WorkflowEventEmitterLike<WorkflowEventEmitter>
      | undefined;
    const emitter = new WorkflowEventEmitter();
    const skippedEvents: Array<{ stepId: string; reason?: string }> = [];

    emitter.on('hook:step:skipped', ({ step, reason }) =>
      skippedEvents.push({ stepId: step.id, reason }),
    );

    const emitAction = defineAction<
      { note: string },
      { note: string },
      TestContext,
      Settings
    >({
      name: 'emit_action',
      inputSchema: z.object({ note: z.string() }),
      outputSchema: z.object({ note: z.string() }),
      execute: async ({ input, context }) => {
        observedEmitter = context.eventEmitter;
        context.eventEmitter?.emit('hook:step:skipped', {
          runId: 'ctx-run',
          step: { id: 'manual', name: 'emit_action', type: StepType.Task },
          reason: input.note,
        });

        return { note: input.note };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        emit_step: {
          action: 'emit_action',
          inputs: { note: '=$input.note' },
        },
      }),
      flow: [{ do: 'emit_step' }],
      outputs: { note: '=$output.emit_step.note' },
      inputs: {
        schema: {
          note: { type: 'string' },
        },
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: { emit_action: emitAction },
    });
    const runner = new WorkflowRunner(compiled, { runId: 'ctx-run' });
    const context = new TestContext({});
    context.eventEmitter = emitter;
    const result = await runner.start({
      inputData: { note: 'custom-event' },
      context,
    });

    expect(result.status).toBe('finished');
    expect(observedEmitter).toBe(emitter);
    expect(skippedEvents).toEqual([
      { stepId: 'manual', reason: 'custom-event' },
    ]);
  });

  it('bubbles action errors and prevents resume when not suspended', async () => {
    const failingAction = defineAction<unknown, unknown, TestContext, Settings>(
      {
        name: 'failing_action',
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => {
          throw new Error('boom');
        },
      },
    );
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        fail_step: {
          action: 'failing_action',
          inputs: { value: 1 },
        },
      }),
      flow: [{ do: 'fail_step' }],
      outputs: { value: '=$output.fail_step.value' },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        failing_action: failingAction,
      },
    });
    const runner = new WorkflowRunner(compiled);
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect((result.error as Error).message).toBe('boom');
      expect(runner.getSnapshot().actions['0:fail_step']?.status).toBe(
        'failed',
      );
    }

    await expect(runner.resume({ resumeData: {} })).rejects.toThrow(
      'Cannot resume a workflow that is not suspended.',
    );
  });

  it('resumes a suspended step and continues executing the remaining flow', async () => {
    const suspendAction = defineAction<
      { prompt: string },
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'resume_suspend_action',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ context }) => {
        const resumeData = (await context.workflow.suspend({
          reason: 'need_reply',
        })) as { reply: string };

        return { reply: resumeData.reply };
      },
    });
    const followExecute = jest.fn(async ({ input }) => ({
      formatted: input.message.toUpperCase(),
    }));
    const followAction = defineAction<
      { message: string },
      { formatted: string },
      TestContext,
      Settings
    >({
      name: 'follow_action',
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ formatted: z.string() }),
      execute: followExecute,
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'resume_suspend_action',
          inputs: { prompt: '="Ping?"' },
        },
        follow_step: {
          action: 'follow_action',
          inputs: { message: '=$output.wait_step.reply' },
        },
      }),
      flow: [{ do: 'wait_step' }, { do: 'follow_step' }],
      outputs: {
        reply: '=$output.wait_step.reply',
        formatted: '=$output.follow_step.formatted',
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        resume_suspend_action: suspendAction,
        follow_action: followAction,
      },
    });
    const runner = new WorkflowRunner(compiled);
    const startResult = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(startResult.status).toBe('suspended');
    if (startResult.status !== 'suspended') {
      throw new Error('workflow did not suspend');
    }

    expect(startResult.step.id).toBe('0:wait_step');
    expect(runner.getSnapshot().actions['0:wait_step']?.status).toBe(
      'suspended',
    );

    const resumeResult = await runner.resume({ resumeData: { reply: 'ok' } });
    expect(resumeResult.status).toBe('finished');
    if (resumeResult.status === 'finished') {
      expect(resumeResult.output.reply).toBe('ok');
      expect(resumeResult.output.formatted).toBe('OK');
      expect(followExecute).toHaveBeenCalledTimes(1);
      expect(runner.getSnapshot().actions['0:wait_step']?.status).toBe(
        'completed',
      );
      expect(runner.getSnapshot().actions['1:follow_step']?.status).toBe(
        'completed',
      );
    }
  });

  it('stores the raw task result under $output', async () => {
    const rawAction = defineAction<
      { value: string },
      string,
      TestContext,
      Settings
    >({
      name: 'raw_action',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.string(),
      execute: async ({ input }) => `echo:${input.value}`,
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        raw_step: { action: 'raw_action', inputs: { value: '="hello"' } },
      }),
      flow: [{ do: 'raw_step' }],
      outputs: { final: '=$output.raw_step' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { raw_action: rawAction },
    });
    const runner = new WorkflowRunner(compiled);
    const result = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(result.status).toBe('finished');
    if (result.status === 'finished') {
      expect(result.output.final).toBe('echo:hello');
      const runtimeState = (runner as unknown as { state: ExecutionState })
        .state;
      expect(runtimeState?.output.raw_step).toBe('echo:hello');
      expect(runner.getSnapshot().actions['0:raw_step']?.status).toBe(
        'completed',
      );
    }
  });

  it('throws when a persisted suspension cannot be rebuilt', async () => {
    const noopAction = defineAction<
      unknown,
      { ok: boolean },
      TestContext,
      Settings
    >({
      name: 'noop_action',
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        only_step: { action: 'noop_action', inputs: {} },
      }),
      flow: [{ do: 'only_step' }],
      outputs: { ok: '=$output.only_step.ok' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { noop_action: noopAction },
    });
    const persistedState: ExecutionState = {
      input: {},
      output: {},
      iterationStack: [],
    };

    await expect(
      WorkflowRunner.fromPersistedState(compiled, {
        state: persistedState,
        context: new TestContext({}),
        snapshot: { status: 'suspended', actions: {} },
        suspension: { stepId: 'unknown.step', reason: null, data: undefined },
      }),
    ).rejects.toThrow('Unable to rebuild suspension for step unknown.step');
  });

  it('rebuilds loop suspension using the iteration suffix when iterationStack is missing', async () => {
    const suspendAction = defineAction<
      { prompt: string },
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'loop_suspend_action',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ input, context }) => {
        const resumeData = (await context.workflow.suspend({
          reason: 'awaiting_reply',
          data: { prompt: input.prompt },
        })) as { reply: string };

        return { reply: `ack:${resumeData.reply}` };
      },
    });
    const afterAction = defineAction<
      { reply: string },
      { summary: string },
      TestContext,
      Settings
    >({
      name: 'after_loop_action',
      inputSchema: z.object({ reply: z.string() }),
      outputSchema: z.object({ summary: z.string() }),
      execute: async ({ input }) => ({ summary: `after:${input.reply}` }),
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'loop_suspend_action',
          inputs: { prompt: '="Ping"' },
        },
        after_step: {
          action: 'after_loop_action',
          inputs: { reply: '=$output.wait_step.reply' },
        },
      }),
      flow: [
        {
          loop: {
            type: 'for_each',
            name: 'iterate',
            for_each: { item: 'entry', in: '=$input.items' },
            steps: [{ do: 'wait_step' }],
          },
        },
        { do: 'after_step' },
      ],
      outputs: {
        reply: '=$output.wait_step.reply',
        summary: '=$output.after_step.summary',
      },
      inputs: {
        schema: {
          items: { type: 'array', items: { type: 'string' } },
        },
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        loop_suspend_action: suspendAction,
        after_loop_action: afterAction,
      },
    });
    const runner = new WorkflowRunner(compiled);
    const context = new TestContext({});
    const startResult = await runner.start({
      inputData: { items: ['first'] },
      context,
    });

    expect(startResult.status).toBe('suspended');
    if (startResult.status !== 'suspended') {
      throw new Error('Workflow did not suspend as expected');
    }

    expect(startResult.step.id).toBe('0.iterate.0:wait_step[0]');

    const runtimeState = (runner as unknown as { state: ExecutionState }).state;
    const persistedState: ExecutionState = {
      input: { ...runtimeState.input },
      output: { ...runtimeState.output },
      iteration: runtimeState.iteration,
      accumulator: runtimeState.accumulator,
      iterationStack: [],
    };
    const rebuilt = await WorkflowRunner.fromPersistedState(compiled, {
      state: persistedState,
      context: new TestContext({}),
      snapshot: startResult.snapshot,
      suspension: {
        stepId: startResult.step.id,
        reason: startResult.reason ?? null,
        data: startResult.data,
      },
    });
    const resumeResult = await rebuilt.resume({
      resumeData: { reply: 'Pong' },
    });
    expect(resumeResult.status).toBe('finished');
    if (resumeResult.status === 'finished') {
      expect(resumeResult.output.reply).toBe('ack:Pong');
      expect(resumeResult.output.summary).toBe('after:ack:Pong');
    }
  });

  it('rebuilds a task suspended on a later suspend() call using suspend metadata and await history', async () => {
    const multiSuspendAction = defineAction<
      unknown,
      { firstReply: string; secondReply: string },
      TestContext,
      Settings
    >({
      name: 'multi_suspend_action',
      inputSchema: z.any(),
      outputSchema: z.object({
        firstReply: z.string(),
        secondReply: z.string(),
      }),
      execute: async ({ context }) => {
        const first = (await context.workflow.suspend({
          reason: 'first_pause',
          data: { order: 1 },
        })) as { reply: string };
        const second = (await context.workflow.suspend({
          reason: 'second_pause',
          data: { order: 2 },
        })) as { reply: string };

        return {
          firstReply: first.reply,
          secondReply: second.reply,
        };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'multi_suspend_action',
          inputs: {},
        },
      }),
      flow: [{ do: 'wait_step' }],
      outputs: {
        firstReply: '=$output.wait_step.firstReply',
        secondReply: '=$output.wait_step.secondReply',
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        multi_suspend_action: multiSuspendAction,
      },
    });
    const runner = new WorkflowRunner(compiled);
    const context = new TestContext({});
    const firstSuspension = await runner.start({ inputData: {}, context });
    expect(firstSuspension.status).toBe('suspended');
    if (firstSuspension.status !== 'suspended') {
      throw new Error('Workflow did not suspend on first await point');
    }

    expect(firstSuspension.suspendIndex).toBe(1);
    expect(firstSuspension.suspendKey).toBe('index:1');
    expect(firstSuspension.awaitResults).toEqual({});

    const secondSuspension = await runner.resume({
      resumeData: { reply: 'first-answer' },
    });
    expect(secondSuspension.status).toBe('suspended');
    if (secondSuspension.status !== 'suspended') {
      throw new Error('Workflow did not suspend on second await point');
    }

    expect(secondSuspension.suspendIndex).toBe(2);
    expect(secondSuspension.suspendKey).toBe('index:2');
    expect(secondSuspension.awaitResults).toEqual({
      'index:1': { reply: 'first-answer' },
    });

    const runtimeState = runner.getState() as ExecutionState;
    const persistedState: ExecutionState = {
      input: { ...runtimeState.input },
      output: { ...runtimeState.output },
      iteration: runtimeState.iteration,
      accumulator: runtimeState.accumulator,
      iterationStack: [...runtimeState.iterationStack],
    };
    const rebuilt = await WorkflowRunner.fromPersistedState(compiled, {
      state: persistedState,
      context: new TestContext({}),
      snapshot: secondSuspension.snapshot,
      suspension: {
        stepId: secondSuspension.step.id,
        reason: secondSuspension.reason ?? null,
        data: secondSuspension.data,
        stepExecId: secondSuspension.stepExecId,
        suspendIndex: secondSuspension.suspendIndex,
        suspendKey: secondSuspension.suspendKey,
        awaitResults: secondSuspension.awaitResults,
      },
    });
    const finalResult = await rebuilt.resume({
      resumeData: { reply: 'second-answer' },
    });

    expect(finalResult.status).toBe('finished');
    if (finalResult.status === 'finished') {
      expect(finalResult.output.firstReply).toBe('first-answer');
      expect(finalResult.output.secondReply).toBe('second-answer');
    }
  });

  it('lets actions skip side effects via hasRecordedResult when replaying a resumed step', async () => {
    const sideEffects: string[] = [];
    const spawnAction = defineAction<
      unknown,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'spawn_then_wait_action',
      inputSchema: z.any(),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ context }) => {
        // Deterministic replay re-runs this body; the guard must prevent the
        // side effect from executing a second time.
        if (!context.workflow.hasRecordedResult()) {
          sideEffects.push('spawn');
        }

        const resumeData = (await context.workflow.suspend({
          reason: 'awaiting_child_workflow',
        })) as { reply: string };

        return { reply: resumeData.reply };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'spawn_then_wait_action',
          inputs: {},
        },
      }),
      flow: [{ do: 'wait_step' }],
      outputs: { reply: '=$output.wait_step.reply' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { spawn_then_wait_action: spawnAction },
    });
    const runner = new WorkflowRunner(compiled);
    const startResult = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    expect(startResult.status).toBe('suspended');
    if (startResult.status !== 'suspended') {
      throw new Error('Workflow did not suspend as expected');
    }

    expect(sideEffects).toEqual(['spawn']);

    const runtimeState = runner.getState() as ExecutionState;
    const rebuilt = await WorkflowRunner.fromPersistedState(compiled, {
      state: {
        input: { ...runtimeState.input },
        output: { ...runtimeState.output },
        iteration: runtimeState.iteration,
        accumulator: runtimeState.accumulator,
        iterationStack: [...runtimeState.iterationStack],
      },
      context: new TestContext({}),
      snapshot: startResult.snapshot,
      suspension: {
        stepId: startResult.step.id,
        reason: startResult.reason ?? null,
        data: startResult.data,
        stepExecId: startResult.stepExecId,
        suspendIndex: startResult.suspendIndex,
        suspendKey: startResult.suspendKey,
        awaitResults: startResult.awaitResults,
      },
    });
    const resumeResult = await rebuilt.resume({
      resumeData: { reply: 'child-finished' },
    });

    expect(resumeResult.status).toBe('finished');
    if (resumeResult.status === 'finished') {
      expect(resumeResult.output.reply).toBe('child-finished');
    }

    // The side effect must not run a second time during deterministic replay.
    expect(sideEffects).toEqual(['spawn']);
  });

  it('reports recorded results only for suspensions that will replay immediately', async () => {
    const observed: boolean[] = [];
    const multiSuspendAction = defineAction<
      unknown,
      { firstReply: string; secondReply: string },
      TestContext,
      Settings
    >({
      name: 'observing_multi_suspend_action',
      inputSchema: z.any(),
      outputSchema: z.object({
        firstReply: z.string(),
        secondReply: z.string(),
      }),
      execute: async ({ context }) => {
        observed.push(context.workflow.hasRecordedResult());
        const first = (await context.workflow.suspend({
          reason: 'first_pause',
        })) as { reply: string };

        observed.push(context.workflow.hasRecordedResult());
        const second = (await context.workflow.suspend({
          reason: 'second_pause',
        })) as { reply: string };

        return {
          firstReply: first.reply,
          secondReply: second.reply,
        };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'observing_multi_suspend_action',
          inputs: {},
        },
      }),
      flow: [{ do: 'wait_step' }],
      outputs: {
        firstReply: '=$output.wait_step.firstReply',
        secondReply: '=$output.wait_step.secondReply',
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: { observing_multi_suspend_action: multiSuspendAction },
    });
    const runner = new WorkflowRunner(compiled);
    const firstSuspension = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    expect(firstSuspension.status).toBe('suspended');

    const secondSuspension = await runner.resume({
      resumeData: { reply: 'first-answer' },
    });
    expect(secondSuspension.status).toBe('suspended');
    if (secondSuspension.status !== 'suspended') {
      throw new Error('Workflow did not suspend on second await point');
    }

    // In-memory execution never sees pre-recorded results.
    expect(observed).toEqual([false, false]);

    const runtimeState = runner.getState() as ExecutionState;
    const rebuilt = await WorkflowRunner.fromPersistedState(compiled, {
      state: {
        input: { ...runtimeState.input },
        output: { ...runtimeState.output },
        iteration: runtimeState.iteration,
        accumulator: runtimeState.accumulator,
        iterationStack: [...runtimeState.iterationStack],
      },
      context: new TestContext({}),
      snapshot: secondSuspension.snapshot,
      suspension: {
        stepId: secondSuspension.step.id,
        reason: secondSuspension.reason ?? null,
        data: secondSuspension.data,
        stepExecId: secondSuspension.stepExecId,
        suspendIndex: secondSuspension.suspendIndex,
        suspendKey: secondSuspension.suspendKey,
        awaitResults: secondSuspension.awaitResults,
      },
    });
    const finalResult = await rebuilt.resume({
      resumeData: { reply: 'second-answer' },
    });

    expect(finalResult.status).toBe('finished');
    if (finalResult.status === 'finished') {
      expect(finalResult.output.firstReply).toBe('first-answer');
      expect(finalResult.output.secondReply).toBe('second-answer');
    }

    // During replay both suspensions have recorded results awaiting them.
    expect(observed).toEqual([false, false, true, true]);
  });

  it('fails resume when replay suspension metadata does not match the workflow code path', async () => {
    const suspendAction = defineAction<
      unknown,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'single_suspend_action',
      inputSchema: z.any(),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ context }) => {
        const resumeData = (await context.workflow.suspend({
          reason: 'actual_reason',
        })) as { reply: string };

        return { reply: resumeData.reply };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'single_suspend_action',
          inputs: {},
        },
      }),
      flow: [{ do: 'wait_step' }],
      outputs: { reply: '=$output.wait_step.reply' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { single_suspend_action: suspendAction },
    });
    const runner = new WorkflowRunner(compiled);
    const startResult = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    expect(startResult.status).toBe('suspended');
    if (startResult.status !== 'suspended') {
      throw new Error('Workflow did not suspend as expected');
    }

    const runtimeState = runner.getState() as ExecutionState;
    const rebuilt = await WorkflowRunner.fromPersistedState(compiled, {
      state: {
        input: { ...runtimeState.input },
        output: { ...runtimeState.output },
        iteration: runtimeState.iteration,
        accumulator: runtimeState.accumulator,
        iterationStack: [...runtimeState.iterationStack],
      },
      context: new TestContext({}),
      snapshot: startResult.snapshot,
      suspension: {
        stepId: startResult.step.id,
        reason: 'different_reason',
        data: startResult.data,
        stepExecId: startResult.stepExecId,
        suspendIndex: startResult.suspendIndex,
        suspendKey: startResult.suspendKey,
        awaitResults: startResult.awaitResults,
      },
    });
    const resumeResult = await rebuilt.resume({
      resumeData: { reply: 'value' },
    });

    expect(resumeResult.status).toBe('failed');
    if (resumeResult.status === 'failed') {
      expect((resumeResult.error as Error).name).toBe(
        'NonDeterministicWorkflowError',
      );
      expect(String((resumeResult.error as Error).message)).toContain(
        'expected reason \"different_reason\"',
      );
    }
  });

  it('registers custom JSONata functions during compilation', async () => {
    const translate = jest.fn((text: string) => `i18n:${text}`);
    const sendAction = defineAction<
      { text: string },
      { delivered: string },
      TestContext,
      Settings
    >({
      name: 'send_action',
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ delivered: z.string() }),
      execute: async ({ input }) => ({ delivered: input.text }),
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        send_goodbye: {
          action: 'send_action',
          inputs: { text: "=$i18n('Bye bye')" },
        },
      }),
      flow: [{ do: 'send_goodbye' }],
      outputs: { message: '=$output.send_goodbye.delivered' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { send_action: sendAction },
      jsonataFunctions: { i18n: translate },
    });
    const runner = new WorkflowRunner(compiled);
    const context = new TestContext({});
    const result = await runner.start({ inputData: {}, context });

    expect(result.status).toBe('finished');
    if (result.status === 'finished') {
      expect(result.output.message).toBe('i18n:Bye bye');
    }
    expect(translate).toHaveBeenCalledWith('Bye bye');
  });

  it('records step execution details with context snapshots', async () => {
    const countAction = defineAction<
      { amount: number },
      { total: number },
      TestContext,
      Settings
    >({
      name: 'count_action',
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.object({ total: z.number() }),
      execute: async ({ input, context }) => {
        const current = Number(context.state.count ?? 0);
        const total = current + input.amount;
        context.state.count = total;

        return { total };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        count_step: {
          action: 'count_action',
          inputs: { amount: '=$input.amount' },
        },
      }),
      flow: [{ do: 'count_step' }],
      outputs: { total: '=$output.count_step.total' },
      inputs: {
        schema: {
          amount: { type: 'number' },
        },
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: { count_action: countAction },
    });
    const runner = new WorkflowRunner(compiled);
    const context = new TestContext({ count: 1 });
    const result = await runner.start({ inputData: { amount: 2 }, context });

    expect(result.status).toBe('finished');
    const record = runner.getStepLog()['0:count_step'];
    expect(record).toMatchObject({
      id: '0:count_step',
      name: 'count_step',
      action: 'count_action',
      status: 'completed',
      input: { amount: 2 },
      output: { total: 3 },
      context: { before: { count: 1 }, after: { count: 3 } },
    });
    expect(record?.startedAt).toEqual(expect.any(Number));
    expect(record?.endedAt).toEqual(expect.any(Number));
    expect(record.endedAt as number).toBeGreaterThanOrEqual(
      record.startedAt as number,
    );
  });

  it('uses the context snapshot hook when capturing step context', async () => {
    class FilteredContext extends BaseWorkflowContext<
      Record<string, unknown>,
      WorkflowEventEmitter
    > {
      public eventEmitter: WorkflowEventEmitterLike<WorkflowEventEmitter> =
        new WorkflowEventEmitter();

      snapshot(): Record<string, unknown> {
        return { safe: this.state.safe };
      }
    }

    const mutateAction = defineAction<
      unknown,
      { ok: boolean },
      FilteredContext,
      Settings
    >({
      name: 'mutate_action',
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async ({ context }) => {
        context.state.safe = 'after';
        context.state.secret = 'should-not-leak';

        return { ok: true };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        mutate_step: { action: 'mutate_action' },
      }),
      flow: [{ do: 'mutate_step' }],
      outputs: { ok: '=$output.mutate_step.ok' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { mutate_action: mutateAction },
    });
    const runner = new WorkflowRunner(compiled);
    const context = new FilteredContext({ safe: 'before', secret: 'hidden' });
    const result = await runner.start({ inputData: {}, context });

    expect(result.status).toBe('finished');
    const record = runner.getStepLog()['0:mutate_step'];
    expect(record?.action).toBe('mutate_action');
    expect(record?.context?.before).toEqual({ safe: 'before' });
    expect(record?.context?.after).toEqual({ safe: 'after' });
    expect(record?.context?.before).not.toHaveProperty('secret');
    expect(record?.context?.after).not.toHaveProperty('secret');
  });
});

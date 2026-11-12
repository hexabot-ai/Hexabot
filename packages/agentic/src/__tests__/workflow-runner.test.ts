/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../action/action';
import type { TaskFrame, WorkflowCheckpoint } from '../checkpoint';
import { BaseWorkflowContext } from '../context';
import type { Settings, WorkflowDefinition } from '../dsl.types';
import {
  WorkflowCheckpointInvalidError,
  WorkflowInputRejectedError,
} from '../errors';
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

/** Round-trip a checkpoint through JSON, as a host database would. */
const persist = (checkpoint: WorkflowCheckpoint): WorkflowCheckpoint =>
  JSON.parse(JSON.stringify(checkpoint));
/** Read the task frame of a checkpoint suspended on a top-level task. */
const suspendedTask = (checkpoint: WorkflowCheckpoint): TaskFrame =>
  checkpoint.root.child as TaskFrame;
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
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'number' } },
          },
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
    expect(startResult.waits[0].step.id).toBe(
      '0.wait_until_stop.0:wait_step[0]',
    );

    const firstResume = await runner.resume({
      resumeData: { reply: 'continue' },
    });
    expect(firstResume.status).toBe('suspended');
    if (firstResume.status !== 'suspended') {
      throw new Error('Workflow did not suspend on second iteration');
    }
    expect(firstResume.waits[0].step.id).toBe(
      '0.wait_until_stop.0:wait_step[1]',
    );

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
      expect(startResult.waits[0].reason).toBe('awaiting_user');
      expect(runner.getStatus()).toBe('suspended');
      expect(
        runner.getSnapshot().actions[startResult.waits[0].step.id]?.status,
      ).toBe('suspended');
    }

    const resume = await runner.resume({ resumeData: { reply: 'Sure' } });
    expect(resume.status).toBe('finished');
    if (resume.status === 'finished') {
      expect(resume.output.reply).toBe('Sure');
    }

    expect(() => context.workflow).toThrow();
  });

  it('suspends and resumes inside a parallel branch', async () => {
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
        const resumed = (await context.workflow.suspend({
          reason: 'awaiting_reply',
        })) as { reply: string };

        return { reply: resumed.reply };
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

    expect(result.status).toBe('suspended');
    if (result.status === 'suspended') {
      expect(result.waits.map((wait) => wait.step.id)).toEqual([
        '0.parallel.0:wait_step',
      ]);
    }
    expect(
      runner.getSnapshot().actions['0.parallel.0:wait_step'],
    ).toMatchObject({ status: 'suspended', reason: 'awaiting_reply' });

    const resumed = await runner.resume({ resumeData: { reply: 'done' } });

    expect(resumed.status).toBe('finished');
    if (resumed.status === 'finished') {
      expect(resumed.output).toEqual({ reply: 'done' });
    }
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
          type: 'object',
          properties: { note: { type: 'string' } },
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

    expect(startResult.waits[0].step.id).toBe('0:wait_step');
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

  it('refuses to restore a run without a checkpoint', () => {
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

    expect(() =>
      WorkflowRunner.fromCheckpoint(compiled, {
        checkpoint: null,
        context: new TestContext({}),
      }),
    ).toThrow(WorkflowCheckpointInvalidError);
  });

  it('restores a loop suspension from a persisted checkpoint', async () => {
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
          inputs: { prompt: '=$iteration.item' },
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
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'string' } },
          },
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
    const startResult = await runner.start({
      inputData: { items: ['first'] },
      context: new TestContext({}),
    });

    expect(startResult.status).toBe('suspended');
    if (startResult.status !== 'suspended') {
      throw new Error('Workflow did not suspend as expected');
    }

    expect(startResult.waits[0]).toMatchObject({
      step: { id: '0.iterate.0:wait_step[0]' },
      reason: 'awaiting_reply',
      data: { prompt: 'first' },
    });

    const rebuilt = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: persist(startResult.checkpoint),
      context: new TestContext({}),
      snapshot: startResult.snapshot,
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

  it('restores a task suspended on a later suspend() call with its earlier results', async () => {
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

    expect(firstSuspension.waits[0]).toMatchObject({
      waitId: '0:wait_step@index:1',
      suspendKey: 'index:1',
    });
    expect(suspendedTask(firstSuspension.checkpoint).awaitResults).toEqual({});

    const secondSuspension = await runner.resume({
      resumeData: { reply: 'first-answer' },
    });
    expect(secondSuspension.status).toBe('suspended');
    if (secondSuspension.status !== 'suspended') {
      throw new Error('Workflow did not suspend on second await point');
    }

    expect(secondSuspension.waits[0]).toMatchObject({
      waitId: '0:wait_step@index:2',
      suspendKey: 'index:2',
      reason: 'second_pause',
    });
    expect(suspendedTask(secondSuspension.checkpoint).awaitResults).toEqual({
      'index:1': { value: { reply: 'first-answer' } },
    });

    const rebuilt = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: persist(secondSuspension.checkpoint),
      context: new TestContext({}),
      snapshot: secondSuspension.snapshot,
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

  it('lets actions skip side effects via hasRecordedResult when a resumed body re-runs', async () => {
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
        // A resumed body re-runs; the guard must prevent the side effect
        // from executing a second time.
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

    const rebuilt = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: persist(startResult.checkpoint),
      context: new TestContext({}),
      snapshot: startResult.snapshot,
    });
    const resumeResult = await rebuilt.resume({
      resumeData: { reply: 'child-finished' },
    });

    expect(resumeResult.status).toBe('finished');
    if (resumeResult.status === 'finished') {
      expect(resumeResult.output.reply).toBe('child-finished');
    }

    expect(sideEffects).toEqual(['spawn']);
  });

  it('reports recorded results only for suspensions that will resolve immediately', async () => {
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
    expect(observed).toEqual([false]);

    const secondSuspension = await runner.resume({
      resumeData: { reply: 'first-answer' },
    });
    expect(secondSuspension.status).toBe('suspended');
    if (secondSuspension.status !== 'suspended') {
      throw new Error('Workflow did not suspend on second await point');
    }

    // The resumed body re-runs: the first suspension is answered, the second is new.
    expect(observed).toEqual([false, true, false]);

    const rebuilt = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: persist(secondSuspension.checkpoint),
      context: new TestContext({}),
      snapshot: secondSuspension.snapshot,
    });
    const finalResult = await rebuilt.resume({
      resumeData: { reply: 'second-answer' },
    });

    expect(finalResult.status).toBe('finished');
    if (finalResult.status === 'finished') {
      expect(finalResult.output.firstReply).toBe('first-answer');
      expect(finalResult.output.secondReply).toBe('second-answer');
    }

    expect(observed).toEqual([false, true, false, true, true]);
  });

  it('keeps a resume without payload recorded across later suspensions', async () => {
    const sideEffects: string[] = [];
    const acknowledged: unknown[] = [];
    const acknowledgeAction = defineAction<
      unknown,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'acknowledge_then_ask_action',
      inputSchema: z.any(),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ context }) => {
        if (!context.workflow.hasRecordedResult()) {
          sideEffects.push('notify');
        }

        acknowledged.push(
          await context.workflow.suspend({ reason: 'acknowledge' }),
        );
        const answer = (await context.workflow.suspend({
          reason: 'ask',
        })) as { reply: string };

        return { reply: answer.reply };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        wait_step: {
          action: 'acknowledge_then_ask_action',
          inputs: {},
        },
      }),
      flow: [{ do: 'wait_step' }],
      outputs: { reply: '=$output.wait_step.reply' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { acknowledge_then_ask_action: acknowledgeAction },
    });
    const runner = new WorkflowRunner(compiled);
    const firstSuspension = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    expect(firstSuspension.status).toBe('suspended');

    // An "acknowledge" button resumes without sending a body.
    const secondSuspension = await runner.resume({});
    expect(secondSuspension.status).toBe('suspended');
    if (secondSuspension.status !== 'suspended') {
      throw new Error('Workflow did not suspend on second await point');
    }

    // Recorded as answered, without a value: JSON has no `undefined`.
    expect(suspendedTask(secondSuspension.checkpoint).awaitResults).toEqual({
      'index:1': {},
    });

    const rebuilt = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: persist(secondSuspension.checkpoint),
      context: new TestContext({}),
      snapshot: secondSuspension.snapshot,
    });
    const finalResult = await rebuilt.resume({
      resumeData: { reply: 'answer' },
    });

    expect(finalResult.status).toBe('finished');
    if (finalResult.status === 'finished') {
      expect(finalResult.output.reply).toBe('answer');
    }

    expect(sideEffects).toEqual(['notify']);
    // Every pass resolves the acknowledgement to the same persisted value.
    expect(acknowledged).toEqual([undefined, undefined]);
  });

  it('fails resume when the resumed body no longer matches the checkpoint', async () => {
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

    // Simulate action code that changed between suspension and resume.
    const checkpoint = persist(startResult.checkpoint);
    suspendedTask(checkpoint).wait.reason = 'different_reason';
    checkpoint.waits[0].reason = 'different_reason';

    const rebuilt = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint,
      context: new TestContext({}),
      snapshot: startResult.snapshot,
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
        'expected reason "different_reason"',
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
          type: 'object',
          properties: { amount: { type: 'number' } },
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
  it('parses a start without input data as an empty input', async () => {
    const action = defineAction({
      name: 'echo_action',
      execute: async () => ({ ok: true }),
    });
    const compiled = compileWorkflow(
      {
        inputs: {
          schema: { type: 'object', properties: { name: { type: 'string' } } },
        },
        defs: createTaskDefs({ echo: { action: 'echo_action' } }),
        flow: [{ do: 'echo' }],
        outputs: { input: '=$input' },
      },
      { actions: { echo_action: action } },
    );
    const runner = new WorkflowRunner(compiled);
    const result = await runner.start({
      inputData: undefined,
      context: new TestContext({}),
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'finished', output: { input: {} } }),
    );
    expect(runner.getState()).toEqual({
      input: {},
      output: { echo: { ok: true } },
      iterationStack: [],
    });
  });

  it('applies the default values of the input schema to $input', async () => {
    const action = defineAction({
      name: 'echo_action',
      execute: async () => ({ ok: true }),
    });
    const compiled = compileWorkflow(
      {
        inputs: {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              pages: { type: 'integer', default: 2 },
            },
            required: ['name'],
          },
        },
        defs: createTaskDefs({ echo: { action: 'echo_action' } }),
        flow: [{ do: 'echo' }],
        outputs: { input: '=$input' },
      },
      { actions: { echo_action: action } },
    );
    const result = await new WorkflowRunner(compiled).start({
      inputData: { name: 'Ada', extra: true },
      context: new TestContext({}),
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'finished',
        output: { input: { name: 'Ada', pages: 2, extra: true } },
      }),
    );
  });

  it('refuses an input that does not match the input schema, without starting', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const action = defineAction({ name: 'echo_action', execute });
    const compiled = compileWorkflow(
      {
        inputs: {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              pages: { type: 'integer' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        defs: createTaskDefs({ echo: { action: 'echo_action' } }),
        flow: [{ do: 'echo' }],
        outputs: {},
      },
      { actions: { echo_action: action } },
    );
    const emitter = new WorkflowEventEmitter();
    const events: string[] = [];
    emitter.on('hook:workflow:start', () => events.push('start'));
    emitter.on('hook:workflow:failure', () => events.push('failure'));
    const context = new TestContext({});
    context.eventEmitter = emitter;
    const runner = new WorkflowRunner(compiled);
    const statusBefore = runner.getStatus();
    const started = runner.start({
      inputData: { pages: 'two', extra: true },
      context,
    });

    await expect(started).rejects.toBeInstanceOf(WorkflowInputRejectedError);
    await expect(started).rejects.toMatchObject({
      name: 'WorkflowInputRejectedError',
      message:
        'Workflow input was rejected: ' +
        'name: Invalid input: expected string, received undefined; ' +
        'pages: Invalid input: expected number, received string; ' +
        '(root): Unrecognized key: "extra"',
      issues: [
        'name: Invalid input: expected string, received undefined',
        'pages: Invalid input: expected number, received string',
        '(root): Unrecognized key: "extra"',
      ],
    });
    expect(runner.getStatus()).toBe(statusBefore);
    expect(runner.getState()).toBeUndefined();
    expect(events).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('hands out copies of its step records', async () => {
    const action = defineAction({
      name: 'echo_action',
      execute: async () => ({ ok: true }),
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({ echo: { action: 'echo_action' } }),
        flow: [{ do: 'echo' }],
        outputs: {},
      },
      { actions: { echo_action: action } },
    );
    const runner = new WorkflowRunner(compiled);
    const events: Array<WorkflowEventMap['hook:step:success']> = [];
    const context = new TestContext({ count: 1 });
    context.eventEmitter.on('hook:step:success', (payload) =>
      events.push(payload),
    );

    await runner.start({ inputData: {}, context });

    // The copies are shallow: their own record, context and error objects.
    const record = runner.getStepLog()['0:echo'];
    record.status = 'failed';
    record.context!.after = { count: 2 };
    events[0].stepExecution!.context!.before = { count: 3 };

    expect(runner.getStepLog()['0:echo']).toEqual(
      expect.objectContaining({
        status: 'completed',
        context: { before: { count: 1 }, after: { count: 1 } },
      }),
    );
  });
  it('keeps the error of a failed step in its step record', async () => {
    const action = defineAction({
      name: 'boom_action',
      execute: async () => {
        throw new Error('boom');
      },
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({ boom: { action: 'boom_action' } }),
        flow: [{ do: 'boom' }],
        outputs: {},
      },
      { actions: { boom_action: action } },
    );
    const runner = new WorkflowRunner(compiled);

    await expect(
      runner.start({ inputData: {}, context: new TestContext({}) }),
    ).resolves.toEqual(expect.objectContaining({ status: 'failed' }));

    const record = runner.getStepLog()['0:boom'];
    expect(record).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: { message: 'boom', stack: expect.any(String) },
      }),
    );
    record.error!.message = 'changed';
    expect(runner.getStepLog()['0:boom'].error?.message).toBe('boom');
  });

  it('leaves the error of a step record unset when the step did not fail', async () => {
    const action = defineAction({
      name: 'echo_action',
      execute: async () => ({ ok: true }),
    });
    const compiled = compileWorkflow(
      {
        defs: createTaskDefs({ echo: { action: 'echo_action' } }),
        flow: [{ do: 'echo' }],
        outputs: {},
      },
      { actions: { echo_action: action } },
    );
    const runner = new WorkflowRunner(compiled);

    await runner.start({ inputData: {}, context: new TestContext({}) });

    expect(runner.getStepLog()['0:echo']).toHaveProperty('error', undefined);
  });
  it('records the cancelled loser of a restored wait_any run without context', async () => {
    const ask = defineAction<{ label: string }, unknown, TestContext, Settings>(
      {
        name: 'ask',
        inputSchema: z.object({ label: z.string() }),
        execute: async ({ context }) =>
          context.workflow.suspend({ reason: 'reply' }),
      },
    );
    const compiled = compileWorkflow(
      {
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
      },
      { actions: { ask } },
    );
    const started = await new WorkflowRunner(compiled).start({
      inputData: {},
      context: new TestContext({}),
    });
    if (started.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }

    // A restored runner starts without the step records of the first pass.
    const restored = WorkflowRunner.fromCheckpoint(compiled, {
      checkpoint: persist(started.checkpoint),
      context: new TestContext({}),
    });
    const resumed = await restored.resume({
      waitId: started.waits[1].waitId,
      resumeData: 'b',
    });

    expect(resumed.status).toBe('finished');
    const loser = restored.getStepLog()['0.parallel.0:ask_a'];
    expect(loser).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        error: expect.any(Object),
      }),
    );
    expect(loser).toHaveProperty('context', undefined);
  });
});

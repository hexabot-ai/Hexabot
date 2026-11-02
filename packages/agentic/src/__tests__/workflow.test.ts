/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../action/action';
import { BaseWorkflowContext } from '../context';
import { Settings, WorkflowDefinition, validateWorkflow } from '../dsl.types';
import {
  WorkflowCheckpointInvalidError,
  WorkflowDefinitionDriftError,
  WorkflowWaitNotFoundError,
} from '../errors';
import { Workflow, WorkflowEventEmitter } from '../workflow';
import { EventEmitterLike } from '../workflow-event-emitter';

import { createTaskDefs } from './test-helpers';

class TestContext extends BaseWorkflowContext {
  public eventEmitter: EventEmitterLike = { emit: jest.fn(), on: jest.fn() };

  constructor() {
    super({});
  }
}

describe('Workflow execution', () => {
  it('runs a sequential workflow with JSONata inputs and merged settings', async () => {
    const greetAction = defineAction<
      { name: string },
      { name: string; settings: Settings },
      TestContext,
      Settings
    >({
      name: 'greet_action',
      inputSchema: z.object({ name: z.string() }),
      outputSchema: z
        .object({
          name: z.string(),
          settings: z.custom<Settings>(),
        })
        .strict(),
      execute: async ({ input, settings }) => ({
        name: input.name,
        settings,
      }),
    });
    const definition: WorkflowDefinition = {
      defaults: {
        settings: {
          timeout_ms: 50,
          retries: {
            enabled: true,
            max_attempts: 3,
            backoff_ms: 10,
            max_delay_ms: 1000,
            jitter: 0,
            multiplier: 2,
          },
        },
      },
      defs: createTaskDefs({
        greet_user: {
          action: 'greet_action',
          inputs: {
            name: '=$trim($input.name)',
          },
          settings: {
            timeout_ms: 20,
            retries: {
              enabled: true,
              max_attempts: 2,
              backoff_ms: 10,
              max_delay_ms: 1000,
              jitter: 0,
              multiplier: 2,
            },
          },
        },
      }),
      flow: [{ do: 'greet_user' }],
      outputs: {
        final: "='Hello ' & $output.greet_user.name",
        timeout_ms: '=$output.greet_user.settings.timeout_ms',
        max_attempts: '=$output.greet_user.settings.retries.max_attempts',
      },
      inputs: {
        schema: {
          name: { type: 'string' },
        },
      },
    };
    const workflow = Workflow.fromDefinition(definition, {
      actions: { greet_action: greetAction },
    });
    const result = await workflow.run({ name: '  Ada  ' }, new TestContext());

    expect(result.final).toBe('Hello Ada');
    expect(result.timeout_ms).toBe(20);
    expect(result.max_attempts).toBe(2);
  });

  it('supports suspension and resume through the WorkflowRunner', async () => {
    const suspendingAction = defineAction<
      { prompt: string },
      { reply?: string },
      TestContext,
      Settings
    >({
      name: 'await_reply',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ reply: z.string().optional() }),
      execute: async ({ context }) => {
        const resumeData = (await context.workflow.suspend({
          reason: 'waiting_for_user',
          data: { channel: 'email' },
        })) as { reply?: string };

        return { reply: resumeData.reply };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        ask_user: {
          action: 'await_reply',
          inputs: { prompt: '="Ping"' },
        },
      }),
      flow: [{ do: 'ask_user' }],
      outputs: { reply: '=$output.ask_user.reply' },
    };
    const workflow = Workflow.fromDefinition(definition, {
      actions: { await_reply: suspendingAction },
    });
    const runner = await workflow.buildAsyncRunner();
    const startResult = await runner.start({
      inputData: {},
      context: new TestContext(),
    });
    expect(startResult.status).toBe('suspended');
    if (startResult.status === 'suspended') {
      expect(startResult.waits[0].reason).toBe('waiting_for_user');
      expect(
        runner.getSnapshot().actions[startResult.waits[0].step.id]?.status,
      ).toBe('suspended');
    }

    const resumeResult = await runner.resume({
      resumeData: { reply: 'Sure, go ahead.' },
    });
    expect(resumeResult.status).toBe('finished');
    if (resumeResult.status === 'finished') {
      expect(resumeResult.output.reply).toBe('Sure, go ahead.');
      expect(runner.getStatus()).toBe('finished');
    }
  });

  it('emits lifecycle events', async () => {
    const noopAction = defineAction<
      { value: number },
      { doubled: number },
      TestContext,
      Settings
    >({
      name: 'double_value',
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ doubled: z.number() }),
      execute: async ({ input }) => ({ doubled: input.value * 2 }),
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        double_step: {
          action: 'double_value',
          inputs: { value: '=$input.value' },
        },
      }),
      flow: [{ do: 'double_step' }],
      outputs: { result: '=$output.double_step.doubled' },
      inputs: {
        schema: {
          value: { type: 'number' },
        },
      },
    };
    const events: string[] = [];
    const emitter = new WorkflowEventEmitter();
    emitter.on('hook:workflow:start', () => events.push('hook:workflow:start'));
    emitter.on('hook:step:start', ({ step }: { step: { name: string } }) =>
      events.push(`hook:step:start:${step.name}`),
    );
    emitter.on('hook:step:success', ({ step }: { step: { name: string } }) =>
      events.push(`hook:step:success:${step.name}`),
    );
    emitter.on('hook:workflow:finish', () =>
      events.push('hook:workflow:finish'),
    );

    const workflow = Workflow.fromDefinition(definition, {
      actions: { double_value: noopAction },
    });
    const runner = await workflow.buildAsyncRunner();
    const context = new TestContext();
    context.eventEmitter = emitter;
    const outcome = await runner.start({ inputData: { value: 5 }, context });

    expect(outcome.status).toBe('finished');
    if (outcome.status === 'finished') {
      expect(outcome.output.result).toBe(10);
    }
    expect(events).toEqual([
      'hook:workflow:start',
      'hook:step:start:double_step',
      'hook:step:success:double_step',
      'hook:workflow:finish',
    ]);
  });

  it('throws on invalid YAML input', () => {
    expect(() =>
      Workflow.fromYaml('defs: {}', {
        actions: {} as Record<string, never>,
      }),
    ).toThrow(/Workflow validation failed/);
  });

  it('stringifies a workflow definition to YAML', () => {
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        greet_user: {
          action: 'greet_action',
          inputs: { name: '=$input.name' },
        },
      }),
      flow: [{ do: 'greet_user' }],
      outputs: { result: '=$output.greet_user.name' },
    };
    const yaml = Workflow.stringifyDefinition(definition);
    const validation = validateWorkflow(yaml);

    expect(validation.success).toBe(true);
    if (validation.success) {
      expect(validation.data).toEqual(definition);
    }
  });

  it('propagates action errors thrown during run', async () => {
    const failingAction = defineAction<unknown, unknown, TestContext, Settings>(
      {
        name: 'failing_action',
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => {
          throw new Error('failed to execute');
        },
      },
    );
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        failing_task: {
          action: 'failing_action',
          inputs: {},
        },
      }),
      flow: [{ do: 'failing_task' }],
      outputs: { result: '=$output.failing_task' },
    };
    const workflow = Workflow.fromDefinition(definition, {
      actions: { failing_action: failingAction },
    });
    const context = new TestContext();

    await expect(workflow.run({}, context)).rejects.toThrow(
      'failed to execute',
    );
    expect(() => context.workflow).toThrow(
      'Workflow runtime is not attached to this context.',
    );
  });

  it('throws suspension details from run when a task suspends', async () => {
    const suspendingAction = defineAction<
      unknown,
      { reply?: string },
      TestContext,
      Settings
    >({
      name: 'suspending_action',
      inputSchema: z.any(),
      outputSchema: z.object({ reply: z.string().optional() }),
      execute: async ({ context }) => {
        await context.workflow.suspend({
          reason: 'need_input',
          data: { prompt: 'ok?' },
        });

        return { reply: 'never' };
      },
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        pause_step: {
          action: 'suspending_action',
          inputs: {},
        },
      }),
      flow: [{ do: 'pause_step' }],
      outputs: { reply: '=$output.pause_step.reply' },
    };
    const workflow = Workflow.fromDefinition(definition, {
      actions: { suspending_action: suspendingAction },
    });
    const context = new TestContext();

    await expect(workflow.run({}, context)).rejects.toMatchObject({
      message: 'Workflow run suspended at 0:pause_step (need_input)',
      waits: [
        {
          waitId: '0:pause_step@index:1',
          step: { id: '0:pause_step' },
          reason: 'need_input',
          data: { prompt: 'ok?' },
        },
      ],
    });
    expect(() => context.workflow).toThrow(
      'Workflow runtime is not attached to this context.',
    );
  });

  it('validates a persisted checkpoint and restores a runner from it', async () => {
    const askAction = defineAction<
      unknown,
      { reply: string },
      TestContext,
      Settings
    >({
      name: 'ask_action',
      inputSchema: z.any(),
      outputSchema: z.object({ reply: z.string() }),
      execute: async ({ context }) =>
        context.workflow.suspend<{ reply: string }>({ reason: 'need_input' }),
    });
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({ ask: { action: 'ask_action', inputs: {} } }),
      flow: [{ do: 'ask' }],
      outputs: { reply: '=$output.ask.reply' },
    };
    const options = { actions: { ask_action: askAction } };
    const workflow = Workflow.fromDefinition(definition, options);
    const runner = await workflow.buildAsyncRunner();
    const started = await runner.start({
      inputData: {},
      context: new TestContext(),
    });
    if (started.status !== 'suspended') {
      throw new Error('Expected the run to suspend');
    }
    const stored = JSON.parse(
      JSON.stringify({
        checkpoint: started.checkpoint,
        snapshot: started.snapshot,
      }),
    );
    const [wait] = started.waits;

    expect(
      workflow.validateCheckpoint(stored.checkpoint, { waitId: wait.waitId }),
    ).toEqual({ ok: true, checkpoint: stored.checkpoint });

    const unknownWait = workflow.validateCheckpoint(stored.checkpoint, {
      waitId: 'other@index:1',
    });
    expect(unknownWait.ok).toBe(false);
    if (!unknownWait.ok) {
      expect(unknownWait.error).toBeInstanceOf(WorkflowWaitNotFoundError);
    }

    const changed = Workflow.fromDefinition(
      { ...definition, outputs: { reply: '=$output.ask' } },
      options,
    ).validateCheckpoint(stored.checkpoint);
    expect(changed.ok).toBe(false);
    if (!changed.ok) {
      expect(changed.error).toBeInstanceOf(WorkflowDefinitionDriftError);
    }

    expect(() =>
      workflow.buildRunnerFromCheckpoint({
        checkpoint: undefined,
        context: new TestContext(),
      }),
    ).toThrow(WorkflowCheckpointInvalidError);

    const restored = workflow.buildRunnerFromCheckpoint({
      checkpoint: stored.checkpoint,
      snapshot: stored.snapshot,
      context: new TestContext(),
    });

    expect(restored.getStatus()).toBe('suspended');
    expect(restored.getSnapshot().actions[wait.step.id]).toMatchObject({
      status: 'suspended',
    });
    await expect(
      restored.resume({ waitId: wait.waitId, resumeData: { reply: 'yes' } }),
    ).resolves.toMatchObject({ status: 'finished', output: { reply: 'yes' } });
  });
});

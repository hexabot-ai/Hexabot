/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import type { Action } from '../action/action.types';
import type { BindingKindSchemas } from '../bindings/base-binding';
import { BaseWorkflowContext } from '../context';
import type { Settings, WorkflowDefinition } from '../dsl.types';
import { compileWorkflow } from '../workflow-compiler';
import { StepType, type EventEmitterLike } from '../workflow-event-emitter';

import { createTaskDefs, mergeTaskDefs } from './test-helpers';

class TestContext extends BaseWorkflowContext {
  public eventEmitter: EventEmitterLike = { emit: jest.fn(), on: jest.fn() };
}

const baseRetries = {
  enabled: true,
  max_attempts: 3,
  backoff_ms: 10,
  max_delay_ms: 100,
  jitter: 0,
  multiplier: 2,
};
const createAction = (
  overrides: Partial<
    Action<unknown, unknown, BaseWorkflowContext, Settings>
  > = {},
) => {
  const parseSettings = jest.fn(
    (settings: unknown) =>
      ({
        timeout_ms: 0,
        retries: baseRetries,
        ...(settings as Record<string, unknown>),
        parsed: true,
      }) as unknown as Settings & { parsed: boolean },
  ) as Action<unknown, unknown, BaseWorkflowContext, Settings>['parseSettings'];
  const action: Action<unknown, unknown, BaseWorkflowContext, Settings> = {
    name: 'worker_action',
    description: 'test',
    inputSchema: z.any(),
    outputSchema: z.any(),
    settingSchema: z.any(),
    parseInput: jest.fn(),
    parseOutput: jest.fn(),
    parseSettings,
    execute: jest.fn(),
    run: jest.fn(),
    ...overrides,
  };

  return { action, parseSettings };
};

describe('compileWorkflow', () => {
  it('binds actions, merges settings, and builds flow metadata', () => {
    const { action, parseSettings } = createAction();
    const definition: WorkflowDefinition = {
      defaults: {
        settings: {
          timeout_ms: 25,
          retries: baseRetries,
        },
      },
      defs: createTaskDefs({
        worker_task: {
          action: 'worker_action',
          description: 'does work',
          inputs: { source: '=$input.source', literal: 1 },
          settings: {
            timeout_ms: 50,
            retries: {
              enabled: true,
              max_attempts: 1,
              backoff_ms: 10,
              max_delay_ms: 100,
              jitter: 0,
              multiplier: 2,
            },
          },
        },
      }),
      flow: [
        { do: 'worker_task' },
        {
          conditional: {
            description: 'check',
            when: [
              {
                condition: '=$output.worker_task.echoed',
                steps: [{ do: 'worker_task' }],
              },
              {
                else: true,
                steps: [
                  {
                    parallel: {
                      steps: [{ do: 'worker_task' }],
                      strategy: 'wait_any',
                    },
                  },
                ],
              },
            ],
          },
        },
        {
          loop: {
            type: 'for_each',
            name: 'looping',
            description: 'loop desc',
            for_each: { item: 'item', in: '=$input.items' },
            accumulate: { as: 'total', initial: 0, merge: '=$accumulator + 1' },
            until: '=$iteration.index > 1',
            steps: [{ do: 'worker_task' }],
          },
        },
      ],
      outputs: { final: '=$output.worker_task.echoed' },
      inputs: {
        schema: {
          source: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
      },
    };
    const compiled = compileWorkflow(definition, {
      actions: { worker_action: action },
    });

    expect(parseSettings).toHaveBeenCalledWith({
      timeout_ms: 50,
      retries: { ...baseRetries, max_attempts: 1 },
    });
    expect(compiled.tasks.worker_task.settings).toMatchObject({
      parsed: true,
    });

    expect(compiled.flow[0]).toMatchObject({
      type: StepType.Task,
      id: '0:worker_task',
      label: 'worker_task',
    });

    const conditional = compiled.flow[1];
    if (conditional.type === 'conditional') {
      expect(conditional.branches).toHaveLength(2);
      expect(conditional.branches[0].condition).toMatchObject({
        kind: 'expression',
        source: '=$output.worker_task.echoed',
      });
    } else {
      throw new Error('Expected conditional branch');
    }

    const loop = compiled.flow[2];
    if (loop.type === 'loop') {
      expect(loop.loopType).toBe('for_each');
      if (loop.loopType !== 'for_each') {
        throw new Error('Expected for_each loop step');
      }
      expect(loop.forEach.in).toMatchObject({
        kind: 'expression',
        source: '=$input.items',
      });
      expect(loop.accumulate?.merge).toMatchObject({
        kind: 'expression',
        source: '=$accumulator + 1',
      });
    } else {
      throw new Error('Expected loop step');
    }

    expect(
      compiled.inputParser.parse({ source: 'value', items: ['a'] }),
    ).toEqual({ source: 'value', items: ['a'] });
    expect(() =>
      compiled.inputParser.parse({
        source: 'value',
        items: ['a'],
        extra: true,
      }),
    ).toThrow();
  });

  it('throws when an action implementation is missing', () => {
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        missing: {
          action: 'unknown_action',
          inputs: { value: 1 },
        },
      }),
      flow: [{ do: 'missing' }],
      outputs: { out: '=$output.missing.value' },
    };

    expect(() =>
      compileWorkflow(definition, {
        actions: {} as Record<
          string,
          Action<unknown, unknown, TestContext, Settings>
        >,
      }),
    ).toThrow(/No action implementation provided for "unknown_action"/);
  });

  it('compiles while loops with a pre-check condition', () => {
    const { action } = createAction();
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        worker_task: {
          action: 'worker_action',
        },
      }),
      flow: [
        {
          loop: {
            type: 'while',
            name: 'until_valid',
            while: '=$not($exists($output.worker_task.done))',
            steps: [{ do: 'worker_task' }],
          },
        },
      ],
      outputs: { final: '=$output.worker_task' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { worker_action: action },
    });
    const loop = compiled.flow[0];

    if (loop.type !== 'loop') {
      throw new Error('Expected loop step');
    }

    expect(loop.loopType).toBe('while');
    if (loop.loopType !== 'while') {
      throw new Error('Expected while loop step');
    }
    expect(loop.while).toMatchObject({
      kind: 'expression',
      source: '=$not($exists($output.worker_task.done))',
    });
    expect('maxConcurrency' in loop).toBe(false);
  });

  it('mounts task bindings from defs using parsed binding payloads', () => {
    const { action } = createAction({
      supportedBindings: ['tools'],
    });
    const bindingKinds: BindingKindSchemas = {
      tools: {
        schema: z.strictObject({
          multiplier: z.number(),
          bias: z.number(),
        }),
        multiple: true,
        actionPolicy: 'required',
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            description: 'Compute a score',
            action: 'calculate_score',
            settings: {
              multiplier: 2,
              bias: 1,
            },
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { worker_action: action, calculate_score: action },
      bindingKinds,
    });

    expect(compiled.tasks.worker_task.bindings).toEqual({
      tools: {
        calculate: {
          action: 'calculate_score',
          description: 'Compute a score',
          settings: {
            multiplier: 2,
            bias: 1,
          },
        },
      },
    });
  });

  it('mounts nested bindings recursively', () => {
    const { action } = createAction({
      supportedBindings: ['tools', 'model'],
    });
    const bindingKinds: BindingKindSchemas = {
      tools: {
        schema: z.strictObject({
          multiplier: z.number(),
        }),
        multiple: true,
        actionPolicy: 'required',
        supportedBindings: ['model'],
      },
      model: {
        schema: z.strictObject({
          provider: z.string(),
          model: z.string(),
        }),
        multiple: false,
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {
              multiplier: 2,
            },
            bindings: {
              model: 'chat_model',
            },
          },
          chat_model: {
            kind: 'model',
            settings: {
              provider: 'openai',
              model: 'gpt-4o-mini',
            },
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };
    const compiled = compileWorkflow(definition, {
      actions: {
        worker_action: action,
        calculate_score: {
          ...action,
          supportedBindings: ['model'],
        },
      },
      bindingKinds,
    });

    expect(compiled.tasks.worker_task.bindings).toEqual({
      tools: {
        calculate: {
          action: 'calculate_score',
          settings: {
            multiplier: 2,
          },
          bindings: {
            model: {
              settings: {
                provider: 'openai',
                model: 'gpt-4o-mini',
              },
            },
          },
        },
      },
    });
  });

  it('mounts single-ref bindings as direct payloads', () => {
    const { action } = createAction({
      supportedBindings: ['model'],
    });
    const bindingKinds: BindingKindSchemas = {
      model: {
        schema: z.strictObject({
          provider: z.string(),
          model: z.string(),
        }),
        multiple: false,
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              model: 'openai_chatgpt',
            },
          },
        },
        {
          openai_chatgpt: {
            kind: 'model',
            settings: {
              provider: 'openai',
              model: 'gpt-4o-mini',
            },
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { worker_action: action },
      bindingKinds,
    });

    expect(compiled.tasks.worker_task.bindings).toEqual({
      model: {
        settings: {
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
      },
    });
  });

  it('throws when single-ref binding kinds are provided as arrays', () => {
    const { action } = createAction({
      supportedBindings: ['model'],
    });
    const bindingKinds: BindingKindSchemas = {
      model: {
        schema: z.strictObject({
          provider: z.string(),
          model: z.string(),
        }),
        multiple: false,
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              model: ['openai_chatgpt'],
            },
          },
        },
        {
          openai_chatgpt: {
            kind: 'model',
            settings: {
              provider: 'openai',
              model: 'gpt-4o-mini',
            },
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };

    expect(() =>
      compileWorkflow(definition, {
        actions: { worker_action: action },
        bindingKinds,
      }),
    ).toThrow(/Expected a single def reference string/);
  });

  it('throws when multi-ref binding kinds are provided as strings', () => {
    const { action } = createAction({
      supportedBindings: ['tools'],
    });
    const bindingKinds: BindingKindSchemas = {
      tools: {
        schema: z.strictObject({
          multiplier: z.number().optional(),
        }),
        multiple: true,
        actionPolicy: 'required',
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              tools: 'calculate',
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };

    expect(() =>
      compileWorkflow(definition, {
        actions: { worker_action: action, calculate_score: action },
        bindingKinds,
      }),
    ).toThrow(/Expected an array of def references/);
  });

  it('throws when a task mounts bindings not supported by the action', () => {
    const { action } = createAction();
    const bindingKinds: BindingKindSchemas = {
      tools: {
        schema: z.strictObject({
          multiplier: z.number().optional(),
        }),
        multiple: true,
        actionPolicy: 'required',
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };

    expect(() =>
      compileWorkflow(definition, {
        actions: { worker_action: action, calculate_score: action },
        bindingKinds,
      }),
    ).toThrow(/does not support binding kind "tools"/);
  });

  it('allows actions with no supported bindings when tasks do not mount bindings', () => {
    const { action } = createAction();
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({
        worker_task: {
          action: 'worker_action',
          inputs: { value: 1 },
        },
      }),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };
    const compiled = compileWorkflow(definition, {
      actions: { worker_action: action },
    });

    expect(compiled.tasks.worker_task.bindings).toEqual({});
  });

  it('throws when a def settings payload fails binding schema validation', () => {
    const { action } = createAction({
      supportedBindings: ['tools'],
    });
    const bindingKinds: BindingKindSchemas = {
      tools: {
        schema: z.strictObject({
          multiplier: z.number(),
        }),
        multiple: true,
        actionPolicy: 'required',
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {
              multiplier: 'invalid',
            } as any,
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };

    expect(() =>
      compileWorkflow(definition, {
        actions: { worker_action: action, calculate_score: action },
        bindingKinds,
      }),
    ).toThrow(/defs\.calculate\.settings/);
  });

  it('throws when defs or bindings are provided without bindingKinds', () => {
    const { action } = createAction({
      supportedBindings: ['tools'],
    });
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };

    expect(() =>
      compileWorkflow(definition, {
        actions: { worker_action: action, calculate_score: action },
      }),
    ).toThrow(/bindingKinds/);
  });

  it('throws when non-task defs with action do not resolve', () => {
    const { action } = createAction({
      supportedBindings: ['tools'],
    });
    const bindingKinds: BindingKindSchemas = {
      tools: {
        schema: z.strictObject({
          multiplier: z.number().optional(),
        }),
        multiple: true,
        actionPolicy: 'required',
      },
    };
    const definition: WorkflowDefinition = {
      defs: mergeTaskDefs(
        {
          worker_task: {
            action: 'worker_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'worker_task' }],
      outputs: { out: '=$output.worker_task' },
    };

    expect(() =>
      compileWorkflow(definition, {
        actions: { worker_action: action },
        bindingKinds,
      }),
    ).toThrow(/No action implementation provided for "calculate_score"/);
  });
});

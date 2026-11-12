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
import {
  buildWorkflowInputParser,
  compileWorkflow,
} from '../workflow-compiler';
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
          type: 'object',
          properties: {
            source: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
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
  it('compiles each step kind with its path-based id, label and defaults', () => {
    const { action } = createAction();
    const definition: WorkflowDefinition = {
      defs: createTaskDefs({ worker_task: { action: 'worker_action' } }),
      flow: [
        { do: 'worker_task' },
        { parallel: { steps: [{ do: 'worker_task' }] } },
        {
          parallel: {
            description: 'race',
            strategy: 'wait_any',
            steps: [],
          },
        },
        {
          conditional: {
            when: [
              { condition: '=true', steps: [{ do: 'worker_task' }] },
              { else: true, steps: [] },
            ],
          },
        },
        { conditional: { description: 'route', when: [{ steps: [] }] } },
        {
          loop: {
            type: 'while',
            while: '=false',
            steps: [{ do: 'worker_task' }],
          },
        },
        {
          loop: {
            type: 'for_each',
            name: 'each_item',
            description: 'items',
            for_each: { item: 'item', in: '=[1]' },
            max_concurrency: 2,
            until: '=true',
            accumulate: { as: 'all', initial: [], merge: '=$accumulator' },
            steps: [],
          },
        },
        {
          loop: {
            type: 'for_each',
            for_each: { item: 'item', in: '=[]' },
            steps: [],
          },
        },
      ],
      outputs: {},
    };
    const { flow } = compileWorkflow(definition, {
      actions: { worker_action: action },
    });
    const expression = (source: string) =>
      expect.objectContaining({ kind: 'expression', source });

    expect(flow).toEqual([
      {
        type: StepType.Task,
        id: '0:worker_task',
        label: 'worker_task',
        taskName: 'worker_task',
      },
      {
        type: StepType.Parallel,
        id: '1:parallel',
        label: 'parallel',
        description: undefined,
        strategy: 'wait_all',
        steps: [
          {
            type: StepType.Task,
            id: '1.parallel.0:worker_task',
            label: 'worker_task',
            taskName: 'worker_task',
          },
        ],
      },
      {
        type: StepType.Parallel,
        id: '2:parallel',
        label: 'race',
        description: 'race',
        strategy: 'wait_any',
        steps: [],
      },
      {
        type: StepType.Conditional,
        id: '3:conditional',
        label: 'conditional',
        description: undefined,
        branches: [
          {
            id: '3.branch.0:conditional',
            condition: expression('=true'),
            steps: [
              {
                type: StepType.Task,
                id: '3.branch.0.0:worker_task',
                label: 'worker_task',
                taskName: 'worker_task',
              },
            ],
          },
          { id: '3.branch.1:conditional', condition: undefined, steps: [] },
        ],
      },
      {
        type: StepType.Conditional,
        id: '4:conditional',
        label: 'route',
        description: 'route',
        branches: [
          { id: '4.branch.0:conditional', condition: undefined, steps: [] },
        ],
      },
      {
        type: StepType.Loop,
        id: '5:loop',
        label: 'loop',
        name: undefined,
        description: undefined,
        accumulate: undefined,
        loopType: 'while',
        while: expression('=false'),
        steps: [
          {
            type: StepType.Task,
            id: '5.loop.0:worker_task',
            label: 'worker_task',
            taskName: 'worker_task',
          },
        ],
      },
      {
        type: StepType.Loop,
        id: '6:each_item',
        label: 'each_item',
        name: 'each_item',
        description: 'items',
        accumulate: {
          as: 'all',
          initial: [],
          merge: expression('=$accumulator'),
        },
        loopType: 'for_each',
        forEach: { item: 'item', in: expression('=[1]') },
        maxConcurrency: 2,
        until: expression('=true'),
        steps: [],
      },
      {
        type: StepType.Loop,
        id: '7:loop',
        label: 'loop',
        name: undefined,
        description: undefined,
        accumulate: undefined,
        loopType: 'for_each',
        forEach: { item: 'item', in: expression('=[]') },
        maxConcurrency: undefined,
        until: undefined,
        steps: [],
      },
    ]);
  });
  it('refuses to compile a task with an empty action name', () => {
    const { action } = createAction();

    expect(() =>
      compileWorkflow(
        {
          defs: createTaskDefs({ worker_task: { action: '' } }),
          flow: [{ do: 'worker_task' }],
          outputs: {},
        },
        { actions: { worker_action: action } },
      ),
    ).toThrow(
      'Workflow bindings validation failed: defs.worker_task.action: No action implementation provided for "".',
    );
  });
});

describe('buildWorkflowInputParser', () => {
  const parser = buildWorkflowInputParser({
    type: 'object',
    properties: {
      question: { type: 'string' },
      pages: { type: 'integer', default: 1 },
      mode: { enum: ['fast', 'thorough'] },
      author: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
    required: ['question'],
  });
  const issuesOf = (input: unknown) => {
    const result = parser.safeParse(input);

    return result.success
      ? []
      : result.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.code}`,
        );
  };

  it('accepts a matching payload and applies the default values', () => {
    expect(parser.parse({ question: 'Why?' })).toEqual({
      question: 'Why?',
      pages: 1,
    });
    expect(parser.parse({ question: 'Why?', pages: 3, mode: 'fast' })).toEqual({
      question: 'Why?',
      pages: 3,
      mode: 'fast',
    });
  });

  it('refuses a payload without a required field', () => {
    expect(issuesOf({})).toEqual(['question: invalid_type']);
    expect(issuesOf({ question: 'Why?', author: {} })).toEqual([
      'author.name: invalid_type',
    ]);
  });

  it('refuses values of the wrong type or outside an enum', () => {
    expect(issuesOf({ question: 1, pages: 1.5, mode: 'slow' }).sort()).toEqual([
      'mode: invalid_value',
      'pages: invalid_type',
      'question: invalid_type',
    ]);
  });

  it('keeps undeclared keys unless the schema forbids them', () => {
    expect(parser.parse({ question: 'Why?', extra: true })).toEqual({
      question: 'Why?',
      pages: 1,
      extra: true,
    });
    expect(
      issuesOf({ question: 'Why?', author: { name: 'Ada', extra: true } }),
    ).toEqual(['author: unrecognized_keys']);
  });

  it('refuses a payload that is not an object', () => {
    expect(issuesOf('Why?')).toEqual([': invalid_type']);
    expect(issuesOf(['Why?'])).toEqual([': invalid_type']);
  });

  it('accepts any object when the workflow declares no schema', () => {
    const open = buildWorkflowInputParser(undefined);

    expect(open.parse({ anything: [1, 2] })).toEqual({ anything: [1, 2] });
    expect(open.safeParse('text').success).toBe(false);
  });

  it('throws on a schema that is not valid JSON Schema', () => {
    expect(() => buildWorkflowInputParser({ type: 'text' })).toThrow(
      'Unsupported type: text',
    );
  });
});

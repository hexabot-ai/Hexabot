/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ToolLoopAgent, hasToolCall, stepCountIs } from 'ai';

import { ActionService } from '@/actions/actions.service';
import { toDraft07JsonSchema } from '@/utils/helpers/zod';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { AiAgentAction } from './agent.action';
import { aiAgentSettingsSchema } from './ai-schemas';

jest.mock('ai', () => {
  const generateFn = jest.fn();
  const ToolLoopAgentMock = jest.fn().mockImplementation(function (options) {
    this.options = options;
    this.generate = generateFn;
  });

  return {
    ToolLoopAgent: ToolLoopAgentMock,
    stepCountIs: jest.fn((count: number) =>
      jest.fn(({ steps }) => steps.length === count),
    ),
    hasToolCall: jest.fn((toolName: string) =>
      jest.fn(
        ({ steps }) =>
          steps[steps.length - 1]?.toolCalls?.some(
            (toolCall: any) => toolCall.toolName === toolName,
          ) ?? false,
      ),
    ),
    __toolLoopAgentGenerateMock: generateFn,
  };
});

const toolLoopAgentGenerateMock = (
  jest.requireMock('ai') as { __toolLoopAgentGenerateMock: jest.Mock }
).__toolLoopAgentGenerateMock;

describe('AiAgentAction', () => {
  let action: AiAgentAction;
  let actionService: ActionService;
  const ToolLoopAgentMock = ToolLoopAgent as unknown as jest.Mock;
  const stepCountIsMock = stepCountIs as jest.MockedFunction<
    typeof stepCountIs
  >;
  const hasToolCallMock = hasToolCall as jest.MockedFunction<
    typeof hasToolCall
  >;
  const logger = { debug: jest.fn() };
  const defaultRetries = {
    max_attempts: 3,
    backoff_ms: 25,
    max_delay_ms: 10_000,
    jitter: 0,
    multiplier: 1,
  };
  const createCredentialService = (value = 'test-key') => ({
    findOneValue: jest.fn().mockResolvedValue(value),
  });
  const createContext = (services: Record<string, unknown> = {}) =>
    ({
      services: { logger, credentials: createCredentialService(), ...services },
    }) as unknown as WorkflowRuntimeContext;
  const createModelBindings = (
    overrides: Partial<{
      provider: string;
      model_id: string;
      api_key: string;
      base_url: string;
      organization: string;
    }> = {},
  ): any => ({
    model: {
      settings: {
        provider: 'openai',
        model_id: 'gpt-4o-mini',
        api_key: 'test-key',
        base_url: 'https://api.openai.com',
        organization: 'org-1',
        ...overrides,
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    toolLoopAgentGenerateMock.mockReset();
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new AiAgentAction(actionService);
  });

  it('defaults tool-enabled agent runs to an explicit 10-step budget', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo tool',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const context = createContext({ actions: actionsService });

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Done',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      steps: [],
    } as any);

    await action.execute({
      input: { input_mode: 'prompt', prompt: 'use the tools' },
      settings: {
        timeout_ms: 0,
        retries: defaultRetries,
      } as any,
      context,
      bindings: {
        ...createModelBindings(),
        tools: {
          search: { action: 'search_action' },
          translate: { action: 'translate_action' },
        },
      } as any,
    });

    expect(stepCountIsMock.mock.calls.at(-1)?.[0]).toBe(10);
  });

  it('advertises a visible default 10-step budget in the form schema', () => {
    const jsonSchema = toDraft07JsonSchema(aiAgentSettingsSchema) as {
      properties?: Record<string, Record<string, any>>;
    };
    const stopStepCount = jsonSchema.properties?.stop_step_count;

    expect(aiAgentSettingsSchema.parse({})).not.toHaveProperty(
      'stop_step_count',
    );
    expect(stopStepCount).toEqual(
      expect.objectContaining({
        default: 10,
      }),
    );
    expect(stopStepCount?.['ui:options']?.hideUntilAdded).toBeUndefined();
  });

  it('creates a ToolLoopAgent, runs it, and normalizes the response', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const toolRun = jest.fn().mockResolvedValue({ ok: true });
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo tool',
        inputSchema: {},
        outputSchema: {},
        run: toolRun,
      }),
    };
    const context = createContext({ actions: actionsService });
    const buildPromptSpy = jest.spyOn(action as any, 'buildPrompt');
    const buildCallSettingsSpy = jest.spyOn(action as any, 'buildCallSettings');
    const createModelSpy = jest
      .spyOn(action as any, 'createModel')
      .mockReturnValue('model-instance');
    const loadProviderSpy = jest
      .spyOn(action as any, 'loadProvider')
      .mockResolvedValue(provider);
    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Agent reply',
      content: [{ type: 'text', text: 'Agent reply' }],
      reasoning: [{ text: 'step reasoning' }],
      reasoningText: 'step reasoning',
      files: [{ url: 'file://example' }],
      sources: [{ id: '1', title: 'source' }],
      toolCalls: [{ toolName: 'search', args: {} }],
      toolResults: [{ toolName: 'search', result: { value: 1 } }],
      finishReason: 'stop',
      rawFinishReason: 'stop',
      usage: {
        inputTokens: 10,
        inputTokenDetails: {
          noCacheTokens: 6,
          cacheReadTokens: 4,
          cacheWriteTokens: 1,
        },
        outputTokens: 20,
        outputTokenDetails: {
          textTokens: 18,
          reasoningTokens: 2,
        },
        totalTokens: 30,
        raw: { billable_units: 42 },
      },
      totalUsage: {
        inputTokens: 15,
        outputTokens: 25,
        totalTokens: 40,
      },
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: { latency: 123 },
      warnings: ['warn'],
      steps: [{ id: 'step-1' }],
    } as any);

    const settings = {
      timeout_ms: 0,
      retries: defaultRetries,
      temperature: 0.7,
      top_p: 0.8,
      top_k: 5,
      presence_penalty: 0.1,
      frequency_penalty: -0.2,
      stop_sequences: ['stop'],
      max_output_tokens: 50,
      seed: 7,
    };
    const bindings = {
      ...createModelBindings(),
      tools: {
        search: { action: 'search_action', settings: { scope: 'web' } },
        translate: { action: 'translate_action' },
      },
    };
    const input = {
      input_mode: 'prompt' as const,
      prompt: 'Hello there',
      system: 'system prompt',
    };
    const result = await action.execute({ input, settings, context, bindings });
    const agentOptions = ToolLoopAgentMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(loadProviderSpy).toHaveBeenCalledWith('openai', {
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com',
      organization: 'org-1',
    });
    expect(buildPromptSpy).toHaveBeenCalledWith(input, context, []);
    expect(buildCallSettingsSpy).toHaveBeenCalledWith(settings);
    expect(createModelSpy).toHaveBeenCalledWith(provider, 'gpt-4o-mini');
    expect(agentOptions).toEqual(
      expect.objectContaining({
        model: 'model-instance',
        instructions: 'system prompt',
        temperature: 0.7,
        topP: 0.8,
        topK: 5,
        presencePenalty: 0.1,
        frequencyPenalty: -0.2,
        stopSequences: ['stop'],
        maxOutputTokens: 50,
        seed: 7,
      }),
    );
    expect(typeof agentOptions.stopWhen).toBe('function');
    expect(agentOptions.tools).toBeDefined();
    expect(Object.keys(agentOptions.tools as Record<string, unknown>)).toEqual([
      'search',
      'translate',
    ]);
    expect(stepCountIsMock).toHaveBeenCalledWith(10);
    await (agentOptions.tools as any).search.execute({ query: 'hello' });
    expect(toolRun).toHaveBeenCalledWith({ query: 'hello' }, context, {
      scope: 'web',
    });
    expect(toolLoopAgentGenerateMock).toHaveBeenCalledWith({
      prompt: 'Hello there',
    });
    expect(result).toEqual({
      text: 'Agent reply',
      content: [{ type: 'text', text: 'Agent reply' }],
      reasoning: 'step reasoning',
      files: [{ url: 'file://example' }],
      sources: [{ id: '1', title: 'source' }],
      tool_calls: [{ toolName: 'search', args: {} }],
      tool_results: [{ toolName: 'search', result: { value: 1 } }],
      finish_reason: 'stop',
      raw_finish_reason: 'stop',
      model: 'gpt-4o-mini',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        reasoning_tokens: 2,
        cached_input_tokens: 4,
        input_token_details: {
          no_cache_tokens: 6,
          cache_read_tokens: 4,
          cache_write_tokens: 1,
        },
        output_token_details: {
          text_tokens: 18,
          reasoning_tokens: 2,
        },
        raw: { billable_units: 42 },
      },
      total_usage: {
        input_tokens: 15,
        output_tokens: 25,
        total_tokens: 40,
        reasoning_tokens: undefined,
        cached_input_tokens: undefined,
        input_token_details: undefined,
        output_token_details: undefined,
        raw: undefined,
      },
      steps: [{ id: 'step-1' }],
      raw: {
        request: { foo: 'req' },
        response: { status: 200 },
        provider_metadata: { latency: 123 },
        warnings: ['warn'],
      },
    });
  });

  it('adds memory to the instructions when enabled', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo tool',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const context = createContext({ actions: actionsService });
    const definitionCache = new Map([
      [
        'user_profile',
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          name: 'User Profile',
          slug: 'user_profile',
        },
      ],
    ]);
    const instances = {
      user_profile: {
        fields: jest
          .fn()
          .mockReturnValue([{ name: 'name', title: 'Name', value: 'Ada' }]),
      },
    };
    (context as any).memoryStore = {
      definitionCache,
      instances,
      buildUpdateMemorySchema: jest.fn().mockReturnValue({}),
    };

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');

    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Agent reply',
      finishReason: 'stop',
      rawFinishReason: 'stop',
    } as any);

    const settings = {
      timeout_ms: 0,
      retries: defaultRetries,
    };
    const input = {
      input_mode: 'prompt' as const,
      prompt: 'Hello there',
      system: 'Base system',
    };

    await action.execute({
      input,
      settings,
      context,
      bindings: {
        ...createModelBindings(),
        memory: {
          selected_profile: {
            settings: {
              definition_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            },
          },
        },
      } as any,
    });

    const agentOptions = ToolLoopAgentMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(instances.user_profile.fields).toHaveBeenCalledWith({
      includeAdditional: true,
    });
    expect(actionsService.get).toHaveBeenCalledWith('update_memory');
    expect(
      (context as any).memoryStore.buildUpdateMemorySchema,
    ).toHaveBeenCalledWith(['user_profile']);
    expect(agentOptions.tools).toHaveProperty('update_memory');
    expect(agentOptions.instructions).toContain('Base system');
    expect(agentOptions.instructions).toContain('# Working Memory');
    expect(agentOptions.instructions).toContain('## User Profile');
    expect(agentOptions.instructions).toContain('- Name: Ada');
  });

  it('uses the default 10-step budget with MCP and memory tools', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'update memory',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const mcpClientPool = {
      buildToolSet: jest.fn().mockResolvedValue({
        calendar__check_availability: {},
        calendar__create_event: {},
        calendar__attach_meet: {},
      }),
    };
    const context = createContext({
      actions: actionsService,
      mcp: mcpClientPool,
    });
    (context as any).memoryStore = {
      definitionCache: new Map([
        [
          'appointment_schedule',
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            name: 'Appointment Schedule',
            slug: 'appointment_schedule',
          },
        ],
      ]),
      instances: {
        appointment_schedule: {
          fields: jest.fn().mockReturnValue([]),
        },
      },
      buildUpdateMemorySchema: jest.fn().mockReturnValue({}),
    };

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Done',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      steps: [],
    } as any);

    await action.execute({
      input: { input_mode: 'prompt', prompt: 'schedule an appointment' },
      settings: {
        timeout_ms: 0,
        retries: defaultRetries,
      } as any,
      context,
      bindings: {
        ...createModelBindings(),
        memory: {
          schedule: {
            settings: {
              definition_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            },
          },
        },
        mcp: {
          calendar: {
            settings: {
              server_id: '11111111-1111-4111-8111-111111111111',
            },
          },
        },
      } as any,
    });

    const agentOptions = ToolLoopAgentMock.mock.calls[0][0] as any;

    expect(Object.keys(agentOptions.tools)).toEqual([
      'calendar__check_availability',
      'calendar__create_event',
      'calendar__attach_meet',
      'update_memory',
    ]);
    expect(stepCountIsMock.mock.calls.at(-1)?.[0]).toBe(10);
  });

  it('keeps the default at 10 when more than 9 tools are available', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'update memory',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const mcpClientPool = {
      buildToolSet: jest
        .fn()
        .mockResolvedValue(
          Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [
              `calendar__tool_${i + 1}`,
              {},
            ]),
          ),
        ),
    };
    const context = createContext({
      actions: actionsService,
      mcp: mcpClientPool,
    });
    (context as any).memoryStore = {
      definitionCache: new Map([
        [
          'appointment_schedule',
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            name: 'Appointment Schedule',
            slug: 'appointment_schedule',
          },
        ],
      ]),
      instances: {
        appointment_schedule: {
          fields: jest.fn().mockReturnValue([]),
        },
      },
      buildUpdateMemorySchema: jest.fn().mockReturnValue({}),
    };

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Done',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      steps: [],
    } as any);

    await action.execute({
      input: { input_mode: 'prompt', prompt: 'schedule an appointment' },
      settings: {
        timeout_ms: 0,
        retries: defaultRetries,
      } as any,
      context,
      bindings: {
        ...createModelBindings(),
        memory: {
          schedule: {
            settings: {
              definition_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            },
          },
        },
        mcp: {
          calendar: {
            settings: {
              server_id: '11111111-1111-4111-8111-111111111111',
            },
          },
        },
      } as any,
    });

    const agentOptions = ToolLoopAgentMock.mock.calls[0][0] as any;

    expect(Object.keys(agentOptions.tools)).toHaveLength(13);
    expect(agentOptions.tools).toHaveProperty('update_memory');
    expect(stepCountIsMock.mock.calls.at(-1)?.[0]).toBe(10);
  });

  it('lets an explicit stop_step_count override the default budget', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'update memory',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const mcpClientPool = {
      buildToolSet: jest.fn().mockResolvedValue({
        calendar__check_availability: {},
        calendar__create_event: {},
        calendar__attach_meet: {},
      }),
    };
    const context = createContext({
      actions: actionsService,
      mcp: mcpClientPool,
    });
    (context as any).memoryStore = {
      definitionCache: new Map([
        [
          'appointment_schedule',
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            name: 'Appointment Schedule',
            slug: 'appointment_schedule',
          },
        ],
      ]),
      instances: {
        appointment_schedule: {
          fields: jest.fn().mockReturnValue([]),
        },
      },
      buildUpdateMemorySchema: jest.fn().mockReturnValue({}),
    };

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Done',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      steps: [],
    } as any);

    await action.execute({
      input: { input_mode: 'prompt', prompt: 'schedule an appointment' },
      settings: {
        timeout_ms: 0,
        retries: defaultRetries,
        stop_step_count: 3,
      } as any,
      context,
      bindings: {
        ...createModelBindings(),
        memory: {
          schedule: {
            settings: {
              definition_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            },
          },
        },
        mcp: {
          calendar: {
            settings: {
              server_id: '11111111-1111-4111-8111-111111111111',
            },
          },
        },
      } as any,
    });

    expect(stepCountIsMock.mock.calls.at(-1)?.[0]).toBe(3);
  });

  it('combines stop conditions when provided in settings', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo tool',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const context = createContext({ actions: actionsService });

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Done',
      finishReason: 'tool-calls',
      rawFinishReason: 'tool-calls',
      steps: [],
    } as any);

    const settings = {
      timeout_ms: 0,
      retries: defaultRetries,
      stop_step_count: 5,
      stop_tool_call: 'finalize',
    };
    const input = { input_mode: 'prompt' as const, prompt: 'Hello there' };
    const bindings = {
      ...createModelBindings(),
      tools: {
        search: { action: 'search_action' },
      },
    };

    await action.execute({ input, settings, context, bindings });
    const { stopWhen } = ToolLoopAgentMock.mock.calls[0][0] as {
      stopWhen: Array<(params: any) => boolean>;
    };

    expect(Array.isArray(stopWhen)).toBe(true);
    expect(stepCountIsMock).toHaveBeenCalledWith(5);
    expect(hasToolCallMock).toHaveBeenCalledWith('finalize');
    expect(stopWhen[0]({ steps: new Array(5).fill({}) })).toBe(true);
    expect(
      stopWhen[1]({
        steps: [{ toolCalls: [{ toolName: 'finalize' }] }],
      }),
    ).toBe(true);
  });

  it('loads MCP tools and merges them with action tools', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionToolRun = jest.fn().mockResolvedValue({ ok: true });
    const mcpToolRun = jest.fn().mockResolvedValue({ source: 'mcp' });
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo tool',
        inputSchema: {},
        outputSchema: {},
        run: actionToolRun,
      }),
    };
    const mcpClientPool = {
      buildToolSet: jest.fn().mockResolvedValue({
        planner__lookup: {
          description: 'planner lookup',
          inputSchema: {},
          execute: mcpToolRun,
        },
      }),
    };
    const context = createContext({
      actions: actionsService,
      mcp: mcpClientPool,
    });

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    toolLoopAgentGenerateMock.mockResolvedValue({
      text: 'Done',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      steps: [],
    } as any);

    await action.execute({
      input: { input_mode: 'prompt', prompt: 'hello' },
      settings: {
        timeout_ms: 0,
        retries: defaultRetries,
      } as any,
      context,
      bindings: {
        ...createModelBindings(),
        tools: {
          search: { action: 'search_action', settings: { locale: 'en' } },
        },
        mcp: {
          planner: {
            settings: {
              server_id: '11111111-1111-4111-8111-111111111111',
            },
          },
        },
      } as any,
    });

    const agentOptions = ToolLoopAgentMock.mock.calls[0][0] as any;

    expect(mcpClientPool.buildToolSet).toHaveBeenCalledWith({
      planner: {
        settings: {
          server_id: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
    expect(Object.keys(agentOptions.tools)).toEqual([
      'search',
      'planner__lookup',
    ]);
    expect(stepCountIsMock).toHaveBeenCalledWith(10);
    await agentOptions.tools.search.execute({ query: 'hello' });
    expect(actionToolRun).toHaveBeenCalledWith({ query: 'hello' }, context, {
      locale: 'en',
    });
    await agentOptions.tools.planner__lookup.execute({ query: 'hello' });
    expect(mcpToolRun).toHaveBeenCalledWith({ query: 'hello' });
  });

  it('throws when the model binding is missing', async () => {
    await expect(
      action.execute({
        input: { input_mode: 'prompt', prompt: 'hi' },
        settings: {
          timeout_ms: 0,
          retries: defaultRetries,
        } as any,
        context: createContext(),
        bindings: {},
      }),
    ).rejects.toThrow('A model is required to run ai_agent.');
  });

  it('throws when the model id is missing', async () => {
    await expect(
      action.execute({
        input: { input_mode: 'prompt', prompt: 'hi' },
        settings: {
          timeout_ms: 0,
          retries: defaultRetries,
        } as any,
        context: createContext(),
        bindings: {
          model: {
            settings: {
              provider: 'openai',
            },
          },
        } as any,
      }),
    ).rejects.toThrow('A model is required to run ai_agent.');
  });
});

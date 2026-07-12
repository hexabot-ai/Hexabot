/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { generateText, hasToolCall, stepCountIs } from 'ai';

import { ActionService } from '@/actions/actions.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { AiGenerateTextAction } from './generate-text.action';

jest.mock('ai', () => ({
  generateText: jest.fn(),
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
  jsonSchema: jest.fn((schema) => ({ wrapped: schema })),
  Output: {
    object: jest.fn(({ schema, name, description }) => ({
      schema,
      name,
      description,
      type: 'object',
    })),
  },
}));

describe('AiGenerateTextAction', () => {
  let action: AiGenerateTextAction;
  let actionService: ActionService;
  const generateTextMock = generateText as jest.MockedFunction<
    typeof generateText
  >;
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
  const createCredentialsService = (value = 'test-key') => ({
    findOneValue: jest.fn().mockResolvedValue(value),
  });
  const createContext = (services: Record<string, unknown> = {}) =>
    ({
      services: {
        logger,
        actions: { get: jest.fn() },
        credentials: createCredentialsService(),
        ...services,
      },
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
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new AiGenerateTextAction(actionService);
  });

  it('calls the provider and normalizes the generateText response', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const loadProviderSpy = jest
      .spyOn(action as any, 'loadProvider')
      .mockResolvedValue(provider);
    const buildPromptSpy = jest.spyOn(action as any, 'buildPrompt');
    const buildCallSettingsSpy = jest.spyOn(action as any, 'buildCallSettings');
    const createModelSpy = jest.spyOn(action as any, 'createModel');

    generateTextMock.mockResolvedValue({
      text: 'Generated text',
      finishReason: 'stop',
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
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: { latency: 123 },
      warnings: ['warn'],
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
    const input = {
      prompt: 'Hello there',
      system: 'system prompt',
    };
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo tool',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const context = createContext({ actions: actionsService });
    const bindings = createModelBindings();
    const result = await action.execute({
      input,
      settings,
      context,
      bindings,
    });
    const callArgs = generateTextMock.mock.calls[0][0] as any;

    expect(loadProviderSpy).toHaveBeenCalledWith('openai', {
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com',
      organization: 'org-1',
    });
    expect(buildPromptSpy).toHaveBeenCalledWith(
      {
        input_mode: 'prompt',
        prompt: input.prompt,
        system: input.system,
      },
      context,
      [],
    );
    expect(buildCallSettingsSpy).toHaveBeenCalledWith(settings);
    expect(createModelSpy).toHaveBeenCalledWith(provider, 'gpt-4o-mini');
    expect(callArgs.stopWhen).toBeUndefined();
    expect(stepCountIsMock).not.toHaveBeenCalled();
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello there',
        system: 'system prompt',
        temperature: 0.7,
        topP: 0.8,
        topK: 5,
        presencePenalty: 0.1,
        frequencyPenalty: -0.2,
        stopSequences: ['stop'],
        maxOutputTokens: 50,
        seed: 7,
        model: 'model-instance',
      }),
    );
    expect(result).toEqual({
      text: 'Generated text',
      finish_reason: 'stop',
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
      raw: {
        request: { foo: 'req' },
        response: { status: 200 },
        provider_metadata: { latency: 123 },
        warnings: ['warn'],
      },
    });
  });

  it('keeps an explicit step budget on tool-less runs', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const context = createContext();

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'buildPrompt');
    jest.spyOn(action as any, 'buildCallSettings');
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    generateTextMock.mockResolvedValue({
      text: 'Generated text',
      finishReason: 'stop',
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: {},
      warnings: [],
    } as any);

    await action.execute({
      input: { prompt: 'Hello there' },
      settings: {
        timeout_ms: 0,
        retries: defaultRetries,
        stop_step_count: 5,
      },
      context,
      bindings: createModelBindings(),
    });

    const stopWhen = (generateTextMock.mock.calls[0][0] as any).stopWhen;

    expect(stepCountIsMock).toHaveBeenCalledWith(5);
    expect(stopWhen({ steps: new Array(5).fill({}) })).toBe(true);
    expect(stopWhen({ steps: new Array(4).fill({}) })).toBe(false);
  });

  it('adds memory to the system prompt when enabled', async () => {
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

    generateTextMock.mockResolvedValue({
      text: 'Generated text',
      finishReason: 'stop',
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: {},
      warnings: [],
    } as any);

    const settings = {
      timeout_ms: 0,
      retries: defaultRetries,
    };
    const input = {
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

    const callArgs = generateTextMock.mock.calls[0][0] as any;

    expect(instances.user_profile.fields).toHaveBeenCalledWith({
      includeAdditional: true,
    });
    expect(actionsService.get).toHaveBeenCalledWith('update_memory');
    expect(
      (context as any).memoryStore.buildUpdateMemorySchema,
    ).toHaveBeenCalledWith(['user_profile']);
    expect(callArgs.tools).toHaveProperty('update_memory');
    expect(callArgs.tools.update_memory.description).toBe('demo tool');
    expect(callArgs.system).toContain('Base system');
    expect(callArgs.system).toContain('# Working Memory');
    expect(callArgs.system).toContain('## User Profile');
    expect(callArgs.system).toContain('- Name: Ada');
  });

  it('defaults tool-enabled runs to 10 steps and forwards tool settings', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const toolRun = jest.fn().mockResolvedValue({ ok: true });
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo',
        inputSchema: {},
        outputSchema: {},
        run: toolRun,
      }),
    };
    const context = createContext({ actions: actionsService });

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'buildPrompt');
    jest.spyOn(action as any, 'buildCallSettings');
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    generateTextMock.mockResolvedValue({
      text: 'Generated text',
      finishReason: 'stop',
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: {},
      warnings: [],
    } as any);

    const settings = {
      timeout_ms: 0,
      retries: defaultRetries,
    };
    const input = { prompt: 'Hello there' };
    const bindings = {
      ...createModelBindings(),
      tools: {
        search: { action: 'search_action', settings: { locale: 'en' } },
        translate: { action: 'translate_action' },
      },
    };
    const result = await action.execute({ input, settings, context, bindings });
    const callArgs = generateTextMock.mock.calls[0][0] as any;
    const stopWhen = callArgs.stopWhen;

    expect(stepCountIsMock).toHaveBeenCalledWith(10);
    expect(typeof stopWhen).toBe('function');
    expect(stopWhen({ steps: new Array(10).fill({}) })).toBe(true);
    expect(stopWhen({ steps: new Array(9).fill({}) })).toBe(false);
    await callArgs.tools.search.execute({ query: 'hello' });
    expect(toolRun).toHaveBeenCalledWith({ query: 'hello' }, context, {
      locale: 'en',
    });
    expect(result.text).toBe('Generated text');
  });

  it('combines step count and tool call stop conditions from settings', async () => {
    const provider = Object.assign(
      jest.fn().mockReturnValue('model-instance'),
      {
        languageModel: jest.fn(),
      },
    );
    const actionsService = {
      get: jest.fn().mockReturnValue({
        description: 'demo',
        inputSchema: {},
        outputSchema: {},
        run: jest.fn(),
      }),
    };
    const context = createContext({ actions: actionsService });

    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
    jest.spyOn(action as any, 'buildPrompt');
    jest.spyOn(action as any, 'buildCallSettings');
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    generateTextMock.mockResolvedValue({
      text: 'Generated text',
      finishReason: 'stop',
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: {},
      warnings: [],
    } as any);

    const settings = {
      timeout_ms: 0,
      retries: defaultRetries,
      stop_step_count: 5,
      stop_tool_call: 'finalize',
    };
    const input = { prompt: 'Hello there' };
    const bindings = {
      ...createModelBindings(),
      tools: {
        search: { action: 'search_action' },
      },
    };

    await action.execute({ input, settings, context, bindings });
    const stopWhen = (generateTextMock.mock.calls[0][0] as any)
      .stopWhen as Array<(params: any) => boolean>;

    expect(Array.isArray(stopWhen)).toBe(true);
    expect(stepCountIsMock).toHaveBeenCalledWith(5);
    expect(hasToolCallMock).toHaveBeenCalledWith('finalize');
    expect(stopWhen[0]({ steps: new Array(5).fill({}) })).toBe(true);
    expect(stopWhen[0]({ steps: new Array(4).fill({}) })).toBe(false);
    expect(
      stopWhen[1]({
        steps: [{ toolCalls: [{ toolName: 'finalize' }] }],
      }),
    ).toBe(true);
    expect(
      stopWhen[1]({
        steps: [{ toolCalls: [{ toolName: 'other' }] }],
      }),
    ).toBe(false);
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
        description: 'demo',
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
    jest.spyOn(action as any, 'buildPrompt');
    jest.spyOn(action as any, 'buildCallSettings');
    jest.spyOn(action as any, 'createModel').mockReturnValue('model-instance');
    generateTextMock.mockResolvedValue({
      text: 'Generated text',
      finishReason: 'stop',
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: {},
      warnings: [],
    } as any);

    await action.execute({
      input: { prompt: 'Hello there' },
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

    const callArgs = generateTextMock.mock.calls[0][0] as any;

    expect(mcpClientPool.buildToolSet).toHaveBeenCalledWith({
      planner: {
        settings: {
          server_id: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
    expect(Object.keys(callArgs.tools)).toEqual(['search', 'planner__lookup']);
    expect(stepCountIsMock).toHaveBeenCalledWith(10);
    await callArgs.tools.search.execute({ query: 'hello' });
    expect(actionToolRun).toHaveBeenCalledWith({ query: 'hello' }, context, {
      locale: 'en',
    });
    await callArgs.tools.planner__lookup.execute({ query: 'hello' });
    expect(mcpToolRun).toHaveBeenCalledWith({ query: 'hello' });
  });

  it('throws when the model binding is missing', async () => {
    await expect(
      action.execute({
        input: { prompt: 'hi' },
        settings: {
          timeout_ms: 0,
          retries: defaultRetries,
        } as any,
        context: createContext(),
        bindings: {},
      }),
    ).rejects.toThrow('A model is required to run ai_generate_text.');
  });

  it('throws when the model id is missing', async () => {
    await expect(
      action.execute({
        input: { prompt: 'hi' },
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
    ).rejects.toThrow('A model is required to run ai_generate_text.');
  });
});

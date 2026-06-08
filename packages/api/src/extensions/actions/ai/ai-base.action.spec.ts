/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createGatewayProvider } from '@ai-sdk/gateway';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Message, OutgoingMessageType } from '@hexabot-ai/types';
import { LanguageModelUsage } from 'ai';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { ALL_WORKFLOW_TYPES } from '@/actions/types';
import { RuntimeBindings } from '@/bindings/runtime-bindings';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import {
  AiBaseAction,
  AiCommonSettings,
  LanguageModelProvider,
  ProviderInitOptions,
} from './ai-base.action';

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(),
}));

jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(),
}));

jest.mock('@ai-sdk/gateway', () => ({
  createGatewayProvider: jest.fn(),
}));

jest.mock(
  'custom-provider',
  () => ({
    createCustomProvider: jest.fn(
      (options: ProviderInitOptions): LanguageModelProvider =>
        ({
          languageModel: jest
            .fn()
            .mockReturnValue(`model-${options.apiKey ?? 'none'}`),
          textEmbeddingModel: jest.fn(),
          imageModel: jest.fn(),
        }) as LanguageModelProvider,
    ),
  }),
  { virtual: true },
);

class TestAiBaseAction extends AiBaseAction<
  Record<string, unknown>,
  unknown,
  WorkflowRuntimeContext
> {
  constructor(actionService: ActionService) {
    super(
      {
        name: 'ai_test_action',
        description: 'Test action',
        workflowTypes: ALL_WORKFLOW_TYPES,
        inputSchema: z.any(),
        outputSchema: z.any(),
        settingsSchema: z.any(),
      },
      actionService,
    );
  }

  async execute(): Promise<unknown> {
    return null;
  }

  public buildProviderInitOptionsPublic(
    provider: string,
    modelBinding: RuntimeBindings['model'],
    credential: string,
  ) {
    return this.buildProviderInitOptions(provider, modelBinding, credential);
  }

  public shouldRequireApiKeyPublic(provider: string) {
    return this.shouldRequireApiKey(provider);
  }

  public loadProviderPublic(provider: string, options: ProviderInitOptions) {
    return this.loadProvider(provider, options);
  }

  public instantiateProviderFromModulePublic(
    providerModule: Record<string, unknown>,
    provider: string,
    options: ProviderInitOptions,
  ) {
    return this.instantiateProviderFromModule(
      providerModule,
      provider,
      options,
    );
  }

  public getFactoryFunctionsPublic(
    providerModule: Record<string, unknown>,
    provider: string,
  ) {
    return this.getFactoryFunctions(providerModule, provider);
  }

  public isLanguageModelProviderPublic(candidate: unknown) {
    return this.isLanguageModelProvider(candidate);
  }

  public createModelPublic(provider: LanguageModelProvider, modelId: string) {
    return this.createModel(provider, modelId);
  }

  public getProviderIdPublic(provider: string) {
    return this.getProviderId(provider);
  }

  public toPascalCasePublic(value: string) {
    return this.toPascalCase(value);
  }

  public resolveModelIdPublic(modelBinding: RuntimeBindings['model']) {
    return this.resolveModelId(modelBinding);
  }

  public buildPromptPublic(
    input: unknown,
    context: WorkflowRuntimeContext,
    _settings: AiCommonSettings = {} as AiCommonSettings,
    selectedMemorySlugs: string[] = [],
  ) {
    return this.buildPrompt(input as any, context, selectedMemorySlugs);
  }

  public buildMemoryPromptPublic(
    context: WorkflowRuntimeContext,
    selectedMemorySlugs: string[] = [],
  ) {
    return this.buildMemoryPrompt(context, selectedMemorySlugs);
  }

  public buildCallSettingsPublic(settings: AiCommonSettings) {
    return this.buildCallSettings(settings);
  }

  public buildToolsPublic(
    context: WorkflowRuntimeContext,
    toolBindings?: RuntimeBindings['tools'],
    mcpToolBindings?: RuntimeBindings['mcp'],
    selectedMemorySlugs: string[] = [],
  ) {
    return this.buildTools(
      context as any,
      toolBindings,
      mcpToolBindings as any,
      selectedMemorySlugs,
    );
  }

  public normalizeUsagePublic(usage?: LanguageModelUsage) {
    return this.normalizeUsage(usage);
  }
}

const createProviderStub = () =>
  ({
    languageModel: jest.fn(),
    textEmbeddingModel: jest.fn(),
    imageModel: jest.fn(),
  }) as LanguageModelProvider;

describe('AiBaseAction', () => {
  let action: TestAiBaseAction;
  let actionService: ActionService;

  beforeEach(() => {
    jest.clearAllMocks();
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new TestAiBaseAction(actionService);
  });

  it('defaults supported bindings to tools, mcp, model, and memory', () => {
    expect(action.supportedBindings).toEqual([
      'tools',
      'mcp',
      'model',
      'memory',
    ]);
  });

  describe('buildProviderInitOptions', () => {
    it('returns init options when provided', () => {
      const options = action.buildProviderInitOptionsPublic(
        'custom',
        {
          settings: {
            api_key: 'key',
            base_url: 'https://example.com',
            organization: 'org',
            provider: 'openai',
            model_id: 'gpt-4o-mini',
          },
        } as RuntimeBindings['model'],
        'key',
      );

      expect(options).toEqual({
        apiKey: 'key',
        baseURL: 'https://example.com',
        organization: 'org',
      });
    });

    it('throws when api key is required but missing', () => {
      expect(() =>
        action.buildProviderInitOptionsPublic(
          'openai',
          {} as RuntimeBindings['model'],
          'key',
        ),
      ).toThrow(
        'No API key provided for provider "openai". Set bindings.model.<def>.settings.api_key.',
      );
    });
  });

  describe('shouldRequireApiKey', () => {
    it('enforces api key for hosted providers', () => {
      expect(action.shouldRequireApiKeyPublic('openai')).toBe(true);
      expect(action.shouldRequireApiKeyPublic('gateway')).toBe(true);
      expect(action.shouldRequireApiKeyPublic('litellm')).toBe(true);
    });

    it('allows local providers without api key', () => {
      expect(action.shouldRequireApiKeyPublic('local')).toBe(false);
      expect(action.shouldRequireApiKeyPublic('@ai-sdk/local')).toBe(false);
    });
  });

  describe('loadProvider', () => {
    it('loads OpenAI provider via createOpenAI', async () => {
      const provider = createProviderStub();

      (createOpenAI as jest.Mock).mockReturnValue(provider);

      const result = await action.loadProviderPublic('openai', {
        apiKey: 'api-key',
      });

      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'api-key' });
      expect(result).toBe(provider);
    });

    it('loads gateway provider via createGatewayProvider', async () => {
      const provider = createProviderStub();
      const options: ProviderInitOptions = { baseURL: 'https://gateway' };

      (createGatewayProvider as jest.Mock).mockReturnValue(provider);

      const result = await action.loadProviderPublic('gateway', options);

      expect(createGatewayProvider).toHaveBeenCalledWith(options);
      expect(result).toBe(provider);
    });

    it('loads litellm provider via createOpenAICompatible with compatible mode', async () => {
      const provider = createProviderStub();
      const options: ProviderInitOptions = {
        apiKey: 'sk-litellm-key',
        baseURL: 'http://localhost:4000/v1',
      };

      (createOpenAICompatible as jest.Mock).mockReturnValue(provider);

      const result = await action.loadProviderPublic('litellm', options);

      expect(createOpenAICompatible).toHaveBeenCalledWith({
        ...options,
        name: 'litellm',
        baseURL: options.baseURL,
      });
      expect(result).toBe(provider);
    });

    it('loads custom provider via dynamic import', async () => {
      const options: ProviderInitOptions = {
        apiKey: 'custom-key',
        baseURL: 'https://custom',
      };
      const provider = await action.loadProviderPublic(
        'custom-provider',
        options,
      );
      // @ts-expect-error virtual module provided via jest.mock
      const { createCustomProvider } = await import('custom-provider');

      expect((createCustomProvider as jest.Mock).mock.calls[0][0]).toEqual(
        options,
      );
      expect(
        action.isLanguageModelProviderPublic(provider as LanguageModelProvider),
      ).toBe(true);
    });

    it('throws when provider cannot be resolved', async () => {
      await expect(
        action.loadProviderPublic('missing-provider', {}),
      ).rejects.toThrow(/Unsupported LLM provider "missing-provider"/);
    });
  });

  describe('instantiateProviderFromModule', () => {
    it('uses the first working factory', () => {
      const provider = createProviderStub();
      const failingFactory = jest.fn(() => {
        throw new Error('fail');
      });
      const succeedingFactory = jest.fn().mockReturnValue(provider);
      const resolved = action.instantiateProviderFromModulePublic(
        {
          createDemo: failingFactory,
          createDemoAI: succeedingFactory,
        },
        'demo',
        {},
      );

      expect(failingFactory).toHaveBeenCalledTimes(1);
      expect(succeedingFactory).toHaveBeenCalledWith({});
      expect(resolved).toBe(provider);
    });

    it('falls back to provider exports when no factories succeed', () => {
      const provider = createProviderStub();
      const resolved = action.instantiateProviderFromModulePublic(
        {
          default: provider,
        },
        'demo',
        {},
      );

      expect(resolved).toBe(provider);
    });

    it('returns undefined when nothing matches', () => {
      const resolved = action.instantiateProviderFromModulePublic(
        { noop: 'value' },
        'demo',
        {},
      );

      expect(resolved).toBeUndefined();
    });
  });

  describe('getFactoryFunctions', () => {
    it('collects expected factory candidates and skips duplicates', () => {
      const sharedFactory = jest.fn();
      const aiFactory = jest.fn();
      const providerFactory = jest.fn();
      const extraFactory = jest.fn();
      const module: Record<string, unknown> = {
        createDemo: sharedFactory,
        createDemoProvider: sharedFactory,
        createDemoAI: aiFactory,
        createProvider: providerFactory,
        createDemoExtra: extraFactory,
      };
      const factories = action.getFactoryFunctionsPublic(module, 'demo');

      expect(factories).toEqual([
        sharedFactory,
        aiFactory,
        providerFactory,
        extraFactory,
      ]);
    });

    it('falls back to the first create* function when no named factories match', () => {
      const fallbackFactory = function createFallback() {
        return { languageModel: jest.fn() };
      };
      const factories = action.getFactoryFunctionsPublic(
        {
          fallbackFactory,
        },
        'demo',
      );

      expect(factories).toEqual([fallbackFactory]);
    });
  });

  describe('isLanguageModelProvider', () => {
    it('detects provider objects and functions', () => {
      const providerObj = { languageModel: jest.fn() };
      const providerFn = Object.assign(jest.fn(), {
        languageModel: jest.fn(),
      });

      expect(action.isLanguageModelProviderPublic(providerObj)).toBe(true);
      expect(action.isLanguageModelProviderPublic(providerFn)).toBe(true);
    });

    it('rejects non-provider values', () => {
      expect(action.isLanguageModelProviderPublic(null)).toBe(false);
      expect(action.isLanguageModelProviderPublic({})).toBe(false);
      expect(action.isLanguageModelProviderPublic(123)).toBe(false);
    });
  });

  describe('createModel', () => {
    it('creates a model using a provider function', () => {
      const provider = Object.assign(jest.fn().mockReturnValue('model'), {
        languageModel: jest.fn(),
        textEmbeddingModel: jest.fn(),
        imageModel: jest.fn(),
      }) as LanguageModelProvider;
      const model = action.createModelPublic(provider, 'gpt');

      expect(provider).toHaveBeenCalledWith('gpt');
      expect(model).toBe('model');
    });

    it('creates a model using provider.languageModel', () => {
      const provider = createProviderStub();
      (provider.languageModel as jest.Mock).mockReturnValue('model');

      const model = action.createModelPublic(provider, 'gpt');

      expect(provider.languageModel).toHaveBeenCalledWith('gpt');
      expect(model).toBe('model');
    });
  });

  describe('provider and naming helpers', () => {
    it('normalizes provider id and pascal case', () => {
      expect(action.getProviderIdPublic('  @ai-sdk/OpenAI  ')).toBe('openai');
      expect(action.getProviderIdPublic('ai-sdk/custom')).toBe('custom');
      expect(action.getProviderIdPublic('claude')).toBe('anthropic');
      expect(action.getProviderIdPublic('gemini')).toBe('google');
      expect(action.getProviderIdPublic('google-generative-ai')).toBe('google');
      expect(action.getProviderIdPublic('google-vertex-ai')).toBe(
        'google-vertex',
      );
      expect(action.getProviderIdPublic('azure-openai')).toBe('azure');
      expect(action.toPascalCasePublic('custom-ai_provider')).toBe(
        'CustomAiProvider',
      );
    });
  });

  describe('resolveModelId', () => {
    it('returns the model when provided', () => {
      expect(
        action.resolveModelIdPublic({
          settings: {
            model_id: 'gpt-4o',
          },
        } as RuntimeBindings['model']),
      ).toBe('gpt-4o');
    });

    it('throws when model is missing', () => {
      expect(() =>
        action.resolveModelIdPublic({} as RuntimeBindings['model']),
      ).toThrow('A model is required to run ai_test_action.');
    });
  });

  describe('buildPrompt', () => {
    const createMessage = (overrides: Partial<Message>) =>
      ({
        id: overrides.id ?? 'message-id',
        mid: overrides.mid,
        createdAt: overrides.createdAt ?? new Date('2024-01-01T10:00:00Z'),
        updatedAt: overrides.updatedAt ?? new Date('2024-01-01T10:00:00Z'),
        sender: overrides.sender,
        recipient: overrides.recipient,
        sentBy: overrides.sentBy,
        message: overrides.message ?? {
          type: OutgoingMessageType.text,
          data: { text: 'hello' },
        },
        read: overrides.read ?? false,
        delivery: overrides.delivery ?? false,
        handover: overrides.handover ?? false,
      }) as Message;

    it('builds prompt payload from the latest messages using the provided limit', async () => {
      const initiatorId = 'subscriber-123';
      const threadId = 'thread-123';
      const history = [
        createMessage({
          id: 'message-1',
          createdAt: new Date('2024-01-01T09:00:00Z'),
          sender: initiatorId,
          message: {
            type: OutgoingMessageType.text,
            data: { text: 'Hi' },
          },
        }),
        createMessage({
          id: 'message-2',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          sender: 'bot',
          recipient: initiatorId,
          message: {
            type: OutgoingMessageType.text,
            data: { text: 'Hello there' },
          },
        }),
      ];
      const messageService = {
        findLastMessages: jest.fn().mockResolvedValue(history),
      };
      const context = {
        initiatorId,
        threadId,
        services: { message: messageService },
      } as unknown as WorkflowRuntimeContext;
      const result = await action.buildPromptPublic(
        {
          input_mode: 'history',
          messages_limit: 2,
          system: 'system prompt',
        },
        context,
        {} as AiCommonSettings,
      );

      expect(messageService.findLastMessages).toHaveBeenCalledWith(
        { id: threadId },
        2,
      );
      expect(result).toEqual({
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello there' },
        ],
        system: 'system prompt',
      });
    });

    it('builds prompt payload from prompt string', async () => {
      const result = await action.buildPromptPublic(
        {
          input_mode: 'prompt',
          prompt: 'Tell me a joke',
          system: 'system prompt',
        },
        {} as WorkflowRuntimeContext,
        {} as AiCommonSettings,
      );

      expect(result).toEqual({
        prompt: 'Tell me a joke',
        system: 'system prompt',
      });
    });

    it('defaults prompt mode prompt to workflow input text', async () => {
      const result = await action.buildPromptPublic(
        {
          input_mode: 'prompt',
          system: 'system prompt',
        } as unknown as Record<string, unknown>,
        {} as WorkflowRuntimeContext,
        {} as AiCommonSettings,
      );

      expect(result).toEqual({
        prompt: '=$input.text',
        system: 'system prompt',
      });
    });

    it('defaults history mode message limit to 4 when missing', async () => {
      const initiatorId = 'subscriber-123';
      const threadId = 'thread-123';
      const messageService = {
        findLastMessages: jest.fn().mockResolvedValue([]),
      };
      const context = {
        initiatorId,
        threadId,
        services: { message: messageService },
      } as unknown as WorkflowRuntimeContext;

      await action.buildPromptPublic(
        {
          input_mode: 'history',
          system: 'system prompt',
        } as unknown as Record<string, unknown>,
        context,
        {} as AiCommonSettings,
      );

      expect(messageService.findLastMessages).toHaveBeenCalledWith(
        { id: threadId },
        4,
      );
    });

    it('throws when subscriber id is missing for message history requests', async () => {
      await expect(
        action.buildPromptPublic(
          { input_mode: 'history', messages_limit: 1 },
          {
            services: { message: { findLastMessages: jest.fn() } },
          } as unknown as WorkflowRuntimeContext,
          {} as AiCommonSettings,
        ),
      ).rejects.toThrow(
        'A subscriber id is required to load previous messages for this action.',
      );
    });

    it('throws when input mode is missing', async () => {
      await expect(
        action.buildPromptPublic(
          {} as unknown as Record<string, unknown>,
          {} as WorkflowRuntimeContext,
          {} as AiCommonSettings,
        ),
      ).rejects.toThrow(
        'An "input_mode" of either "prompt" or "history" is required to build the model request.',
      );
    });

    it('ignores history fields when input mode is prompt', async () => {
      const result = await action.buildPromptPublic(
        {
          input_mode: 'prompt',
          prompt: 'Tell me a joke',
          messages_limit: 2,
        } as unknown as Record<string, unknown>,
        {} as WorkflowRuntimeContext,
        {} as AiCommonSettings,
      );

      expect(result).toEqual({
        prompt: 'Tell me a joke',
        system: undefined,
      });
    });

    it('ignores prompt field when input mode is history', async () => {
      const initiatorId = 'subscriber-123';
      const threadId = 'thread-123';
      const messageService = {
        findLastMessages: jest.fn().mockResolvedValue([]),
      };
      const context = {
        initiatorId,
        threadId,
        services: { message: messageService },
      } as unknown as WorkflowRuntimeContext;
      const result = await action.buildPromptPublic(
        {
          input_mode: 'history',
          prompt: 'Tell me a joke',
          messages_limit: 2,
        } as unknown as Record<string, unknown>,
        context,
        {} as AiCommonSettings,
      );

      expect(messageService.findLastMessages).toHaveBeenCalledWith(
        { id: threadId },
        2,
      );
      expect(result).toEqual({
        messages: [],
        system: undefined,
      });
    });
  });

  describe('buildMemoryPrompt', () => {
    it('returns undefined when memory store is missing', () => {
      expect(
        action.buildMemoryPromptPublic({} as WorkflowRuntimeContext),
      ).toBeUndefined();
    });

    it('builds a markdown prompt grouped by memory definition names', () => {
      const definitionCache = new Map([
        [
          'user_infos',
          {
            name: 'User infos',
            slug: 'user_infos',
          },
        ],
        [
          'weather_workflow',
          {
            name: 'Weather Workflow',
            slug: 'weather_workflow',
          },
        ],
      ]);
      const userFields = [
        { name: 'phone', title: 'Phone', value: '+1 876 876 876' },
        { name: 'nickname', title: 'Nickname', value: undefined },
        { name: 'age', title: 'Age', value: 42 },
        { name: 'verified', title: 'Verified', value: true },
        {
          name: 'updated_at',
          title: 'Updated at',
          value: new Date('2024-01-02T03:04:05Z'),
        },
      ];
      const weatherFields = [
        { name: 'city', title: 'City', value: 'Paris' },
        { name: 'details', title: 'Details', value: { country: 'France' } },
      ];
      const instances = {
        user_infos: {
          fields: jest.fn().mockReturnValue(userFields),
        },
        weather_workflow: {
          fields: jest.fn().mockReturnValue(weatherFields),
        },
      };
      const context = {
        memoryStore: { definitionCache, instances },
      } as unknown as WorkflowRuntimeContext;
      const result = action.buildMemoryPromptPublic(context, [
        'user_infos',
        'weather_workflow',
      ]);

      expect(instances.user_infos.fields).toHaveBeenCalledWith({
        includeAdditional: true,
      });
      expect(instances.weather_workflow.fields).toHaveBeenCalledWith({
        includeAdditional: true,
      });
      expect(result).toBe(
        [
          '# Working Memory',
          '## User infos',
          '- Phone: +1 876 876 876',
          '- Age: 42',
          '- Verified: true',
          '- Updated at: 2024-01-02T03:04:05.000Z',
          '',
          '## Weather Workflow',
          '- City: Paris',
          '- Details: {"country":"France"}',
        ].join('\n'),
      );
      expect(result).not.toContain('Nickname');
    });
  });

  describe('buildCallSettings', () => {
    it('maps snake_case settings to SDK call settings', () => {
      const result = action.buildCallSettingsPublic({
        temperature: 0.7,
        top_p: 0.9,
        top_k: 10,
        presence_penalty: 0.5,
        frequency_penalty: -0.1,
        stop_sequences: ['stop'],
        max_output_tokens: 50,
        seed: 7,
      } as AiCommonSettings);

      expect(result).toEqual({
        temperature: 0.7,
        topP: 0.9,
        topK: 10,
        presencePenalty: 0.5,
        frequencyPenalty: -0.1,
        stopSequences: ['stop'],
        maxOutputTokens: 50,
        seed: 7,
      });
    });

    it('omits undefined settings', () => {
      const result = action.buildCallSettingsPublic({} as AiCommonSettings);

      expect(result).toEqual({});
    });
  });

  describe('buildTools', () => {
    it('merges action tools, MCP tools, and memory update tool', async () => {
      const actionToolRun = jest.fn().mockResolvedValue({ ok: true });
      const updateMemoryRun = jest.fn().mockResolvedValue({ updated: true });
      const mcpToolRun = jest.fn().mockResolvedValue({ source: 'mcp' });
      const actionsService = {
        get: jest.fn((actionName: string) => {
          if (actionName === 'search_action') {
            return {
              description: 'search tool',
              inputSchema: {},
              outputSchema: {},
              run: actionToolRun,
            };
          }

          if (actionName === 'update_memory') {
            return {
              description: 'update memory',
              inputSchema: {},
              outputSchema: {},
              run: updateMemoryRun,
            };
          }

          throw new Error(`Unexpected action lookup ${actionName}`);
        }),
      };
      const mcpClientPool = {
        buildToolSet: jest.fn().mockResolvedValue({
          planner__search: {
            description: 'mcp search',
            inputSchema: {},
            execute: mcpToolRun,
          },
        }),
      };
      const context = {
        services: {
          actions: actionsService,
          mcp: mcpClientPool,
        },
        memoryStore: {
          buildUpdateMemorySchema: jest.fn().mockReturnValue({
            type: 'object',
            properties: {},
          }),
        },
      } as unknown as WorkflowRuntimeContext;
      const tools = await action.buildToolsPublic(
        context,
        {
          search: {
            action: 'search_action',
            settings: { scope: 'web' },
          },
        } as RuntimeBindings['tools'],
        {
          planner: {
            settings: {
              server_id: '11111111-1111-4111-8111-111111111111',
              tool_names: ['search'],
            },
          },
        } as RuntimeBindings['mcp'],
        ['user_profile'],
      );

      expect(Object.keys(tools ?? {})).toEqual([
        'search',
        'planner__search',
        'update_memory',
      ]);
      expect(mcpClientPool.buildToolSet).toHaveBeenCalledWith({
        planner: {
          settings: {
            server_id: '11111111-1111-4111-8111-111111111111',
            tool_names: ['search'],
          },
        },
      });
      await (tools as Record<string, any>).search.execute({ query: 'hello' });
      expect(actionToolRun).toHaveBeenCalledWith({ query: 'hello' }, context, {
        scope: 'web',
      });
      await (tools as Record<string, any>).planner__search.execute({
        query: 'hello',
      });
      expect(mcpToolRun).toHaveBeenCalledWith({ query: 'hello' });
      await (tools as Record<string, any>).update_memory.execute({
        user_profile: {},
      });
      expect(updateMemoryRun).toHaveBeenCalledWith(
        { user_profile: {} },
        context,
      );
    });

    it('forwards nested tool bindings to tool actions', async () => {
      const actionToolRun = jest.fn().mockResolvedValue({ ok: true });
      const actionsService = {
        get: jest.fn((actionName: string) => {
          if (actionName === 'delegate_action') {
            return {
              description: 'delegate tool',
              inputSchema: {},
              outputSchema: {},
              run: actionToolRun,
            };
          }

          throw new Error(`Unexpected action lookup ${actionName}`);
        }),
      };
      const context = {
        services: {
          actions: actionsService,
        },
      } as unknown as WorkflowRuntimeContext;
      const nestedBindings: RuntimeBindings = {
        model: {
          settings: {
            provider: 'openai',
            model_id: 'gpt-5.2',
          },
        },
        memory: {
          profile: {
            settings: {
              definition_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            },
          },
        },
      };
      const tools = await action.buildToolsPublic(context, {
        delegate: {
          action: 'delegate_action',
          settings: { scope: 'child' },
          bindings: nestedBindings,
        },
      } as RuntimeBindings['tools']);

      await (tools as Record<string, any>).delegate.execute({
        query: 'hello',
      });

      expect(actionToolRun).toHaveBeenCalledWith(
        { query: 'hello' },
        context,
        { scope: 'child' },
        nestedBindings,
      );
    });

    it('logs a warning and keeps first tool when action and MCP tools resolve the same name', async () => {
      const actionsService = {
        get: jest.fn((actionName: string) => {
          if (actionName === 'search_action') {
            return {
              description: 'search tool',
              inputSchema: {},
              outputSchema: {},
              run: jest.fn().mockResolvedValue({ ok: true }),
            };
          }

          throw new Error(`Unexpected action lookup ${actionName}`);
        }),
      };
      const mcpClientPool = {
        buildToolSet: jest.fn().mockResolvedValue({
          search: {
            description: 'duplicate search tool',
            inputSchema: {},
            execute: jest.fn().mockResolvedValue({ source: 'mcp' }),
          },
        }),
      };
      const logger = { warn: jest.fn() };
      const context = {
        services: {
          actions: actionsService,
          mcp: mcpClientPool,
          logger,
        },
        memoryStore: {
          buildUpdateMemorySchema: jest.fn().mockReturnValue(undefined),
        },
      } as unknown as WorkflowRuntimeContext;
      const tools = await action.buildToolsPublic(
        context,
        {
          search: {
            action: 'search_action',
            settings: {},
          },
        } as RuntimeBindings['tools'],
        {
          planner: {
            settings: {
              server_id: '11111111-1111-4111-8111-111111111111',
            },
          },
        } as RuntimeBindings['mcp'],
      );

      expect(Object.keys(tools ?? {})).toEqual(['search']);
      expect(logger.warn).toHaveBeenCalledWith(
        'Skipping duplicate tool name "search" from bindings.mcp',
      );
    });
  });

  describe('normalizeUsage', () => {
    it('returns undefined when usage is missing', () => {
      expect(action.normalizeUsagePublic()).toBeUndefined();
    });

    it('normalizes usage fields to snake_case', () => {
      const normalized = action.normalizeUsagePublic({
        inputTokens: 10,
        inputTokenDetails: {
          noCacheTokens: 6,
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
        },
        outputTokens: 20,
        outputTokenDetails: {
          textTokens: 18,
          reasoningTokens: 5,
        },
        totalTokens: 30,
        raw: { billable_units: 10 },
      } as unknown as LanguageModelUsage);

      expect(normalized).toEqual({
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        reasoning_tokens: 5,
        cached_input_tokens: 3,
        input_token_details: {
          no_cache_tokens: 6,
          cache_read_tokens: 3,
          cache_write_tokens: 1,
        },
        output_token_details: {
          text_tokens: 18,
          reasoning_tokens: 5,
        },
        raw: { billable_units: 10 },
      });
    });
  });
});

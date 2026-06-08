/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ProviderV2, ProviderV3 } from '@ai-sdk/provider';
import {
  IncomingMessageType,
  Message,
  StdIncomingMessage,
  StdOutgoingMessage,
  Thread,
} from '@hexabot-ai/types';
import {
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  ToolSet,
  hasToolCall,
  stepCountIs,
} from 'ai';

import { ActionService } from '@/actions/actions.service';
import { BaseAction } from '@/actions/base-action';
import { ActionMetadata, ActionName } from '@/actions/types';
import { RuntimeBindings } from '@/bindings/runtime-bindings';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import { McpToolBindingDefinitions } from '@/workflow/types';

import {
  AiCommonSettings,
  AiPromptInput,
  DEFAULT_AI_MESSAGES_LIMIT,
  DEFAULT_AI_PROMPT,
} from './ai-schemas';

export type { AiCommonSettings, AiPromptInput } from './ai-schemas';

export type ProviderInitOptions = {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
};

export type LanguageModelProvider =
  | (ProviderV3 & {
      (modelId: string): LanguageModel;
    })
  | (ProviderV2 & {
      (modelId: string): LanguageModel;
    })
  | ProviderV3
  | ProviderV2;

type PromptPayload =
  | {
      prompt: string;
      system?: string;
    }
  | {
      messages: ModelMessage[];
      system?: string;
    };

export abstract class AiBaseAction<
  I,
  O,
  C extends WorkflowRuntimeContext = WorkflowRuntimeContext,
  S extends AiCommonSettings = AiCommonSettings,
> extends BaseAction<I, O, C, S> {
  private static readonly DEFAULT_COLOR = '#b65bfd';

  private static readonly DEFAULT_GROUP = 'ai';

  protected constructor(
    metadata: ActionMetadata<I, O, S>,
    actionService: ActionService,
  ) {
    super(
      {
        ...metadata,
        color: metadata.color ?? AiBaseAction.DEFAULT_COLOR,
        group: metadata.group ?? AiBaseAction.DEFAULT_GROUP,
        icon: 'Sparkles',
        supportedBindings: metadata.supportedBindings ?? [
          'tools',
          'mcp',
          'model',
          'memory',
        ],
      },
      actionService,
    );
  }

  protected buildProviderInitOptions(
    provider: string,
    modelBinding: RuntimeBindings['model'],
    credentials: string,
  ): ProviderInitOptions {
    const providerId = this.getProviderId(provider);
    const modelSettings = modelBinding?.settings;
    const apiKey = modelSettings?.api_key;
    const baseURL = modelSettings?.base_url;
    const organization = modelSettings?.organization;

    if (!apiKey && this.shouldRequireApiKey(providerId)) {
      throw new Error(
        `No API key provided for provider "${provider}". Set bindings.model.<def>.settings.api_key.`,
      );
    }

    return {
      apiKey: credentials,
      baseURL,
      organization,
    };
  }

  protected shouldRequireApiKey(provider: string) {
    // Most hosted providers need an API key; skip strict enforcement for custom/local providers.
    const providerId = this.getProviderId(provider);

    return (
      providerId === 'openai' ||
      providerId === 'gateway' ||
      providerId === 'litellm'
    );
  }

  protected async loadProvider(
    provider: string,
    options: ProviderInitOptions,
  ): Promise<LanguageModelProvider> {
    const normalized = provider.trim().toLowerCase();
    const providerId = this.getProviderId(provider);

    if (providerId === 'openai') {
      return createOpenAI(options);
    }

    if (providerId === 'gateway') {
      const { createGatewayProvider } = await import('@ai-sdk/gateway');

      return createGatewayProvider(options);
    }

    if (providerId === 'litellm') {
      return createOpenAICompatible({
        ...options,
        name: 'litellm',
        baseURL: options.baseURL || '',
      });
    }

    const moduleCandidates = new Set<string>([
      provider,
      normalized,
      providerId,
    ]);
    if (!normalized.startsWith('@ai-sdk/') && !providerId.startsWith('@')) {
      moduleCandidates.add(`@ai-sdk/${providerId}`);
    }
    let lastError: unknown;

    for (const moduleName of moduleCandidates) {
      try {
        const providerModule = await import(moduleName);
        const resolved = this.instantiateProviderFromModule(
          providerModule,
          providerId,
          options,
        );

        if (resolved) {
          return resolved;
        }
      } catch (error) {
        lastError = error;
      }
    }

    const errorMessage =
      `Unsupported LLM provider "${provider}". Install the matching AI SDK provider package (for example @ai-sdk/${providerId}) and ensure it exports a create* factory.` +
      (lastError ? ` Last error: ${(lastError as Error).message}` : '');

    throw new Error(errorMessage);
  }

  protected instantiateProviderFromModule(
    providerModule: Record<string, unknown>,
    provider: string,
    options: ProviderInitOptions,
  ): LanguageModelProvider | undefined {
    const providerId = this.getProviderId(provider);
    const factoryFunctions = this.getFactoryFunctions(
      providerModule,
      providerId,
    );

    for (const factory of factoryFunctions) {
      try {
        const created = factory(options);
        if (this.isLanguageModelProvider(created)) {
          return created;
        }
      } catch {
        // Ignore and try next factory candidate.
      }
    }

    const providerCandidates = [
      providerModule[provider],
      providerModule[providerId],
      providerModule.default,
      ...Object.values(providerModule),
    ];

    for (const candidate of providerCandidates) {
      if (this.isLanguageModelProvider(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  protected getFactoryFunctions(
    providerModule: Record<string, unknown>,
    provider: string,
  ): Array<(options: ProviderInitOptions) => LanguageModelProvider> {
    const normalized = provider.trim().toLowerCase();
    const pascalName = this.toPascalCase(normalized);
    const factoryNames = [
      `create${pascalName}`,
      `create${pascalName}Provider`,
      `create${pascalName}AI`,
      'createProvider',
    ];
    const seen = new Set<unknown>();
    const factories: Array<
      (options: ProviderInitOptions) => LanguageModelProvider
    > = [];

    for (const name of factoryNames) {
      const fn = providerModule[name];
      if (typeof fn === 'function' && !seen.has(fn)) {
        factories.push(
          fn as unknown as (
            options: ProviderInitOptions,
          ) => LanguageModelProvider,
        );
        seen.add(fn);
      }
    }

    for (const [exportName, value] of Object.entries(providerModule)) {
      const isCandidate =
        typeof value === 'function' &&
        exportName.startsWith('create') &&
        exportName.toLowerCase().includes(normalized);

      if (isCandidate && !seen.has(value)) {
        factories.push(
          value as unknown as (
            options: ProviderInitOptions,
          ) => LanguageModelProvider,
        );
        seen.add(value);
      }
    }

    if (factories.length === 0) {
      for (const value of Object.values(providerModule)) {
        if (typeof value === 'function' && value.name?.startsWith('create')) {
          factories.push(
            value as unknown as (
              options: ProviderInitOptions,
            ) => LanguageModelProvider,
          );
          break;
        }
      }
    }

    return factories;
  }

  protected isLanguageModelProvider(
    candidate: unknown,
  ): candidate is LanguageModelProvider {
    if (
      !candidate ||
      (typeof candidate !== 'function' && typeof candidate !== 'object')
    ) {
      return false;
    }

    return typeof (candidate as ProviderV2).languageModel === 'function';
  }

  protected createModel(provider: LanguageModelProvider, modelId: string) {
    return typeof provider === 'function'
      ? provider(modelId)
      : provider.languageModel(modelId);
  }

  protected getProviderId(provider: string) {
    const normalized = provider.trim().toLowerCase();
    const providerId = normalized
      .replace(/^@ai-sdk\//, '')
      .replace(/^ai-sdk\//, '');
    const aliases: Record<string, string> = {
      claude: 'anthropic',
      gemini: 'google',
      'google-generative-ai': 'google',
      'google-vertex-ai': 'google-vertex',
      'azure-openai': 'azure',
    };

    return aliases[providerId] ?? providerId;
  }

  protected toPascalCase(value: string) {
    return value
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('');
  }

  protected isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  protected isModelBindingConfig(
    value: unknown,
  ): value is RuntimeBindings['model'] {
    const knownKeys = [
      'provider',
      'model_id',
      'api_key',
      'base_url',
      'organization',
    ] as const;

    if (!this.isPlainObject(value) || !this.isPlainObject(value.settings)) {
      return false;
    }

    const settings = value.settings;

    return (
      knownKeys.some((key) => key in settings) &&
      (settings.model_id === undefined ||
        typeof settings.model_id === 'string') &&
      (settings.provider === undefined || typeof settings.provider === 'string')
    );
  }

  protected resolveModelId(modelBinding: RuntimeBindings['model']) {
    const modelId = modelBinding?.settings?.model_id;

    if (!modelId) {
      throw new Error(`A model is required to run ${this.name}.`);
    }

    return modelId;
  }

  protected resolveMessageContent(
    payload: StdOutgoingMessage | StdIncomingMessage,
  ) {
    if (!payload) {
      return undefined;
    }

    const data = payload.data as Record<string, unknown>;

    if (typeof data.text === 'string') {
      return data.text;
    }

    if (typeof data.serializedText === 'string') {
      return data.serializedText;
    }

    if (
      payload.type === IncomingMessageType.location &&
      typeof data.coordinates === 'object' &&
      data.coordinates !== null &&
      'lat' in data.coordinates &&
      'lon' in data.coordinates
    ) {
      const { lat, lon } = data.coordinates as { lat: number; lon: number };

      return `location:${lat},${lon}`;
    }

    try {
      return JSON.stringify(data);
    } catch {
      return String(payload);
    }
  }

  protected normalizeMessagesForModel(
    messages: Message[],
    subscriberId: string,
  ): ModelMessage[] {
    type ConversationMessage = {
      role: Extract<ModelMessage['role'], 'user' | 'assistant'>;
      content: string;
      createdAt: Date;
    };

    const normalized: ConversationMessage[] = messages
      .map((message) => {
        const content = this.resolveMessageContent(message.message);

        if (!content) {
          return undefined;
        }

        const role: ConversationMessage['role'] =
          message.sender === subscriberId ? 'user' : 'assistant';

        return {
          role,
          content,
          createdAt: message.createdAt,
        };
      })
      .filter((message): message is ConversationMessage => Boolean(message));

    return normalized
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ role, content }) => ({ role, content }));
  }

  protected async buildPrompt(
    input: AiPromptInput,
    context: C,
    selectedMemorySlugs: string[] = [],
  ): Promise<PromptPayload> {
    const promptPayload = { system: input.system };
    const memoryPrompt = this.buildMemoryPrompt(context, selectedMemorySlugs);
    if (memoryPrompt) {
      promptPayload.system = promptPayload.system
        ? `${promptPayload.system}\n\n${memoryPrompt}`
        : memoryPrompt;
    }

    if (input.input_mode === 'prompt') {
      const prompt = input.prompt ?? DEFAULT_AI_PROMPT;

      return {
        prompt,
        system: promptPayload.system,
      };
    }

    if (input.input_mode === 'history') {
      const messagesLimit = input.messages_limit ?? DEFAULT_AI_MESSAGES_LIMIT;

      if (messagesLimit < 1) {
        throw new Error(
          'Input mode "history" requires a positive "messages_limit" value.',
        );
      }

      const subscriberId = context.initiatorId;
      if (!subscriberId) {
        throw new Error(
          'A subscriber id is required to load previous messages for this action.',
        );
      }
      const threadId = context.threadId;
      if (!threadId) {
        throw new Error(
          'A thread id is required to load previous messages for this action.',
        );
      }

      const messageService = context.services.message;
      if (!messageService) {
        throw new Error(
          'Message service is unavailable in the workflow context.',
        );
      }

      const history = await messageService.findLastMessages(
        { id: threadId } as Thread,
        messagesLimit,
      );
      const messages = this.normalizeMessagesForModel(history, subscriberId);

      return { messages, system: promptPayload.system };
    }

    throw new Error(
      'An "input_mode" of either "prompt" or "history" is required to build the model request.',
    );
  }

  protected resolveMemoryBindingSlugs(
    context: C,
    memoryBindings?: RuntimeBindings['memory'],
  ): string[] {
    if (!memoryBindings || Object.keys(memoryBindings).length === 0) {
      return [];
    }

    const memoryStore = context.memoryStore;
    if (!memoryStore) {
      return [];
    }

    const idToSlug = new Map<string, string>();
    for (const [slug, definition] of memoryStore.definitionCache.entries()) {
      if (definition.id) {
        idToSlug.set(definition.id, slug);
      }
    }

    const selectedSlugs = new Set<string>();
    for (const [defName, binding] of Object.entries(memoryBindings)) {
      const definitionId = binding.settings?.definition_id;
      const slug =
        typeof definitionId === 'string'
          ? idToSlug.get(definitionId)
          : undefined;
      if (!slug) {
        throw new Error(
          `Unable to resolve memory definition "${String(definitionId)}" from bindings.memory.${defName}.settings.definition_id.`,
        );
      }

      selectedSlugs.add(slug);
    }

    return Array.from(selectedSlugs);
  }

  protected buildMemoryPrompt(
    context: C,
    selectedMemorySlugs: string[] = [],
  ): string | undefined {
    if (selectedMemorySlugs.length === 0) {
      return undefined;
    }

    const memoryStore = context.memoryStore;
    if (!memoryStore) {
      return undefined;
    }

    const { definitionCache, instances } = memoryStore;
    if (!definitionCache || definitionCache.size === 0) {
      return undefined;
    }

    const sections: string[] = [];
    const selectedSlugSet = new Set(selectedMemorySlugs);
    for (const [slug, definition] of definitionCache.entries()) {
      if (!selectedSlugSet.has(slug)) {
        continue;
      }

      const instance = instances[slug];
      if (!instance) {
        continue;
      }

      const lines: string[] = [];
      for (const field of instance.fields({ includeAdditional: true })) {
        if (field.value === undefined) {
          continue;
        }

        const label = (field.title ?? field.name).trim();
        const value = this.formatMemoryValue(field.value);
        lines.push(`- ${label}: ${value}`);
      }

      if (lines.length === 0) {
        continue;
      }

      sections.push(`## ${definition.name}\n${lines.join('\n')}`);
    }

    if (sections.length === 0) {
      return undefined;
    }

    return `# Working Memory\n${sections.join('\n\n')}`;
  }

  protected formatMemoryValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (value === null) {
      return 'null';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  protected safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  protected buildCallSettings(settings: S) {
    const resolved: {
      temperature?: number;
      topP?: number;
      topK?: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
      stopSequences?: string[];
      maxOutputTokens?: number;
      seed?: number;
    } = {};
    const assign = <K extends keyof typeof resolved>(
      key: K,
      value: (typeof resolved)[K] | undefined,
    ) => {
      if (value !== undefined) {
        resolved[key] = value;
      }
    };

    assign('temperature', settings.temperature);
    assign('topP', settings.top_p);
    assign('topK', settings.top_k);
    assign('presencePenalty', settings.presence_penalty);
    assign('frequencyPenalty', settings.frequency_penalty);
    assign('stopSequences', settings.stop_sequences);
    assign('maxOutputTokens', settings.max_output_tokens);
    assign('seed', settings.seed);

    return resolved;
  }

  protected async buildTools(
    context: C,
    toolBindings?: RuntimeBindings['tools'],
    mcpToolBindings?: RuntimeBindings['mcp'],
    selectedMemorySlugs: string[] = [],
    signal?: AbortSignal,
  ): Promise<ToolSet | undefined> {
    const actionService = context.services.actions;
    const logger = context.services.logger;
    if (!actionService) {
      throw new Error('Action service is unavailable in the workflow context.');
    }

    const tools: ToolSet = {};
    const mountedTools = (toolBindings ?? {}) as NonNullable<
      RuntimeBindings['tools']
    >;

    for (const [toolName, toolDefinition] of Object.entries(mountedTools)) {
      const normalizedToolName = toolName.trim();
      if (normalizedToolName.length === 0) {
        continue;
      }
      const actionNameRaw = toolDefinition.action;
      if (typeof actionNameRaw !== 'string' || actionNameRaw.trim() === '') {
        throw new Error(
          `Invalid tool action in bindings.tools.${normalizedToolName}.action`,
        );
      }
      const actionName = actionNameRaw.trim() as ActionName;
      const action = actionService.get(actionName);
      if (normalizedToolName in tools) {
        logger?.warn(
          `Skipping duplicate tool name "${normalizedToolName}" from bindings.tools`,
        );
      } else {
        const nestedBindings = toolDefinition.bindings;
        tools[normalizedToolName] = {
          description: action.description,
          inputSchema: action.inputSchema,
          outputSchema: action.outputSchema,
          execute: async (input, options) => {
            const toolSignal = options?.abortSignal ?? signal;

            if (nestedBindings) {
              return toolSignal
                ? action.run(
                    input,
                    context,
                    toolDefinition.settings as any,
                    nestedBindings as RuntimeBindings,
                    toolSignal,
                  )
                : action.run(
                    input,
                    context,
                    toolDefinition.settings as any,
                    nestedBindings as RuntimeBindings,
                  );
            }

            return toolSignal
              ? action.run(
                  input,
                  context,
                  toolDefinition.settings as any,
                  undefined,
                  toolSignal,
                )
              : action.run(input, context, toolDefinition.settings as any);
          },
        } as ToolSet[string];
      }
    }

    const mountedMcpTools = (mcpToolBindings ?? {}) as NonNullable<
      RuntimeBindings['mcp']
    >;
    if (Object.keys(mountedMcpTools).length > 0) {
      const mcpClientPool = context.services.mcp;
      if (!mcpClientPool) {
        throw new Error(
          'MCP client pool service is unavailable in the workflow context.',
        );
      }

      const mcpTools = await mcpClientPool.buildToolSet(
        mountedMcpTools as McpToolBindingDefinitions,
      );
      for (const [toolName, toolDefinition] of Object.entries(mcpTools)) {
        if (toolName in tools) {
          logger?.warn(
            `Skipping duplicate tool name "${toolName}" from bindings.mcp`,
          );
        } else {
          tools[toolName] = toolDefinition as ToolSet[string];
        }
      }
    }

    if (selectedMemorySlugs.length > 0) {
      const updateMemoryAction = actionService.get('update_memory');
      const memorySchema =
        context.memoryStore.buildUpdateMemorySchema(selectedMemorySlugs);
      if (!memorySchema) {
        return Object.keys(tools).length > 0 ? tools : undefined;
      }

      if ('update_memory' in tools) {
        logger?.warn(
          'Skipping duplicate tool name "update_memory" from memory',
        );
      } else {
        tools['update_memory'] = {
          description: updateMemoryAction.description,
          inputSchema: memorySchema,
          outputSchema: memorySchema,
          execute: async (input, options) => {
            const toolSignal = options?.abortSignal ?? signal;

            return toolSignal
              ? updateMemoryAction.run(
                  input,
                  context,
                  undefined,
                  undefined,
                  toolSignal,
                )
              : updateMemoryAction.run(input, context);
          },
        } as ToolSet[string];
      }
    }

    return Object.keys(tools).length > 0 ? tools : undefined;
  }

  protected normalizeUsage(usage?: LanguageModelUsage) {
    if (!usage) {
      return undefined;
    }

    const hasInputDetails =
      usage.inputTokenDetails?.noCacheTokens !== undefined ||
      usage.inputTokenDetails?.cacheReadTokens !== undefined ||
      usage.inputTokenDetails?.cacheWriteTokens !== undefined;
    const hasOutputDetails =
      usage.outputTokenDetails?.textTokens !== undefined ||
      usage.outputTokenDetails?.reasoningTokens !== undefined;

    return {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      reasoning_tokens:
        usage.reasoningTokens ?? usage.outputTokenDetails?.reasoningTokens,
      cached_input_tokens:
        usage.cachedInputTokens ?? usage.inputTokenDetails?.cacheReadTokens,
      input_token_details: hasInputDetails
        ? {
            no_cache_tokens: usage.inputTokenDetails?.noCacheTokens,
            cache_read_tokens: usage.inputTokenDetails?.cacheReadTokens,
            cache_write_tokens: usage.inputTokenDetails?.cacheWriteTokens,
          }
        : undefined,
      output_token_details: hasOutputDetails
        ? {
            text_tokens: usage.outputTokenDetails?.textTokens,
            reasoning_tokens: usage.outputTokenDetails?.reasoningTokens,
          }
        : undefined,
      raw: usage.raw,
    };
  }

  protected buildStopWhen(
    settings: Partial<{
      stop_step_count: number;
      stop_tool_call: string;
    }>,
    tools?: Record<string, unknown>,
  ): {
    stopWhen:
      | ReturnType<typeof stepCountIs>
      | ReturnType<typeof hasToolCall>
      | Array<ReturnType<typeof stepCountIs> | ReturnType<typeof hasToolCall>>
      | undefined;
    stepCount?: number;
    toolCall?: string;
  } {
    const stopConditions: Array<
      ReturnType<typeof stepCountIs> | ReturnType<typeof hasToolCall>
    > = [];
    // By default the default step count would be the max number of tools
    // that could be called + 1 step pour generating the output
    const defaultStepCount = tools ? 1 + Object.keys(tools).length : 0;
    const resolvedStepCount = settings.stop_step_count ?? defaultStepCount;

    if (resolvedStepCount > 0) {
      stopConditions.push(stepCountIs(resolvedStepCount));
    }

    const stopToolCall = settings.stop_tool_call?.trim();

    if (stopToolCall) {
      stopConditions.push(hasToolCall(stopToolCall));
    }

    const stopWhen =
      stopConditions.length === 0
        ? undefined
        : stopConditions.length === 1
          ? stopConditions[0]
          : stopConditions;

    return {
      stopWhen,
      stepCount: resolvedStepCount > 0 ? resolvedStepCount : undefined,
      toolCall: stopToolCall || undefined,
    };
  }
}

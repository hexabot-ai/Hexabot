/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ProviderV2, ProviderV3 } from '@ai-sdk/provider';
import { StdIncomingMessage, StdOutgoingMessage } from '@hexabot-ai/types';
import {
  LanguageModel,
  LanguageModelUsage,
  PrepareStepFunction,
  ToolSet,
  hasToolCall,
  stepCountIs,
} from 'ai';

import { ActionService } from '@/actions/actions.service';
import { BaseAction } from '@/actions/base-action';
import { ActionMetadata, ActionName, ExecArgs } from '@/actions/types';
import { RuntimeBindings } from '@/bindings/runtime-bindings';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import { McpToolBindingDefinitions } from '@/workflow/types';

import {
  buildMemoryPrompt,
  buildPrompt,
  formatMemoryValue,
  normalizeMessagesForModel,
  resolveMemoryBindingSlugs,
  resolveMessageContent,
  type PromptPayload,
} from './ai-prompt.helpers';
import {
  AiCommonSettings,
  AiPromptInput,
  DEFAULT_AI_STOP_STEP_COUNT,
} from './ai-schemas';

export type { AiCommonSettings, AiPromptInput } from './ai-schemas';

export type ProviderInitOptions = {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
  supportsStructuredOutputs?: boolean;
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

/**
 * Added to the system prompt of the last step an action may run, so the model
 * answers instead of ending the run on a tool call, which would leave no text.
 * The tools stay declared: providers such as Bedrock drop the tool results from
 * the conversation when a call carries no tools.
 */
export const AI_LAST_STEP_INSTRUCTION = [
  'You have reached the limit of tool calls for this request.',
  'Do not call any more tools.',
  'Give your final response now, using only the information you already have.',
  'If that information is not enough, say what is missing.',
].join(' ');

/** The part of a model call result that tells whether its step limit cut it short. */
type StepLimitResult = {
  finishReason: string;
  steps: Array<{ toolCalls: Array<{ toolName: string }> }>;
};

/** Returns `values`, or undefined when none of them is defined. */
const unlessAllUndefined = <T extends Record<string, unknown>>(
  values: T,
): T | undefined =>
  Object.values(values).some((value) => value !== undefined)
    ? values
    : undefined;

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
    const supportsStructuredOutputs =
      modelSettings?.supports_structured_outputs;

    if (!apiKey && this.shouldRequireApiKey(providerId)) {
      throw new Error(
        `No API key provided for provider "${provider}". Set bindings.model.<def>.settings.api_key.`,
      );
    }

    return {
      apiKey: credentials,
      baseURL,
      organization,
      supportsStructuredOutputs,
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

    if (providerId === 'litellm' || providerId === 'openai-compatible') {
      if (!options.baseURL) {
        throw new Error(
          `No base URL provided for provider "${provider}". Set bindings.model.<def>.settings.base_url.`,
        );
      }

      return createOpenAICompatible({
        ...options,
        name: providerId,
        baseURL: options.baseURL,
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
      'supports_structured_outputs',
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
    return resolveMessageContent(payload);
  }

  protected normalizeMessagesForModel(
    messages: Parameters<typeof normalizeMessagesForModel>[0],
    subscriberId: string,
  ) {
    return normalizeMessagesForModel(messages, subscriberId);
  }

  protected buildPrompt(
    input: AiPromptInput,
    context: C,
    selectedMemorySlugs: string[] = [],
  ): Promise<PromptPayload> {
    return buildPrompt(input, context, selectedMemorySlugs);
  }

  protected resolveMemoryBindingSlugs(
    context: C,
    memoryBindings?: RuntimeBindings['memory'],
  ): string[] {
    return resolveMemoryBindingSlugs(context, memoryBindings);
  }

  protected async prepareCall(
    input: AiPromptInput,
    {
      settings,
      context,
      bindings,
      signal,
    }: Pick<ExecArgs<I, C, S>, 'settings' | 'context' | 'bindings' | 'signal'>,
  ) {
    const logger = context.services.logger;
    const modelBinding = bindings.model;
    const providerName = modelBinding?.settings?.provider ?? 'openai';
    const modelId = this.resolveModelId(modelBinding);
    const credentials = await context.services.credentials.findOneValue(
      modelBinding?.settings?.api_key,
    );
    const providerOptions = this.buildProviderInitOptions(
      providerName,
      modelBinding,
      credentials,
    );
    const provider = await this.loadProvider(providerName, providerOptions);
    const model = this.createModel(provider, modelId);
    const selectedMemorySlugs = this.resolveMemoryBindingSlugs(
      context,
      bindings.memory,
    );
    const promptPayload = await this.buildPrompt(
      input,
      context,
      selectedMemorySlugs,
    );
    const callSettings = this.buildCallSettings(settings);
    const tools = await this.buildTools(
      context,
      bindings.tools,
      bindings.mcp,
      selectedMemorySlugs,
      signal,
    );
    const toolNames = [
      ...Object.keys(bindings.tools ?? {}),
      ...Object.keys(bindings.mcp ?? {}),
    ];
    const { stopWhen, prepareStep, stepCount, toolCall } = this.buildStopWhen(
      settings,
      tools,
      promptPayload.system,
    );

    return {
      callSettings,
      logCall: () =>
        logger.debug(
          `Calling model "${modelId}" via ${this.name} action using provider "${providerName}"`,
          {
            provider: providerName,
            base_url: providerOptions.baseURL,
            tools: toolNames,
            stop_when: {
              step_count: stepCount,
              tool_call: toolCall,
            },
          },
        ),
      model,
      modelId,
      prepareStep,
      promptPayload,
      stepCount,
      /**
       * Tells whether the step limit ended the call while the model still
       * wanted to use tools, in which case it produced no final answer.
       */
      isStepLimitReached: (result: StepLimitResult): boolean => {
        const reached = this.isStepLimitReached(result, {
          stepCount,
          toolCall,
        });

        // A single step is never asked to answer, so stopping on its tool
        // call is what the workflow asked for.
        if (reached && prepareStep) {
          logger.warn(
            `Model "${modelId}" reached the step limit of the ${this.name} action without a final answer`,
            { step_count: stepCount },
          );
        }

        return reached;
      },
      stopWhen,
      tools,
    };
  }

  protected buildMemoryPrompt(
    context: C,
    selectedMemorySlugs: string[] = [],
  ): string | undefined {
    return buildMemoryPrompt(context, selectedMemorySlugs);
  }

  protected formatMemoryValue(value: unknown): string {
    return formatMemoryValue(value);
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
    // The first tool mounted under a name keeps it.
    const mount = (name: string, tool: ToolSet[string], source: string) => {
      if (name in tools) {
        logger?.warn(`Skipping duplicate tool name "${name}" from ${source}`);
      } else {
        tools[name] = tool;
      }
    };

    for (const [toolName, toolDefinition] of Object.entries(
      toolBindings ?? {},
    )) {
      const normalizedToolName = toolName.trim();
      if (normalizedToolName.length > 0) {
        mount(
          normalizedToolName,
          this.buildActionTool(
            context,
            normalizedToolName,
            toolDefinition,
            signal,
          ),
          'bindings.tools',
        );
      }
    }

    if (Object.keys(mcpToolBindings ?? {}).length > 0) {
      const mcpClientPool = context.services.mcp;
      if (!mcpClientPool) {
        throw new Error(
          'MCP client pool service is unavailable in the workflow context.',
        );
      }

      const mcpTools = await mcpClientPool.buildToolSet(
        mcpToolBindings as McpToolBindingDefinitions,
      );
      for (const [toolName, toolDefinition] of Object.entries(mcpTools)) {
        mount(toolName, toolDefinition as ToolSet[string], 'bindings.mcp');
      }
    }

    if (selectedMemorySlugs.length > 0) {
      const updateMemoryAction = actionService.get('update_memory');
      const memorySchema =
        context.memoryStore.buildUpdateMemorySchema(selectedMemorySlugs);
      if (memorySchema) {
        mount(
          'update_memory',
          {
            description: updateMemoryAction.description,
            inputSchema: memorySchema,
            outputSchema: memorySchema,
            execute: async (input, options) =>
              updateMemoryAction.run(
                input,
                context,
                undefined,
                undefined,
                options?.abortSignal ?? signal,
              ),
          } as ToolSet[string],
          'memory',
        );
      }
    }

    return Object.keys(tools).length > 0 ? tools : undefined;
  }

  /** Builds the tool that runs the action bound as `bindings.tools.<name>`. */
  private buildActionTool(
    context: C,
    toolName: string,
    toolDefinition: NonNullable<RuntimeBindings['tools']>[string],
    signal?: AbortSignal,
  ): ToolSet[string] {
    const actionName = toolDefinition.action;
    if (typeof actionName !== 'string' || actionName.trim() === '') {
      throw new Error(
        `Invalid tool action in bindings.tools.${toolName}.action`,
      );
    }

    const action = context.services.actions.get(
      actionName.trim() as ActionName,
    );

    return {
      // The def description tells the model what this particular tool
      // instance covers; the action description is the generic fallback.
      description: toolDefinition.description?.trim() || action.description,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      execute: async (input, options) =>
        action.run(
          input,
          context,
          toolDefinition.settings as any,
          toolDefinition.bindings as RuntimeBindings | undefined,
          options?.abortSignal ?? signal,
        ),
    } as ToolSet[string];
  }

  protected normalizeUsage(usage?: LanguageModelUsage) {
    if (!usage) {
      return undefined;
    }

    const inputDetails = usage.inputTokenDetails;
    const outputDetails = usage.outputTokenDetails;

    return {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      reasoning_tokens: usage.reasoningTokens ?? outputDetails?.reasoningTokens,
      cached_input_tokens:
        usage.cachedInputTokens ?? inputDetails?.cacheReadTokens,
      input_token_details: unlessAllUndefined({
        no_cache_tokens: inputDetails?.noCacheTokens,
        cache_read_tokens: inputDetails?.cacheReadTokens,
        cache_write_tokens: inputDetails?.cacheWriteTokens,
      }),
      output_token_details: unlessAllUndefined({
        text_tokens: outputDetails?.textTokens,
        reasoning_tokens: outputDetails?.reasoningTokens,
      }),
      raw: usage.raw,
    };
  }

  protected extractReasoning(result: {
    reasoningText?: string;
    reasoning?: ReadonlyArray<{ text: string }>;
  }): string | undefined {
    return (
      result.reasoningText ??
      (result.reasoning?.length
        ? result.reasoning.map((part) => part.text).join('\n')
        : undefined)
    );
  }

  protected buildStopWhen(
    settings: Partial<{
      stop_step_count: number;
      stop_tool_call: string;
    }>,
    tools?: Record<string, unknown>,
    system?: string,
  ): {
    stopWhen:
      | ReturnType<typeof stepCountIs>
      | ReturnType<typeof hasToolCall>
      | Array<ReturnType<typeof stepCountIs> | ReturnType<typeof hasToolCall>>
      | undefined;
    prepareStep?: PrepareStepFunction<ToolSet>;
    stepCount?: number;
    toolCall?: string;
  } {
    const stopConditions: Array<
      ReturnType<typeof stepCountIs> | ReturnType<typeof hasToolCall>
    > = [];
    // Without tools the model answers in a single step, so no limit applies
    // unless the settings ask for one.
    const defaultStepCount = tools ? DEFAULT_AI_STOP_STEP_COUNT : 0;
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
    // The last step is reserved for the answer. A single step keeps its tools:
    // it is how a workflow has the model pick one tool and stop.
    const prepareStep: PrepareStepFunction<ToolSet> | undefined =
      tools && resolvedStepCount > 1
        ? ({ stepNumber }) =>
            stepNumber === resolvedStepCount - 1
              ? {
                  system: [system, AI_LAST_STEP_INSTRUCTION]
                    .filter(Boolean)
                    .join('\n\n'),
                }
              : {}
        : undefined;

    return {
      stopWhen,
      prepareStep,
      stepCount: resolvedStepCount > 0 ? resolvedStepCount : undefined,
      toolCall: stopToolCall || undefined,
    };
  }

  protected isStepLimitReached(
    result: StepLimitResult,
    limit: { stepCount?: number; toolCall?: string },
  ): boolean {
    if (
      result.finishReason !== 'tool-calls' ||
      limit.stepCount === undefined ||
      result.steps.length < limit.stepCount
    ) {
      return false;
    }

    // `stop_tool_call` ending the run on its tool is not the limit.
    const lastToolCalls = result.steps[result.steps.length - 1]?.toolCalls;

    return !lastToolCalls?.some(({ toolName }) => toolName === limit.toolCall);
  }
}

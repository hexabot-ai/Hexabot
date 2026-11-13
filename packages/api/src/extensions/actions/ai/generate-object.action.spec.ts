/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JSONSchema7, Output, generateText, jsonSchema } from 'ai';

import { ActionService } from '@/actions/actions.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { AiGenerateObjectAction } from './generate-object.action';

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

describe('AiGenerateObjectAction', () => {
  let action: AiGenerateObjectAction;
  let actionService: ActionService;
  const generateTextMock = generateText as jest.MockedFunction<
    typeof generateText
  >;
  const jsonSchemaMock = jsonSchema as jest.MockedFunction<typeof jsonSchema>;
  const outputObjectMock = Output.object as jest.MockedFunction<
    typeof Output.object
  >;
  const logger = { debug: jest.fn(), warn: jest.fn() };
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
    action = new AiGenerateObjectAction(actionService);
  });

  it('uses output schema settings to request structured output', async () => {
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
      output: { foo: 'bar' },
      reasoningText: 'step-by-step',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        inputTokenDetails: {
          noCacheTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
        },
        outputTokens: 20,
        totalTokens: 30,
        outputTokenDetails: {
          textTokens: 18,
          reasoningTokens: 2,
        },
        raw: { billable_units: 99 },
      },
      request: { foo: 'req' },
      response: { status: 200 },
      providerMetadata: { latency: 123 },
      warnings: ['warn'],
    } as any);

    const schemaDefinition = {
      title: 'TestObject',
      description: 'A simple test schema',
      type: 'object',
      properties: {
        foo: { type: 'string' },
      },
      required: ['foo'],
    } satisfies JSONSchema7;
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
      output_schema: schemaDefinition,
    };
    const input = {
      prompt: 'Generate an object',
      system: 'system prompt',
    };
    const context = createContext();
    const result = await action.execute({
      input,
      settings,
      context,
      bindings: createModelBindings(),
    });

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
    expect(jsonSchemaMock).toHaveBeenCalledWith(schemaDefinition);
    expect(outputObjectMock).toHaveBeenCalledWith({
      schema: { wrapped: schemaDefinition },
      name: 'TestObject',
      description: 'A simple test schema',
    });

    const callArgs = generateTextMock.mock.calls[0][0] as any;

    expect(callArgs).toMatchObject({
      prompt: 'Generate an object',
      system: 'system prompt',
      temperature: 0.7,
      topP: 0.8,
      topK: 5,
      presencePenalty: 0.1,
      frequencyPenalty: -0.2,
      maxOutputTokens: 50,
      seed: 7,
      model: 'model-instance',
      output: {
        schema: { wrapped: schemaDefinition },
        name: 'TestObject',
        description: 'A simple test schema',
        type: 'object',
      },
    });
    expect(callArgs.stopSequences).toBeUndefined();

    expect(result).toEqual({
      text: 'Generated text',
      object: { foo: 'bar' },
      reasoning: 'step-by-step',
      finish_reason: 'stop',
      step_limit_reached: false,
      model: 'gpt-4o-mini',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        reasoning_tokens: 2,
        cached_input_tokens: 3,
        input_token_details: {
          no_cache_tokens: 7,
          cache_read_tokens: 3,
          cache_write_tokens: 1,
        },
        output_token_details: {
          text_tokens: 18,
          reasoning_tokens: 2,
        },
        raw: { billable_units: 99 },
      },
      raw: {
        request: { foo: 'req' },
        response: { status: 200 },
        provider_metadata: { latency: 123 },
        warnings: ['warn'],
      },
    });
  });

  describe('when the model produced no object', () => {
    const noOutput = new Error('No output generated.');
    const run = (
      settings: Record<string, unknown>,
      result: Record<string, unknown>,
    ) => {
      const provider = Object.assign(
        jest.fn().mockReturnValue('model-instance'),
        { languageModel: jest.fn() },
      );
      const context = createContext({
        actions: {
          get: jest.fn().mockReturnValue({
            description: 'demo',
            inputSchema: {},
            outputSchema: {},
            run: jest.fn(),
          }),
        },
      });

      jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);
      generateTextMock.mockResolvedValue({
        text: '',
        get output() {
          throw noOutput;
        },
        ...result,
      } as any);

      return action.execute({
        input: { prompt: 'Generate an object' },
        settings: {
          timeout_ms: 0,
          retries: defaultRetries,
          output_schema: { type: 'object' },
          ...settings,
        } as any,
        context,
        bindings: {
          ...createModelBindings(),
          tools: { search: { action: 'search_action' } },
        },
      });
    };
    const searchStep = { toolCalls: [{ toolName: 'search' }] };

    it('names the step limit when it ended the run on a tool call', async () => {
      const execution = run(
        { stop_step_count: 2 },
        { finishReason: 'tool-calls', steps: [searchStep, searchStep] },
      );

      await expect(execution).rejects.toThrow(
        'The model reached the step limit (2) before generating the object. Raise the "stop_step_count" setting of the ai_generate_object action.',
      );
      await expect(execution).rejects.toHaveProperty('cause', noOutput);
    });

    it('rethrows the error of the AI SDK otherwise', async () => {
      await expect(
        run({}, { finishReason: 'length', steps: [searchStep] }),
      ).rejects.toBe(noOutput);
    });
  });

  it('throws when the model binding is missing', async () => {
    await expect(
      action.execute({
        input: { prompt: 'hi' },
        settings: {
          timeout_ms: 0,
          retries: defaultRetries,
          output_schema: { type: 'object' },
        } as any,
        context: createContext(),
        bindings: {},
      }),
    ).rejects.toThrow('A model is required to run ai_generate_object.');
  });

  it('throws when the model id is missing', async () => {
    await expect(
      action.execute({
        input: { prompt: 'hi' },
        settings: {
          timeout_ms: 0,
          retries: defaultRetries,
          output_schema: { type: 'object' },
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
    ).rejects.toThrow('A model is required to run ai_generate_object.');
  });
});

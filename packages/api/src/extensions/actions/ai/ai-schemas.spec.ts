/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BaseSettingsSchema } from '@hexabot-ai/agentic';

import {
  DEFAULT_AI_MESSAGES_LIMIT,
  DEFAULT_AI_OBJECT_SYSTEM_PROMPT,
  DEFAULT_AI_PROMPT,
  DEFAULT_AI_SYSTEM_PROMPT,
  DEFAULT_AI_STEP_BUDGET,
  MAX_AI_STEP_BUDGET,
  aiAgentInputSchema,
  aiGenerateObjectInputSchema,
  aiGenerateObjectSettingsSchema,
  aiGenerateReplyInputSchema,
  aiGenerateReplySettingsSchema,
  aiGenerateTextInputSchema,
  aiGenerateTextSettingsSchema,
  aiInferObjectInputSchema,
  aiInferObjectSettingsSchema,
  aiPromptSchema,
} from './ai-schemas';
import { aiModelBindingSchema } from './model.binding';

describe('ai prompt schemas', () => {
  it('accepts prompt mode with prompt text', () => {
    const result = aiPromptSchema.safeParse({
      input_mode: 'prompt',
      prompt: 'Tell me a joke',
      system: 'You are a helpful assistant.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts history mode with a positive messages limit', () => {
    const result = aiPromptSchema.safeParse({
      input_mode: 'history',
      messages_limit: 5,
      system: 'You are a helpful assistant.',
    });

    expect(result.success).toBe(true);
  });

  it('defaults prompt mode prompt to workflow input text', () => {
    const result = aiPromptSchema.safeParse({
      input_mode: 'prompt',
    });

    expect(result.success).toBe(true);
    expect(result.data?.prompt).toBe(DEFAULT_AI_PROMPT);
  });

  it('defaults missing input mode to prompt', () => {
    const result = aiPromptSchema.safeParse({
      prompt: 'Hello',
    });

    expect(result.success).toBe(true);
    expect(result.data?.input_mode).toBe('prompt');
  });

  it('defaults history mode messages_limit to 4 when missing', () => {
    const result = aiPromptSchema.safeParse({
      input_mode: 'history',
      system: 'You are a helpful assistant.',
    });

    expect(result.success).toBe(true);
    expect(result.data?.messages_limit).toBe(DEFAULT_AI_MESSAGES_LIMIT);
  });

  it('accepts prompt mode even when messages_limit is provided', () => {
    const result = aiPromptSchema.safeParse({
      input_mode: 'prompt',
      prompt: 'Tell me a joke',
      messages_limit: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data?.messages_limit).toBe(2);
  });

  it('keeps ai_generate_reply and ai_agent input schemas aligned', () => {
    const promptInput = {
      input_mode: 'prompt',
    };
    const historyInput = {
      input_mode: 'history',
    };

    expect(aiGenerateReplyInputSchema.safeParse(promptInput).success).toBe(
      true,
    );
    expect(aiAgentInputSchema.safeParse(historyInput).success).toBe(true);
    expect(aiGenerateReplyInputSchema.parse(promptInput).prompt).toBe(
      DEFAULT_AI_PROMPT,
    );
    expect(aiAgentInputSchema.parse(historyInput).messages_limit).toBe(
      DEFAULT_AI_MESSAGES_LIMIT,
    );
  });

  it('keeps ai_infer_object and ai_agent input schemas aligned', () => {
    const historyInput = {
      input_mode: 'history',
    };

    expect(aiInferObjectInputSchema.safeParse(historyInput).success).toBe(true);
    expect(aiAgentInputSchema.safeParse(historyInput).success).toBe(true);
    expect(aiInferObjectInputSchema.parse(historyInput).messages_limit).toBe(
      DEFAULT_AI_MESSAGES_LIMIT,
    );
  });
});

describe('structured output system prompts', () => {
  it.each([
    ['ai_infer_object', aiInferObjectInputSchema],
    ['ai_generate_object', aiGenerateObjectInputSchema],
  ])('defaults %s system to the structured output prompt', (_name, schema) => {
    const system = schema.parse({}).system;

    expect(system).toBe(DEFAULT_AI_OBJECT_SYSTEM_PROMPT);
    expect(system).not.toBe(DEFAULT_AI_SYSTEM_PROMPT);
  });

  it('keeps the conversational default for text-producing actions', () => {
    expect(aiGenerateReplyInputSchema.parse({}).system).toBe(
      DEFAULT_AI_SYSTEM_PROMPT,
    );
    expect(aiGenerateTextInputSchema.parse({}).system).toBe(
      DEFAULT_AI_SYSTEM_PROMPT,
    );
  });

  it('keeps a user-provided system prompt', () => {
    const system = 'Extract only the invoice total.';

    expect(aiInferObjectInputSchema.parse({ system }).system).toBe(system);
  });
});

describe('ai_generate_text input schema', () => {
  it('accepts prompt and system fields', () => {
    const result = aiGenerateTextInputSchema.safeParse({
      prompt: 'Write a haiku about spring.',
      system: 'You are a helpful assistant.',
    });

    expect(result.success).toBe(true);
  });

  it('defaults prompt to workflow input text', () => {
    const result = aiGenerateTextInputSchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data?.prompt).toBe(DEFAULT_AI_PROMPT);
  });

  it('rejects history-specific fields', () => {
    const result = aiGenerateTextInputSchema.safeParse({
      input_mode: 'history',
      messages_limit: 3,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });
});

describe('ai generation settings schemas', () => {
  const commonSettings = {};

  it('enforces the AI step budget ceiling', () => {
    const jsonSchema = BaseSettingsSchema.toJSONSchema({
      target: 'draft-07',
    }) as {
      properties?: Record<string, Record<string, unknown>>;
    };

    expect(
      BaseSettingsSchema.safeParse({
        stop_step_count: DEFAULT_AI_STEP_BUDGET,
      }).success,
    ).toBe(true);
    expect(
      BaseSettingsSchema.safeParse({
        stop_step_count: MAX_AI_STEP_BUDGET,
      }).success,
    ).toBe(true);
    expect(
      BaseSettingsSchema.safeParse({
        stop_step_count: MAX_AI_STEP_BUDGET + 1,
      }).success,
    ).toBe(false);
    expect(BaseSettingsSchema.parse({})).not.toHaveProperty('stop_step_count');
    expect(jsonSchema.properties?.stop_step_count?.default).toBe(
      DEFAULT_AI_STEP_BUDGET,
    );
  });

  it('rejects output_schema for ai_generate_text settings', () => {
    const result = aiGenerateTextSettingsSchema.safeParse({
      ...commonSettings,
      output_schema: { type: 'object' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });

  it('rejects output_schema for ai_generate_reply settings', () => {
    const result = aiGenerateReplySettingsSchema.safeParse({
      ...commonSettings,
      output_schema: { type: 'object' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });

  it('requires output_schema for ai_generate_object settings', () => {
    const result = aiGenerateObjectSettingsSchema.safeParse(commonSettings);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['output_schema'] }),
    );
  });

  it('requires output_schema for ai_infer_object settings', () => {
    const result = aiInferObjectSettingsSchema.safeParse(commonSettings);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['output_schema'] }),
    );
  });
});

describe('ai model binding schema', () => {
  it('defaults provider and model when missing', () => {
    const result = aiModelBindingSchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data?.provider).toBe('openai');
    expect(result.data?.model_id).toBe('gpt-5.2');
  });

  it('rejects empty model names', () => {
    const result = aiModelBindingSchema.safeParse({
      provider: 'openai',
      model_id: '',
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path[0] === 'model_id'),
    ).toBe(true);
  });
});

describe('legacy provider/model settings rejection', () => {
  const legacyModelFields = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    api_key: 'credential-id',
    base_url: 'https://api.openai.com',
    organization: 'org-1',
  };

  it('rejects legacy model fields in ai_generate_text settings', () => {
    const result = aiGenerateTextSettingsSchema.safeParse(legacyModelFields);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });

  it('rejects legacy model fields in ai_generate_reply settings', () => {
    const result = aiGenerateReplySettingsSchema.safeParse(legacyModelFields);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });

  it('rejects legacy model fields in ai_generate_object settings', () => {
    const result = aiGenerateObjectSettingsSchema.safeParse({
      ...legacyModelFields,
      output_schema: { type: 'object' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });

  it('rejects legacy model fields in ai_infer_object settings', () => {
    const result = aiInferObjectSettingsSchema.safeParse({
      ...legacyModelFields,
      output_schema: { type: 'object' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });
});

describe('legacy memory settings rejection', () => {
  it('rejects memory_enabled in ai_generate_text settings', () => {
    const result = aiGenerateTextSettingsSchema.safeParse({
      memory_enabled: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys' }),
    );
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { AiAgentAction } from './agent.action';
import { AI_LAST_STEP_INSTRUCTION, AiBaseAction } from './ai-base.action';
import { AiGenerateObjectAction } from './generate-object.action';
import { AiGenerateTextAction } from './generate-text.action';

/**
 * These tests run the tool loop of the AI SDK itself, with a scripted model, to
 * check what the step limit does to a whole run.
 */
describe('AI actions step limit', () => {
  const usage = {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  const searchAgain = (): LanguageModelV3GenerateResult => ({
    content: [
      {
        type: 'tool-call',
        toolCallId: `call-${Math.random()}`,
        toolName: 'search',
        input: JSON.stringify({ query: 'opening hours' }),
      },
    ],
    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
    usage,
    warnings: [],
  });
  const answer = (text: string): LanguageModelV3GenerateResult => ({
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'end_turn' },
    usage,
    warnings: [],
  });
  const systemOf = (options: LanguageModelV3CallOptions) =>
    options.prompt
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
  const isAskedToAnswer = (options: LanguageModelV3CallOptions) =>
    systemOf(options).includes(AI_LAST_STEP_INSTRUCTION);
  /** Searches until it is told to answer. */
  const obedientModel = (finalText = 'We open at 9.') =>
    new MockLanguageModelV3({
      doGenerate: async (options) =>
        isAskedToAnswer(options) ? answer(finalText) : searchAgain(),
    });
  /** Searches whatever it is told. */
  const stubbornModel = () =>
    new MockLanguageModelV3({ doGenerate: async () => searchAgain() });
  /** Searches a given number of times, then answers. */
  const searchingModel = (searches: number, finalText = 'We open at 9.') => {
    const model: MockLanguageModelV3 = new MockLanguageModelV3({
      doGenerate: async () =>
        model.doGenerateCalls.length <= searches
          ? searchAgain()
          : answer(finalText),
    });

    return model;
  };
  const logger = { debug: jest.fn(), warn: jest.fn() };
  const searchRun = jest.fn();
  const context = {
    services: {
      logger,
      credentials: { findOneValue: jest.fn().mockResolvedValue('test-key') },
      actions: {
        get: jest.fn().mockReturnValue({
          description: 'Searches the knowledge base.',
          inputSchema: z.object({ query: z.string() }),
          outputSchema: z.object({ hits: z.array(z.string()) }),
          run: searchRun,
        }),
      },
    },
  } as unknown as WorkflowRuntimeContext;
  const bindings: any = {
    model: {
      settings: { provider: 'openai', model_id: 'scripted', api_key: 'key' },
    },
    tools: { search: { action: 'retrieve_rag_content' } },
  };
  const baseSettings = {
    timeout_ms: 0,
    retries: {
      max_attempts: 1,
      backoff_ms: 0,
      max_delay_ms: 0,
      jitter: 0,
      multiplier: 1,
    },
  };
  const useModel = <A extends AiBaseAction<any, any>>(
    action: A,
    model: MockLanguageModelV3,
  ): A => {
    jest.spyOn(action as any, 'loadProvider').mockResolvedValue({});
    jest.spyOn(action as any, 'createModel').mockReturnValue(model);

    return action;
  };
  const actionService = { register: jest.fn() } as unknown as ActionService;
  const runAgent = (
    model: MockLanguageModelV3,
    settings: Record<string, unknown> = {},
  ) =>
    useModel(new AiAgentAction(actionService), model).execute({
      input: {
        input_mode: 'prompt',
        prompt: 'When do you open?',
        system: 'Be brief.',
      },
      settings: { ...baseSettings, ...settings },
      context,
      bindings,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    searchRun.mockResolvedValue({ hits: ['Open from 9 to 5.'] });
  });

  describe('ai_agent', () => {
    it('lets a single tool be called again before the answer', async () => {
      const model = searchingModel(2);
      const result = await runAgent(model);

      expect(model.doGenerateCalls).toHaveLength(3);
      expect(searchRun).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        text: 'We open at 9.',
        finish_reason: 'stop',
        step_limit_reached: false,
      });
    });

    it('asks for the answer on the tenth step by default', async () => {
      const model = obedientModel();
      const result = await runAgent(model);
      const calls = model.doGenerateCalls;

      expect(calls).toHaveLength(10);
      expect(calls.slice(0, 9).some(isAskedToAnswer)).toBe(false);
      expect(systemOf(calls[9])).toBe(
        `Be brief.\n\n${AI_LAST_STEP_INSTRUCTION}`,
      );
      expect(searchRun).toHaveBeenCalledTimes(9);
      expect(result).toMatchObject({
        text: 'We open at 9.',
        finish_reason: 'stop',
        step_limit_reached: false,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('keeps the tools and their results in the last step', async () => {
      const model = obedientModel();

      await runAgent(model, { stop_step_count: 2 });
      const [first, last] = model.doGenerateCalls;

      expect(model.doGenerateCalls).toHaveLength(2);
      expect(isAskedToAnswer(first)).toBe(false);
      expect(isAskedToAnswer(last)).toBe(true);
      expect(last.tools?.map((tool) => tool.name)).toEqual(['search']);
      expect(last.toolChoice).toEqual(first.toolChoice);
      expect(JSON.stringify(last.prompt)).toContain('Open from 9 to 5.');
    });

    it('reports a model that still calls a tool on the last step', async () => {
      const result = await runAgent(stubbornModel(), { stop_step_count: 3 });

      expect(searchRun).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({
        text: '',
        finish_reason: 'tool-calls',
        step_limit_reached: true,
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('runs a single step with its tools', async () => {
      const model = obedientModel();
      const result = await runAgent(model, { stop_step_count: 1 });

      expect(model.doGenerateCalls).toHaveLength(1);
      expect(isAskedToAnswer(model.doGenerateCalls[0])).toBe(false);
      expect(searchRun).toHaveBeenCalledTimes(1);
      expect(result.tool_results).toHaveLength(1);
      expect(result.step_limit_reached).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not report a run its stop tool ended', async () => {
      const result = await runAgent(stubbornModel(), {
        stop_step_count: 3,
        stop_tool_call: 'search',
      });

      expect(searchRun).toHaveBeenCalledTimes(1);
      expect(result.step_limit_reached).toBe(false);
    });
  });

  describe('ai_generate_text', () => {
    it('answers on the last step', async () => {
      const model = obedientModel();
      const result = await useModel(
        new AiGenerateTextAction(actionService),
        model,
      ).execute({
        input: { prompt: 'When do you open?' },
        settings: { ...baseSettings, stop_step_count: 2 },
        context,
        bindings,
      });

      expect(model.doGenerateCalls).toHaveLength(2);
      expect(result).toMatchObject({
        text: 'We open at 9.',
        finish_reason: 'stop',
        step_limit_reached: false,
      });
    });
  });

  describe('ai_generate_object', () => {
    const runObject = (model: MockLanguageModelV3) =>
      useModel(new AiGenerateObjectAction(actionService), model).execute({
        input: { prompt: 'When do you open?' },
        settings: {
          ...baseSettings,
          stop_step_count: 2,
          output_schema: {
            type: 'object',
            properties: { opens_at: { type: 'string' } },
            required: ['opens_at'],
          },
        },
        context,
        bindings,
      });

    it('generates the object on the last step', async () => {
      const result = await runObject(obedientModel('{"opens_at":"9"}'));

      expect(result).toMatchObject({
        object: { opens_at: '9' },
        step_limit_reached: false,
      });
    });

    it('names the step limit when the model never answers', async () => {
      await expect(runObject(stubbornModel())).rejects.toThrow(
        'The model reached the step limit (2) before generating the object.',
      );
    });
  });
});

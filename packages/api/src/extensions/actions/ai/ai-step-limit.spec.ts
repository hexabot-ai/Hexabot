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
import { AiBaseAction } from './ai-base.action';
import { AI_FINAL_STEP_INSTRUCTION } from './ai-final-step';
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
  /** The text of the message that closes the conversation, when the user wrote it. */
  const closingUserText = (options: LanguageModelV3CallOptions) => {
    const last = options.prompt[options.prompt.length - 1];

    return last?.role === 'user'
      ? last.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('\n')
      : '';
  };
  const isAskedToAnswer = (options: LanguageModelV3CallOptions) =>
    closingUserText(options).includes(AI_FINAL_STEP_INSTRUCTION);
  /** Searches as long as it has tools, like a model that never has enough. */
  const searchingWhileItCan = (finalText = 'We open at 9.') =>
    new MockLanguageModelV3({
      doGenerate: async (options) =>
        options.tools?.length ? searchAgain() : answer(finalText),
    });
  /**
   * Calls the search tool even on a step that does not declare it. No provider
   * returns such a call; it stands for a run that ends without an answer.
   */
  const scriptedToAlwaysSearch = () =>
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

    it('has the model answer on the tenth step by default', async () => {
      const model = searchingWhileItCan();
      const result = await runAgent(model);
      const calls = model.doGenerateCalls;

      expect(calls).toHaveLength(10);
      expect(calls.slice(0, 9).some(isAskedToAnswer)).toBe(false);
      expect(isAskedToAnswer(calls[9])).toBe(true);
      expect(calls.map(systemOf)).toEqual(new Array(10).fill('Be brief.'));
      expect(searchRun).toHaveBeenCalledTimes(9);
      expect(result).toMatchObject({
        text: 'We open at 9.',
        finish_reason: 'stop',
        step_limit_reached: true,
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Model "scripted" used every step of the ai_agent action and answered on the last one without tools',
        { step_count: 10 },
      );
    });

    it('gives the last step no tools, and the results of the run as text', async () => {
      const model = searchingWhileItCan();
      const result = await runAgent(model, { stop_step_count: 2 });
      const [first, last] = model.doGenerateCalls;

      expect(model.doGenerateCalls).toHaveLength(2);
      expect(first.tools?.map((tool) => tool.name)).toEqual(['search']);
      expect(isAskedToAnswer(first)).toBe(false);
      expect(last.tools ?? []).toEqual([]);
      expect(last.prompt.map(({ role }) => role)).toEqual([
        'system',
        'user',
        'user',
      ]);
      expect(JSON.stringify(last.prompt)).not.toMatch(/tool-call|tool-result/);
      expect(closingUserText(last)).toContain(
        '<input>{"query":"opening hours"}</input>',
      );
      expect(closingUserText(last)).toContain(
        '<output>{"hits":["Open from 9 to 5."]}</output>',
      );
      expect(isAskedToAnswer(last)).toBe(true);
      // The tools only ran on the step that had them.
      expect(searchRun).toHaveBeenCalledTimes(1);
      // The run itself keeps its tool calls and results as they were made.
      expect(
        (result.raw.response as any).messages.map(({ role }) => role),
      ).toEqual(['assistant', 'tool', 'assistant']);
      expect(result.tool_results).toHaveLength(1);
    });

    it('adds the last step instructions to the last step only', async () => {
      const model = searchingWhileItCan();

      await runAgent(model, {
        stop_step_count: 2,
        last_step_instructions: 'Offer a callback.',
      });
      const [first, last] = model.doGenerateCalls;

      expect(closingUserText(last)).toMatch(/Open from 9 to 5\./);
      expect(
        closingUserText(last).endsWith(
          `${AI_FINAL_STEP_INSTRUCTION}\n\nOffer a callback.`,
        ),
      ).toBe(true);
      expect(JSON.stringify(first.prompt)).not.toContain('Offer a callback.');
      expect([first, last].map(systemOf)).toEqual(['Be brief.', 'Be brief.']);
    });

    it('reports a run that still ends on a tool call', async () => {
      const result = await runAgent(scriptedToAlwaysSearch(), {
        stop_step_count: 3,
      });

      expect(result).toMatchObject({
        text: '',
        finish_reason: 'tool-calls',
        step_limit_reached: true,
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Model "scripted" reached the step limit of the ai_agent action without a final answer',
        { step_count: 3 },
      );
    });

    it('runs a single step with its tools', async () => {
      const model = searchingWhileItCan();
      const result = await runAgent(model, { stop_step_count: 1 });

      expect(model.doGenerateCalls).toHaveLength(1);
      expect(isAskedToAnswer(model.doGenerateCalls[0])).toBe(false);
      expect(searchRun).toHaveBeenCalledTimes(1);
      expect(result.tool_results).toHaveLength(1);
      expect(result.step_limit_reached).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not report a run its stop tool ended', async () => {
      const result = await runAgent(scriptedToAlwaysSearch(), {
        stop_step_count: 3,
        stop_tool_call: 'search',
      });

      expect(searchRun).toHaveBeenCalledTimes(1);
      expect(result.step_limit_reached).toBe(false);
    });
  });

  describe('ai_generate_text', () => {
    it('answers on the last step', async () => {
      const model = searchingWhileItCan();
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
      expect(isAskedToAnswer(model.doGenerateCalls[1])).toBe(true);
      expect(result).toMatchObject({
        text: 'We open at 9.',
        finish_reason: 'stop',
        step_limit_reached: true,
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
      const model = searchingWhileItCan('{"opens_at":"9"}');
      const result = await runObject(model);
      const last = model.doGenerateCalls[1];

      expect(last.tools ?? []).toEqual([]);
      expect(last.responseFormat?.type).toBe('json');
      expect(isAskedToAnswer(last)).toBe(true);
      expect(result).toMatchObject({
        object: { opens_at: '9' },
        step_limit_reached: true,
      });
    });

    it('names the step limit when the run ends on a tool call', async () => {
      await expect(runObject(scriptedToAlwaysSearch())).rejects.toThrow(
        'The model reached the step limit (2) before generating the object.',
      );
    });
  });
});

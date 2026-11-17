/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ModelMessage } from 'ai';

import {
  AI_FINAL_STEP_INSTRUCTION,
  buildFinalStepMessages,
} from './ai-final-step';

describe('buildFinalStepMessages', () => {
  const HEADING = 'Results of the tools you called for this request:';
  const searchCall = (toolCallId: string, query: string) => ({
    type: 'tool-call' as const,
    toolCallId,
    toolName: 'search',
    input: { query },
  });
  const searchResult = (
    toolCallId: string,
    output: Record<string, unknown>,
  ): ModelMessage => ({
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId, toolName: 'search', output } as any,
    ],
  });
  const lastOf = (messages: ModelMessage[]) => messages[messages.length - 1];

  it('writes a tool call and its result as text in a closing user message', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'When do you open?' },
      { role: 'assistant', content: [searchCall('call-1', 'opening hours')] },
      searchResult('call-1', {
        type: 'json',
        value: { hits: ['Open from 9 to 5.'] },
      }),
    ];

    expect(buildFinalStepMessages(messages)).toEqual([
      { role: 'user', content: 'When do you open?' },
      {
        role: 'user',
        content: [
          HEADING,
          [
            '<tool_result tool="search">',
            '<input>{"query":"opening hours"}</input>',
            '<output>{"hits":["Open from 9 to 5."]}</output>',
            '</tool_result>',
          ].join('\n'),
          AI_FINAL_STEP_INSTRUCTION,
        ].join('\n\n'),
      },
    ]);
  });

  it('leaves no tool call, tool result, reasoning or provider option', () => {
    const rewritten = buildFinalStepMessages([
      { role: 'user', content: 'When do you open?' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should search.' },
          {
            type: 'text',
            text: 'Let me check.',
            providerOptions: { openai: { itemId: 'msg_1' } },
          },
          searchCall('call-1', 'opening hours'),
        ],
        providerOptions: { openai: { itemId: 'msg_1' } },
      },
      searchResult('call-1', { type: 'text', value: 'Open from 9 to 5.' }),
    ]);

    expect(rewritten[1]).toEqual({
      role: 'assistant',
      content: 'Let me check.',
    });
    expect(rewritten.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(rewritten.every(({ content }) => typeof content === 'string')).toBe(
      true,
    );
  });

  it('gathers the results of several rounds in one user message', () => {
    const rewritten = buildFinalStepMessages([
      { role: 'user', content: 'When do you open?' },
      { role: 'assistant', content: [searchCall('call-1', 'opening hours')] },
      searchResult('call-1', { type: 'text', value: 'No result.' }),
      { role: 'assistant', content: [searchCall('call-2', 'schedule')] },
      searchResult('call-2', { type: 'text', value: 'Open from 9 to 5.' }),
    ]);

    expect(rewritten).toHaveLength(2);
    expect(lastOf(rewritten).content).toBe(
      [
        HEADING,
        '<tool_result tool="search">\n<input>{"query":"opening hours"}</input>\n<output>No result.</output>\n</tool_result>',
        '<tool_result tool="search">\n<input>{"query":"schedule"}</input>\n<output>Open from 9 to 5.</output>\n</tool_result>',
        AI_FINAL_STEP_INSTRUCTION,
      ].join('\n\n'),
    );
  });

  it('keeps what the model wrote between two rounds in its place', () => {
    const rewritten = buildFinalStepMessages([
      { role: 'user', content: 'When do you open?' },
      { role: 'assistant', content: [searchCall('call-1', 'opening hours')] },
      searchResult('call-1', { type: 'text', value: 'No result.' }),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will search again.' },
          searchCall('call-2', 'schedule'),
        ],
      },
      searchResult('call-2', { type: 'text', value: 'Open from 9 to 5.' }),
    ]);

    expect(rewritten.map(({ role }) => role)).toEqual([
      'user',
      'user',
      'assistant',
      'user',
    ]);
    expect(rewritten[1].content).toContain('No result.');
    expect(rewritten[1].content).not.toContain(AI_FINAL_STEP_INSTRUCTION);
    expect(rewritten[2].content).toBe('I will search again.');
    expect(lastOf(rewritten).content).toContain('Open from 9 to 5.');
  });

  it.each([
    [{ type: 'error-text', value: 'Timed out' }, 'Error: Timed out'],
    [{ type: 'error-json', value: { code: 503 } }, 'Error: {"code":503}'],
    [
      { type: 'execution-denied', reason: 'Not allowed' },
      'The call was denied: Not allowed',
    ],
    [{ type: 'execution-denied' }, 'The call was denied.'],
    [
      {
        type: 'content',
        value: [
          { type: 'text', text: 'Map of the shop' },
          { type: 'image-data', data: 'AAAA', mediaType: 'image/png' },
          { type: 'file-url', url: 'https://example.com/hours.pdf' },
        ],
      },
      'Map of the shop\n[image-data not shown]\n[file-url: https://example.com/hours.pdf]',
    ],
  ])('writes the output %j as text', (output, expected) => {
    const rewritten = buildFinalStepMessages([
      { role: 'assistant', content: [searchCall('call-1', 'opening hours')] },
      searchResult('call-1', output),
    ]);

    expect(lastOf(rewritten).content).toContain(`<output>${expected}</output>`);
  });

  it('writes a result whose call is not in the conversation without an input', () => {
    const rewritten = buildFinalStepMessages([
      searchResult('call-9', { type: 'text', value: 'Open from 9 to 5.' }),
    ]);

    expect(lastOf(rewritten).content).toContain(
      '<tool_result tool="search">\n<output>Open from 9 to 5.</output>',
    );
  });

  it('passes messages without tool content through, and still closes on a user message', () => {
    const history: ModelMessage[] = [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi! How can I help?' },
    ];

    expect(buildFinalStepMessages(history)).toEqual([
      ...history,
      { role: 'user', content: AI_FINAL_STEP_INSTRUCTION },
    ]);
  });
});

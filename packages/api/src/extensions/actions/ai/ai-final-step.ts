/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ModelMessage, ToolResultPart } from 'ai';

/**
 * Closes the conversation of the last step an AI action may run. It is sent as
 * a user message, after the tool results: models follow the turn they just
 * received more than a sentence added to the system prompt.
 */
export const AI_FINAL_STEP_INSTRUCTION = [
  '[Automatic notice, not written by the user]',
  'You have used all the tool calls allowed for this request, and no tool is available any more.',
  'Write your final reply to the user now, using only the information above.',
  'If that information is not enough, say what is missing.',
  'Reply in the language you were using with the user, and do not mention this notice.',
].join(' ');

const TOOL_RESULTS_HEADING =
  'Results of the tools you called for this request:';
const toText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
const renderOutput = (output: ToolResultPart['output']): string => {
  switch (output.type) {
    case 'text':
      return output.value;
    case 'json':
      return toText(output.value);
    case 'error-text':
    case 'error-json':
      return `Error: ${toText(output.value)}`;
    case 'execution-denied':
      return output.reason
        ? `The call was denied: ${output.reason}`
        : 'The call was denied.';
    case 'content':
      return output.value
        .map((part) => {
          if (part.type === 'text') {
            return part.text;
          }

          return 'url' in part
            ? `[${part.type}: ${part.url}]`
            : `[${part.type} not shown]`;
        })
        .join('\n');
    default:
      return toText(output);
  }
};
/** Writes the tool results among `parts` as text, each with its call's input. */
const renderResults = (
  parts: ReadonlyArray<{ type: string }>,
  inputs: Map<string, unknown>,
): string[] =>
  parts
    .filter((part): part is ToolResultPart => part.type === 'tool-result')
    .map((part) =>
      [
        `<tool_result tool="${part.toolName}">`,
        ...(inputs.has(part.toolCallId)
          ? [`<input>${toText(inputs.get(part.toolCallId))}</input>`]
          : []),
        `<output>${renderOutput(part.output)}</output>`,
        '</tool_result>',
      ].join('\n'),
    );

/**
 * Rewrites the conversation of a tool loop for a last step that has no tools.
 *
 * Tool calls and their results become plain text in user messages, and the
 * conversation ends on the instruction to answer. Nothing the model retrieved
 * is lost, and no tool call or result is left: providers such as Bedrock refuse
 * them, or drop them, when a call declares no tools. Assistant messages keep
 * their text only, so the conversation never ends on an assistant turn, which
 * recent models refuse as a prefill.
 */
export function buildFinalStepMessages(
  messages: ModelMessage[],
): ModelMessage[] {
  const inputs = new Map<string, unknown>();
  const rewritten: ModelMessage[] = [];
  // Tool results waiting to be written as one user message.
  let pending: string[] = [];
  const flush = (closing?: string) => {
    const paragraphs = [
      ...(pending.length > 0 ? [TOOL_RESULTS_HEADING, ...pending] : []),
      ...(closing ? [closing] : []),
    ];

    if (paragraphs.length > 0) {
      rewritten.push({ role: 'user', content: paragraphs.join('\n\n') });
    }

    pending = [];
  };

  for (const message of messages) {
    if (message.role === 'tool') {
      pending.push(...renderResults(message.content, inputs));
    } else if (
      message.role === 'assistant' &&
      typeof message.content !== 'string'
    ) {
      const text = message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n')
        .trim();

      for (const part of message.content) {
        if (part.type === 'tool-call') {
          inputs.set(part.toolCallId, part.input);
        }
      }

      if (text) {
        flush();
        rewritten.push({ role: 'assistant', content: text });
      }

      // Results of the tools the provider ran itself come with the call.
      pending.push(...renderResults(message.content, inputs));
    } else {
      flush();
      rewritten.push(message);
    }
  }

  flush(AI_FINAL_STEP_INSTRUCTION);

  return rewritten;
}

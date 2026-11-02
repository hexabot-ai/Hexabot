/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const inputSchema = z.record(z.string(), z.any());
const outputSchema = z.looseObject({
  intent: z.string().optional(),
  confidence: z.number().optional(),
  summary: z.string().optional(),
  missing_fields: z.array(z.string()).optional(),
  needs_human: z.boolean().optional(),
  synthesis: z.string().optional(),
  questions: z.array(z.string()).optional(),
  message: z.string().optional(),
  links: z.array(z.string()).optional(),
  email: z.string().optional(),
  cta: z.string().optional(),
});
const settingsSchema = z.strictObject({
  model: z.string().optional(),
  temperature: z.number().optional(),
});

type CallLlmInput = z.infer<typeof inputSchema>;
type CallLlmOutput = z.infer<typeof outputSchema>;
type CallLlmSettings = z.infer<typeof settingsSchema>;

const asString = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return fallback;
};

export const callLlm = defineAction<
  CallLlmInput,
  CallLlmOutput,
  ExampleContext,
  CallLlmSettings
>({
  name: 'call_llm',
  description:
    'Mock LLM that returns deterministic data for the example workflow.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input }) => {
    if ('system_prompt' in input) {
      const query = asString(input.user_query, 'customer request');
      const normalized = query.toLowerCase();
      const intent =
        normalized.includes('buy') || normalized.includes('price')
          ? 'sales'
          : normalized.includes('support') ||
              normalized.includes('bug') ||
              normalized.includes('error')
            ? 'support'
            : 'research';

      return {
        intent,
        confidence: intent === 'support' ? 0.92 : 0.88,
        summary: query.slice(0, 120),
        missing_fields: [],
        needs_human: false,
      };
    }

    if (
      'news_snippets' in input ||
      'memory_summary' in input ||
      'meetings' in input
    ) {
      const intent = asString(input.intent, 'request');
      const profile = (input.profile as { company?: string }) ?? {};
      const company = asString(profile.company, 'the customer');

      return {
        synthesis: `Brief for ${company} (${intent}): combined recent context, meetings, and user clarification.`,
        questions: ['Any extra constraints or deadlines?'],
      };
    }

    if ('troubleshooting_guide' in input) {
      const question = asString(input.question, 'your issue');

      return {
        message: `Here is a support reply for ${question}.\n\n- Step 1: Restart.\n- Step 2: Apply guide specifics.`,
        links: ['https://example.com/faq/diagnostics'],
      };
    }

    if ('product_brief' in input) {
      const companyNews = Array.isArray(input.company_news)
        ? input.company_news
        : [];
      const lead =
        companyNews.length > 0
          ? companyNews[0]
          : 'We have great news to share.';

      return {
        email: `Thanks for your interest. ${lead}`,
        cta: 'Schedule a call this week.',
      };
    }

    if ('stakeholder' in input) {
      const stakeholder = input.stakeholder as { name?: string };
      const question = asString(input.question, 'the request');
      const name = asString(stakeholder?.name, 'Stakeholder');

      return {
        message: `${name}, quick update about ${question}. Research brief attached.`,
      };
    }

    const summary = asString(
      input.summary,
      'Here is a concise summary of your request.',
    );

    return { message: summary };
  },
});

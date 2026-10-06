/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const inputSchema = z.object({
  intent: z.string(),
  priority: z.string().optional(),
  confidence: z.number().optional(),
  needs_human: z.boolean().optional(),
});
const outputSchema = z.object({
  route: z.enum([
    'draft_support_reply',
    'craft_sales_pitch',
    'escalate_to_human',
    'send_generic_summary',
  ]),
  explanation: z.string(),
});
const settingsSchema = z.strictObject({
  branches: z
    .array(z.object({ when: z.string(), next: z.string() }))
    .optional(),
  default_next: z.string().optional(),
});

type DecisionRouterInput = z.infer<typeof inputSchema>;
type DecisionRouterOutput = z.infer<typeof outputSchema>;
type DecisionRouterSettings = z.infer<typeof settingsSchema>;

export const decisionRouter = defineAction<
  DecisionRouterInput,
  DecisionRouterOutput,
  ExampleContext,
  DecisionRouterSettings
>({
  name: 'decision_router',
  description: 'Routes work based on intent, priority, and confidence.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input, context }) => {
    const confidence = input.confidence ?? 0;

    if (input.needs_human) {
      return {
        route: 'escalate_to_human',
        explanation: 'User requested human help.',
      };
    }

    if (input.intent === 'support' && confidence > 0.6) {
      return {
        route: 'draft_support_reply',
        explanation: 'Confident support intent.',
      };
    }

    if (input.intent === 'sales') {
      return {
        route: 'craft_sales_pitch',
        explanation: 'Sales intent detected.',
      };
    }

    if (input.priority === 'high') {
      return {
        route: 'escalate_to_human',
        explanation: 'High priority requires escalation.',
      };
    }

    context.log('Falling back to generic summary');

    return {
      route: 'send_generic_summary',
      explanation: 'No specific branch matched.',
    };
  },
});

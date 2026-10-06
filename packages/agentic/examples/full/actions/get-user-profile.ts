/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const stakeholderSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.string(),
});
const inputSchema = z.object({
  user_id: z.string(),
  include_history: z.boolean().optional(),
});
const outputSchema = z.object({
  profile: z.object({
    id: z.string(),
    name: z.string(),
    company: z.string(),
    persona: z.string(),
    stakeholders: z.array(stakeholderSchema),
  }),
  recent_cases: z.array(z.object({ id: z.string(), subject: z.string() })),
});
const settingsSchema = z.strictObject({});

type GetUserProfileInput = z.infer<typeof inputSchema>;
type GetUserProfileOutput = z.infer<typeof outputSchema>;
type GetUserProfileSettings = z.infer<typeof settingsSchema>;

export const getUserProfile = defineAction<
  GetUserProfileInput,
  GetUserProfileOutput,
  ExampleContext,
  GetUserProfileSettings
>({
  name: 'get_user_profile',
  description:
    'Returns a mocked CRM profile with a couple of stakeholders and prior cases.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input, context }) => {
    const profile = {
      id: input.user_id,
      name: 'Ada Lovelace',
      company: 'Analytical Engines Inc.',
      persona: 'CTO',
      stakeholders: [
        { name: 'Mia Ops', email: 'mia.ops@example.com', role: 'operations' },
        { name: 'Cal CTO', email: 'cal.cto@example.com', role: 'technology' },
      ],
    };
    const recent_cases = input.include_history
      ? [
          { id: 'case-100', subject: 'Renewal follow-up' },
          { id: 'case-101', subject: 'Product feedback' },
        ]
      : [];

    context.log('Fetched profile', { user_id: input.user_id });

    return { profile, recent_cases };
  },
});

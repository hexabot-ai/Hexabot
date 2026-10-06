/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const inputSchema = z.object({
  user_email: z.string(),
  range: z.string().optional(),
});
const outputSchema = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      when: z.string(),
    }),
  ),
});
const settingsSchema = z.strictObject({});

type GetCalendarEventsInput = z.infer<typeof inputSchema>;
type GetCalendarEventsOutput = z.infer<typeof outputSchema>;
type GetCalendarEventsSettings = z.infer<typeof settingsSchema>;

export const getCalendarEvents = defineAction<
  GetCalendarEventsInput,
  GetCalendarEventsOutput,
  ExampleContext,
  GetCalendarEventsSettings
>({
  name: 'get_calendar_events',
  description: 'Provides a short list of upcoming meetings.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input, context }) => {
    context.log('Pulling calendar events', {
      user_email: input.user_email,
      range: input.range,
    });

    return {
      events: [
        { title: 'Product sync', when: 'Tomorrow 10:00' },
        { title: 'Stakeholder update', when: 'Friday 14:00' },
      ],
    };
  },
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const inputSchema = z.object({
  to: z.string(),
  subject: z.string(),
  body: z.unknown(),
  track_opens: z.boolean().optional(),
});
const outputSchema = z.object({
  status: z.string(),
  acknowledged: z.boolean().optional(),
});
const settingsSchema = z.strictObject({
  track_opens: z.boolean().optional(),
});

type SendEmailInput = z.infer<typeof inputSchema>;
type SendEmailOutput = z.infer<typeof outputSchema>;
type SendEmailSettings = z.infer<typeof settingsSchema>;

export const sendEmail = defineAction<
  SendEmailInput,
  SendEmailOutput,
  ExampleContext,
  SendEmailSettings
>({
  name: 'send_email',
  description:
    'Pretends to send an email and optionally marks acknowledgement.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input, context }) => {
    const acknowledged =
      input.subject.toLowerCase().includes('fyi') &&
      input.to.toLowerCase().includes('ops');

    context.log('Sent email', { to: input.to, subject: input.subject });

    return { status: 'sent', acknowledged };
  },
});

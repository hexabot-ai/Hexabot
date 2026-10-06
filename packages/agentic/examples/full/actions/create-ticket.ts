/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const inputSchema = z.object({
  user_id: z.string(),
  transcript: z.unknown().optional(),
  summary: z.string().optional(),
  clarification: z.string().optional(),
});
const outputSchema = z.object({
  ticket_id: z.string(),
  status: z.string(),
});
const settingsSchema = z.strictObject({});

type CreateTicketInput = z.infer<typeof inputSchema>;
type CreateTicketOutput = z.infer<typeof outputSchema>;
type CreateTicketSettings = z.infer<typeof settingsSchema>;

export const createTicket = defineAction<
  CreateTicketInput,
  CreateTicketOutput,
  ExampleContext,
  CreateTicketSettings
>({
  name: 'create_ticket',
  description: 'Mocks creating a support ticket with the supplied context.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input, context }) => {
    const ticket_id = `tkt-${input.user_id}-${Date.now()}`;
    context.log('Created ticket', { ticket_id, summary: input.summary });

    return { ticket_id, status: 'open' };
  },
});

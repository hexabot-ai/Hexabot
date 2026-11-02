/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const inputSchema = z.object({
  thread_id: z.string().optional(),
  user_id: z.string().optional(),
});
const outputSchema = z.object({
  summary: z.string(),
});
const settingsSchema = z.strictObject({});

type QueryMemoryInput = z.infer<typeof inputSchema>;
type QueryMemoryOutput = z.infer<typeof outputSchema>;
type QueryMemorySettings = z.infer<typeof settingsSchema>;

export const queryMemory = defineAction<
  QueryMemoryInput,
  QueryMemoryOutput,
  ExampleContext,
  QueryMemorySettings
>({
  name: 'query_memory',
  description: 'Returns a canned memory summary for the provided thread.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input, context }) => {
    context.log('Fetching memory thread', {
      thread_id: input.thread_id,
      user_id: input.user_id,
    });

    return { summary: 'Previous discussion summarized for quick recall.' };
  },
});

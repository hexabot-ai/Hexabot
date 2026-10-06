/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { ExampleContext } from '../context';

const inputSchema = z.object({
  prompt: z.string(),
  allow_attachments: z.boolean().optional(),
});
const outputSchema = z.object({
  text: z.string().optional(),
  attachments: z.array(z.string()).optional(),
});
const settingsSchema = z.strictObject({
  await_user: z.boolean().optional(),
});

type AwaitUserInput = z.infer<typeof inputSchema>;
type AwaitUserOutput = z.infer<typeof outputSchema>;
type AwaitUserSettings = z.infer<typeof settingsSchema>;

export const awaitUserInput = defineAction<
  AwaitUserInput,
  AwaitUserOutput,
  ExampleContext,
  AwaitUserSettings
>({
  name: 'await_user_input',
  description: 'Placeholder action for human-in-the-loop pauses.',
  inputSchema,
  outputSchema,
  settingSchema: settingsSchema,
  execute: async ({ input, context }) => {
    context.log('Would ask user to reply', { prompt: input.prompt });

    return {
      text: 'Sample user reply for the demo run.',
      attachments: input.allow_attachments ? ['file-attachment-id'] : [],
    };
  },
});

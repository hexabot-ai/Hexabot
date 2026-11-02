/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { Settings } from '../../../src/dsl.types';
import type { LoopExampleContext } from '../context';

const inputSchema = z.object({});
const resumeSchema = z.object({
  text: z.string(),
});
const outputSchema = z.object({
  text: z.string(),
});

type AwaitReplyInput = z.infer<typeof inputSchema>;
type AwaitReplyOutput = z.infer<typeof outputSchema>;

export const awaitReply = defineAction<
  AwaitReplyInput,
  AwaitReplyOutput,
  LoopExampleContext,
  Settings
>({
  name: 'await_reply',
  description:
    'Pause workflow execution until the simulated user sends a reply payload.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return context.workflow.suspend({
      reason: 'awaiting_user_response',
      data: { hint: 'Provide phone number' },
      accepts: resumeSchema,
    });
  },
});

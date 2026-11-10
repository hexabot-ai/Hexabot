/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  incomingMessageType,
  stdIncomingMessageSchema,
  payloadSchema,
} from '@hexabot-ai/types';
import { z } from 'zod';

import { toDraft07JsonSchema } from '@/utils/helpers/zod';

export const conversationalWorkflowInputZodSchema = z
  .object({
    message_type: incomingMessageType.optional().meta({
      title: 'Message type',
      description:
        'Type of inbound message associated with the triggering event.',
    }),
    payload: z.union([payloadSchema, z.string()]).optional().meta({
      title: 'Payload',
      description: 'Raw event payload passed to the workflow.',
    }),
    message: stdIncomingMessageSchema.meta({
      title: 'Message',
      description: 'Full message object received from the channel.',
    }),
    text: z.string().meta({
      title: 'Text',
      description: 'Extracted text content from the inbound message.',
    }),
    mid: z.string().optional().meta({
      title: 'Message ID',
      description: 'Unique identifier of the inbound message.',
    }),
    thread_id: z.string().meta({
      title: 'Thread ID',
      description:
        'Identifier of the conversation thread to which this event belongs.',
    }),
  })
  .strict();

export type ConversationalWorkflowInput = z.infer<
  typeof conversationalWorkflowInputZodSchema
>;

export const conversationalWorkflowInputJsonSchema = toDraft07JsonSchema(
  conversationalWorkflowInputZodSchema,
);

export const scheduledWorkflowInputZodSchema = z
  .object({
    schedule: z.string().nullable().meta({
      title: 'Schedule',
      description: 'Schedule expression that triggered this workflow run.',
    }),
    triggered_at: z.string().datetime({ offset: true }).nullable().meta({
      title: 'Triggered At',
      description: 'Date and time when this workflow run was triggered.',
    }),
  })
  .strict();

export type ScheduledWorkflowInput = z.infer<
  typeof scheduledWorkflowInputZodSchema
>;

export const scheduledWorkflowInputJsonSchema = toDraft07JsonSchema(
  scheduledWorkflowInputZodSchema,
);

const manualWorkflowDefaultInputSchemaZodSchema = z.looseObject({});

export const manualWorkflowDefaultInputJsonSchema = toDraft07JsonSchema(
  manualWorkflowDefaultInputSchemaZodSchema,
);

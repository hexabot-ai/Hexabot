/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JSONSchema7 } from "json-schema";
import { z } from "zod";

import {
  incomingMessageType,
  stdIncomingMessageSchema,
} from "../chat/message-contract";
import { payloadSchema } from "../chat/quick-reply";
import { toRecord } from "../shared/object";

import { WorkflowType } from "./domain";

/** Input of a conversational workflow: the inbound message that triggered it. */
export const conversationalWorkflowInputSchema = z
  .object({
    message_type: incomingMessageType.optional().meta({
      title: "Message type",
      description:
        "Type of inbound message associated with the triggering event.",
    }),
    payload: z.union([payloadSchema, z.string()]).optional().meta({
      title: "Payload",
      description: "Raw event payload passed to the workflow.",
    }),
    message: stdIncomingMessageSchema.meta({
      title: "Message",
      description: "Full message object received from the channel.",
    }),
    text: z.string().meta({
      title: "Text",
      description: "Extracted text content from the inbound message.",
    }),
    mid: z.string().optional().meta({
      title: "Message ID",
      description: "Unique identifier of the inbound message.",
    }),
    thread_id: z.string().meta({
      title: "Thread ID",
      description:
        "Identifier of the conversation thread to which this event belongs.",
    }),
  })
  .strict();

export type ConversationalWorkflowInput = z.infer<
  typeof conversationalWorkflowInputSchema
>;

/** Input of a scheduled workflow: the schedule that fired and when. */
export const scheduledWorkflowInputSchema = z
  .object({
    schedule: z.string().nullable().meta({
      title: "Schedule",
      description: "Schedule expression that triggered this workflow run.",
    }),
    triggered_at: z.string().datetime({ offset: true }).nullable().meta({
      title: "Triggered At",
      description: "Date and time when this workflow run was triggered.",
    }),
  })
  .strict();

export type ScheduledWorkflowInput = z.infer<
  typeof scheduledWorkflowInputSchema
>;

// Input of a manual workflow that declares no `inputs.schema`: any object.
const manualWorkflowDefaultInputSchema = z.looseObject({});
// Built on first use, so that importing this package does not pay for
// converting the message schemas.
const fixedSchemas = new Map<z.ZodType, JSONSchema7>();
const toJsonSchema = (schema: z.ZodType): JSONSchema7 => {
  let jsonSchema = fixedSchemas.get(schema);
  if (!jsonSchema) {
    jsonSchema = schema.toJSONSchema({ target: "draft-07" }) as JSONSchema7;
    fixedSchemas.set(schema, jsonSchema);
  }

  return jsonSchema;
};

/**
 * Give the JSON Schema of the input a workflow is run with.
 *
 * A conversational or scheduled workflow is run with the input of its
 * trigger, which is fixed. A manual workflow declares its input in its
 * definition, under `inputs.schema`, and accepts any object when it declares
 * none. This is the only description of a workflow's input: nothing else is
 * stored.
 *
 * The result is shared between calls and must not be changed.
 *
 * @param type The workflow type.
 * @param definition The parsed definition of the workflow, when it has one.
 * @returns The JSON Schema of the workflow input.
 */
export const resolveWorkflowInputSchema = (
  type: unknown,
  definition?: unknown,
): JSONSchema7 => {
  if (type === WorkflowType.conversational) {
    return toJsonSchema(conversationalWorkflowInputSchema);
  }

  if (type === WorkflowType.scheduled) {
    return toJsonSchema(scheduledWorkflowInputSchema);
  }

  const declared = toRecord(toRecord(toRecord(definition)?.inputs)?.schema);

  return declared ?? toJsonSchema(manualWorkflowDefaultInputSchema);
};

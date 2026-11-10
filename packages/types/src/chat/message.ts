/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { asId, nullableIdSchema, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { preprocess } from "../shared/preprocess";
import { userSchema } from "../user/user";

import {
  IncomingMessageType,
  OutgoingMessageType,
  stdOutgoingMessageSchema,
  stdIncomingMessageSchema,
  type StdIncomingMessage,
  type StdOutgoingMessage,
} from "./message-contract";
import { subscriberSchema } from "./subscriber";
import { threadSchema } from "./thread";

const messageAliasMap = {
  senderId: "sender",
  recipientId: "recipient",
  sentById: "sentBy",
  threadId: "thread",
} as const;
const incomingOnlyTypes = new Set<IncomingMessageType>([
  IncomingMessageType.postback,
  IncomingMessageType.location,
]);
const outgoingOnlyTypes = new Set<OutgoingMessageType>([
  OutgoingMessageType.buttons,
  OutgoingMessageType.list,
  OutgoingMessageType.carousel,
  OutgoingMessageType.system,
]);
const invalidDirectionMessage = {
  type: "__invalidDirection__",
  data: null,
};
const parseByDirection = (
  message: unknown,
  record: Record<string, unknown>,
): unknown => {
  const hasSender = record.sender != null;
  const hasRecipient = record.recipient != null;
  const hasSentBy = record.sentBy != null;
  const shouldUseOutgoingSchema = hasRecipient || hasSentBy;
  const shouldUseIncomingSchema = hasSender && !shouldUseOutgoingSchema;

  if (shouldUseOutgoingSchema) {
    const parsed = stdOutgoingMessageSchema.safeParse(message);

    return parsed.success ? parsed.data : invalidDirectionMessage;
  }

  if (shouldUseIncomingSchema) {
    const parsed = stdIncomingMessageSchema.safeParse(message);

    return parsed.success ? parsed.data : invalidDirectionMessage;
  }

  const type =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>).type
      : undefined;

  if (typeof type !== "string") {
    const parsed = messagePayloadSchema.safeParse(message);

    return parsed.success ? parsed.data : message;
  }

  if (incomingOnlyTypes.has(type as IncomingMessageType)) {
    const parsed = stdIncomingMessageSchema.safeParse(message);

    return parsed.success ? parsed.data : message;
  }

  if (outgoingOnlyTypes.has(type as OutgoingMessageType)) {
    const parsed = stdOutgoingMessageSchema.safeParse(message);

    return parsed.success ? parsed.data : message;
  }

  const parsed = messagePayloadSchema.safeParse(message);

  return parsed.success ? parsed.data : message;
};
const normalizeMessageRecord = (value: unknown): unknown => {
  const normalized = withAliases(value, messageAliasMap);
  if (
    typeof normalized !== "object" ||
    normalized === null ||
    !("message" in normalized)
  ) {
    return normalized;
  }

  const record = normalized as Record<string, unknown>;
  record.message = parseByDirection(record.message, record);

  return record;
};
const messagePayloadSchema = z.union([
  stdIncomingMessageSchema,
  stdOutgoingMessageSchema,
]) as z.ZodType<StdIncomingMessage | StdOutgoingMessage>;
const messageStubObjectSchema = baseStubSchema.extend({
  mid: z.string().optional(),
  message: messagePayloadSchema,
  read: z.coerce.boolean(),
  delivery: z.coerce.boolean(),
  handover: z.coerce.boolean(),
});

export const messageStubSchema = messageStubObjectSchema;

export const messageSchema = preprocess(
  normalizeMessageRecord,
  messageStubObjectSchema.extend({
    sender: nullableIdSchema.optional(),
    recipient: nullableIdSchema.optional(),
    sentBy: nullableIdSchema.optional(),
    thread: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string(),
    ),
  }),
);

const messageFullObjectSchema = messageStubObjectSchema.extend({
  sender: subscriberSchema.nullable().optional(),
  recipient: subscriberSchema.nullable().optional(),
  sentBy: z
    .lazy(() => userSchema)
    .nullable()
    .optional(),
  thread: threadSchema,
});

export const messageFullSchema = preprocess(
  normalizeMessageRecord,
  messageFullObjectSchema,
);

export type MessageStub = z.infer<typeof messageStubSchema>;

export type Message = z.infer<typeof messageSchema>;

export type MessageFull = z.infer<typeof messageFullSchema>;

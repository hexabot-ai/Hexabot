/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  SubscriberFull,
  FileType,
  Button,
  StdQuickReply,
} from '@hexabot-ai/types';
import { z } from 'zod';

export namespace Web {
  export type RequestSession = {
    web?: {
      profile: SubscriberFull;
      threadId?: string;
      sourceId?: string;
    };
  };

  export enum StatusEventType {
    delivery = 'delivery',
    read = 'read',
    typing = 'typing',
  }

  export enum InboundMessageType {
    text = 'text',
    quick_reply = 'quick_reply',
    postback = 'postback',
    location = 'location',
    file = 'file',
  }

  export type EventType = Web.StatusEventType | Web.InboundMessageType;

  export enum OutboundMessageType {
    text = 'text',
    buttons = 'buttons',
    quick_replies = 'quick_replies',
    file = 'file',
    list = 'list',
    carousel = 'carousel',
  }

  export const inboundEventMetadataSchema = z.strictObject({
    mid: z.string().optional(),
    author: z.string().optional(),
    thread_id: z.string().optional(),
    read: z.boolean().optional(),
    delivery: z.boolean().optional(),
    // Whether it's a synchronization
    // This is used when message sent by the chatbot from the client side
    sync: z.boolean().optional(),
    createdAt: z.date().optional(),
  });

  export type InboundEventMetadata = z.infer<typeof inboundEventMetadataSchema>;

  export const inboundTextMessageDataSchema = z.strictObject({
    text: z.string(),
  });

  export type InboundTextMessageData = z.infer<
    typeof inboundTextMessageDataSchema
  >;

  export const inboundPayloadMessageDataSchema = z.strictObject({
    text: z.string(),
    payload: z.string(), // Quick reply and button payload are the same
  });

  export type InboundPayloadMessageData = z.infer<
    typeof inboundPayloadMessageDataSchema
  >;

  export const inboundLocationMessageDataSchema = z.strictObject({
    coordinates: z.strictObject({
      lat: z.number(),
      lng: z.number(),
    }),
  });

  export type InboundLocationMessageData = z.infer<
    typeof inboundLocationMessageDataSchema
  >;

  export const inboundAttachmentHistoryMessageDataSchema = z.strictObject({
    type: z.enum(FileType),
    url: z.string(), // file download url
  });

  export const inboundAttachmentUploadMessageDataSchema = z.strictObject({
    type: z.string(), // mime type
    size: z.number(), // file size
    name: z.string(),
    file: z.instanceof(Buffer).optional(),
  });

  export const inboundAttachmentMessageDataSchema = z.union([
    inboundAttachmentHistoryMessageDataSchema,
    inboundAttachmentUploadMessageDataSchema,
  ]);

  export type InboundAttachmentMessageData = z.infer<
    typeof inboundAttachmentMessageDataSchema
  >;

  export const inboundMessageDataSchema = z.union([
    inboundTextMessageDataSchema,
    inboundPayloadMessageDataSchema,
    inboundLocationMessageDataSchema,
    inboundAttachmentMessageDataSchema,
  ]);

  export type InboundMessageData = z.infer<typeof inboundMessageDataSchema>;

  export const statusDeliveryEventSchema = z.strictObject({
    type: z.literal(StatusEventType.delivery),
    mid: z.string(),
  });

  export type StatusDeliveryEvent = z.infer<typeof statusDeliveryEventSchema>;

  export const statusReadEventSchema = z.strictObject({
    type: z.literal(StatusEventType.read),
    watermark: z.number(),
  });

  export type StatusReadEvent = z.infer<typeof statusReadEventSchema>;

  export const statusTypingEventSchema = z.strictObject({
    type: z.literal(StatusEventType.typing),
  });

  export type StatusTypingEvent = z.infer<typeof statusTypingEventSchema>;

  export const statusEventSchema = z.union([
    statusDeliveryEventSchema,
    statusReadEventSchema,
    statusTypingEventSchema,
  ]);

  export type StatusEvent = z.infer<typeof statusEventSchema>;

  export const inboundTextMessageSchema = z.strictObject({
    type: z.literal(InboundMessageType.text),
    data: inboundTextMessageDataSchema,
    ...inboundEventMetadataSchema.shape,
  });

  export type InboundTextMessage = z.infer<typeof inboundTextMessageSchema>;

  export const inboundPostbackMessageSchema = z.strictObject({
    type: z.literal(InboundMessageType.postback),
    data: inboundPayloadMessageDataSchema,
    ...inboundEventMetadataSchema.shape,
  });

  export const inboundQuickReplyMessageSchema = z.strictObject({
    type: z.literal(InboundMessageType.quick_reply),
    data: inboundPayloadMessageDataSchema,
    ...inboundEventMetadataSchema.shape,
  });

  export const inboundPayloadMessageSchema = z.union([
    inboundPostbackMessageSchema,
    inboundQuickReplyMessageSchema,
  ]);

  export type IncomingPayloadMessage = z.infer<
    typeof inboundPayloadMessageSchema
  >;

  export const inboundLocationMessageSchema = z.strictObject({
    type: z.literal(InboundMessageType.location),
    data: inboundLocationMessageDataSchema,
    ...inboundEventMetadataSchema.shape,
  });

  export type IncomingLocationMessage = z.infer<
    typeof inboundLocationMessageSchema
  >;

  export const inboundAttachmentMessageSchema = z.strictObject({
    type: z.literal(InboundMessageType.file),
    data: inboundAttachmentMessageDataSchema,
    ...inboundEventMetadataSchema.shape,
  });

  export type InboundAttachmentMessage = z.infer<
    typeof inboundAttachmentMessageSchema
  >;

  export const inboundMessageBaseSchema = z.union([
    inboundTextMessageSchema,
    inboundPayloadMessageSchema,
    inboundLocationMessageSchema,
    inboundAttachmentMessageSchema,
  ]);

  export type InboundMessageBase = z.infer<typeof inboundMessageBaseSchema>;

  export type InboundMessage<
    T extends InboundMessageBase = InboundMessageBase,
  > = T;

  export const eventSchema = z.discriminatedUnion('type', [
    statusDeliveryEventSchema,
    statusReadEventSchema,
    statusTypingEventSchema,
    inboundTextMessageSchema,
    inboundPostbackMessageSchema,
    inboundQuickReplyMessageSchema,
    inboundLocationMessageSchema,
    inboundAttachmentMessageSchema,
  ]);

  export type Event = z.infer<typeof eventSchema>;

  export interface MessageElement {
    title: string;
    subtitle?: string;
    image_url?: string;
    buttons?: Button[];
  }

  export type OutboundTextMessageData = { text: string };

  export type OutboundQuickRepliesMessageData = OutboundTextMessageData & {
    quick_replies: StdQuickReply[];
  };

  export type OutboundButtonsMessageData = OutboundTextMessageData & {
    buttons: Button[];
  };

  export type OutboundFileMessageData = {
    quick_replies?: StdQuickReply[];
    type: FileType;
    url: string;
  };

  export type OutboundCarouselMessageData = {
    elements: MessageElement[];
  };

  export type OutboundListMessageData = OutboundCarouselMessageData & {
    top_element_style?: 'large' | 'compact';
    buttons: Button[];
  };

  export type OutboundMessageData =
    | OutboundTextMessageData
    | OutboundQuickRepliesMessageData
    | OutboundButtonsMessageData
    | OutboundFileMessageData
    | OutboundCarouselMessageData
    | OutboundListMessageData;

  export type OutboundMessageBase =
    | {
        type: OutboundMessageType.text;
        data: OutboundTextMessageData;
      }
    | {
        type: OutboundMessageType.quick_replies;
        data: OutboundQuickRepliesMessageData;
      }
    | {
        type: OutboundMessageType.buttons;
        data: OutboundButtonsMessageData;
      }
    | {
        type: OutboundMessageType.file;
        data: OutboundFileMessageData;
      }
    | {
        type: OutboundMessageType.carousel;
        data: OutboundCarouselMessageData;
      }
    | {
        type: OutboundMessageType.list;
        data: OutboundListMessageData;
      };

  export type OutboundMessage = OutboundMessageBase & {
    mid: string;
    author: string;
    thread_id?: string;
    read?: boolean;
    createdAt: Date;
    handover: boolean;
  };

  export type Message = OutboundMessage | InboundMessage;
}

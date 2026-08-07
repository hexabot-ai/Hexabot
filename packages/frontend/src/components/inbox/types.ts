/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Message } from "@hexabot-ai/types";

import { Subscriber } from "@/types/subscriber.types";

export interface MessageSentEvent {
  op: "messageSent";
  speakerId: string;
  msg: Message;
}

export interface MessageReceivedEvent {
  op: "messageReceived";
  speakerId: string;
  msg: Message;
}

export interface messageDeliveredEvent {
  op: "messageDelivered";
  speakerId: string;
  msg: Message;
}

export interface messageReadEvent {
  op: "messageRead";
  speakerId: string;
  msg: Message;
}

export interface newSubscriberEvent {
  op: "newSubscriber";
  profile: Subscriber;
}

export interface subscriberUpdateEvent {
  op: "updateSubscriber";
  profile: Subscriber;
}

export enum AssignedTo {
  ALL = "title.all_messages",
  ME = "title.handled_by_me",
  OTHERS = "title.handled_by_chatbot",
}

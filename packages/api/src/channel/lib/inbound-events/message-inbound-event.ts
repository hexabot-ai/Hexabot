/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ConversationalWorkflowInput,
  IncomingMessageType,
  StdEventType,
  StdIncomingMessage,
  Payload,
} from '@hexabot-ai/types';

import { ChannelName } from '../../types';
import type ChannelHandler from '../Handler';

import ChannelInboundEvent from './channel-inbound-event';

export abstract class MessageInboundEvent<
  N extends ChannelName = ChannelName,
  R = unknown,
  S = SubscriberChannelDict[N],
  C extends ChannelHandler<N> = ChannelHandler<N>,
> extends ChannelInboundEvent<N, R, S, C> {
  override getEventType(): StdEventType {
    return StdEventType.message;
  }

  abstract getMessageType(): IncomingMessageType;

  abstract toStdIncomingMessage(): StdIncomingMessage;

  getId(): string {
    return this.requireEventId();
  }

  getSenderForeignId(): string {
    return this.requireSenderForeignId();
  }

  getRecipientForeignId(): string {
    // Keep current v2 behavior for now
    return this.context.getRecipientForeignId() ?? '';
  }

  getPayload(): Payload | string | undefined {
    return undefined;
  }

  getMessage(): StdIncomingMessage {
    return this.toStdIncomingMessage();
  }

  getText(): string {
    const message = this.getMessage();

    if (
      message.type === IncomingMessageType.text ||
      message.type === IncomingMessageType.postback ||
      message.type === IncomingMessageType.quickReply
    ) {
      return message.data.text;
    }

    if (message.type === IncomingMessageType.attachment) {
      return message.data.serializedText;
    }

    return '';
  }

  async preprocess(): Promise<void> {
    // No-op by default.
  }

  override buildInput(): ConversationalWorkflowInput {
    const input: ConversationalWorkflowInput = {
      message_type: this.getMessageType(),
      payload: this.getPayload(),
      message: this.getMessage(),
      text: this.getText(),
      thread_id: this.getThreadId() ?? '',
    };
    const id = this.getId();
    if (id) {
      input.mid = id;
    }

    return input;
  }
}

export default MessageInboundEvent;

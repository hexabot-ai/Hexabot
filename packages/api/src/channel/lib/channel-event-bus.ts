/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StdEventType } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { MessageCreateDto } from '@/chat/dto/message.dto';

import type ChannelInboundEvent from './inbound-events/channel-inbound-event';
import type MessageInboundEvent from './inbound-events/message-inbound-event';

/**
 * Canonical event name registry for all chatbot hook integrations.
 *
 * Using constants here instead of interpolated strings means a typo becomes a
 * compile error rather than a silent missed event.
 */
export const ChannelHookEvent = {
  message: 'hook:chatbot:message',
  sent: 'hook:chatbot:sent',
  delivery: `hook:chatbot:${StdEventType.delivery}`,
  read: `hook:chatbot:${StdEventType.read}`,
  typing: `hook:chatbot:${StdEventType.typing}`,
  follow: `hook:chatbot:${StdEventType.follow}`,
  echo: `hook:chatbot:${StdEventType.echo}`,
  error: `hook:chatbot:${StdEventType.error}`,
} as const;

export type ChannelHookEventName =
  (typeof ChannelHookEvent)[keyof typeof ChannelHookEvent];

/**
 * Typed facade over EventEmitter2 for chatbot hook integration.
 *
 * Injected into every ChannelHandler via NestJS DI. Using the facade instead
 * of raw string-based emitAsync/emit calls makes the integration contract
 * explicit and compiler-checkable.
 */
@Injectable()
export class ChannelEventBus {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /** Dispatch a user-initiated message to the chatbot engine. */
  async emitMessage(event: MessageInboundEvent): Promise<void> {
    await this.eventEmitter.emitAsync(ChannelHookEvent.message, event);
  }

  /**
   * Record a chatbot-originated message that was synchronised from the client
   * side (e.g. web widget sending a bot reply for history storage).
   */
  emitSent(message: MessageCreateDto): void {
    this.eventEmitter.emit(ChannelHookEvent.sent, message);
  }

  /**
   * Dispatch a non-message status event (delivery, read, typing, follow, …).
   * The hook key is looked up from ChannelHookEvent to avoid interpolated strings.
   */
  emitStatusEvent(event: ChannelInboundEvent): void {
    const type = event.getEventType();
    const hookKey = `hook:chatbot:${type}` as ChannelHookEventName;

    this.eventEmitter.emit(hookKey, event);
  }
}

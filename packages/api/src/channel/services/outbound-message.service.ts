/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  IncomingMessageType,
  StdOutgoingMessage,
  Subscriber,
  Thread,
  ThreadFull,
} from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { MessageCreateDto } from '@/chat/dto/message.dto';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { ThreadService } from '@/chat/services/thread.service';

import type ChannelHandler from '../lib/Handler';
import {
  ChannelInboundEventContext,
  SyntheticMessageInboundEvent,
} from '../lib/inbound-events';
import { ChannelName } from '../types';

import { ChannelRegistry } from './channel-registry.service';

export type OutboundMessageRefusalCode =
  | 'thread_not_found'
  | 'subscriber_not_found'
  | 'channel_unavailable'
  | 'recipient_unreachable';

/**
 * Thrown when a message cannot be sent because its thread, its recipient or
 * the recipient's channel is missing. Nothing was sent.
 */
export class OutboundMessageRefusedError extends Error {
  constructor(
    readonly code: OutboundMessageRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'OutboundMessageRefusedError';
  }
}

export type OutboundMessageOptions = {
  /**
   * Id (`mid`) of the message this one answers. Defaults to the last message
   * of the thread.
   */
  inReplyTo?: string;
  /** User who wrote the message, when an admin did. */
  sentBy?: string;
  /** Names the sender in the raw payload of the event handed to the channel. */
  origin?: string;
};

export type SentOutboundMessage = {
  /** Id the channel gave the message. */
  mid: string;
  channel: ChannelName;
  thread: ThreadFull;
  recipient: Subscriber;
};

/** A subscriber the channel `handler` can address. */
type Recipient = {
  subscriber: Subscriber & { foreignId: string };
  channelName: ChannelName;
  handler: ChannelHandler<ChannelName>;
};

/**
 * Sends a message on a thread without an inbound event to answer: the Inbox
 * of an admin, or a workflow no subscriber message started.
 *
 * Channels send in reply to an event, so one is built from the thread, its
 * subscriber and its source as they are now.
 */
@Injectable()
export class OutboundMessageService {
  constructor(
    private readonly threadService: ThreadService,
    private readonly subscriberService: SubscriberService,
    private readonly messageService: MessageService,
    private readonly channelRegistry: ChannelRegistry,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Send a message to the subscriber of a thread, through the subscriber's
   * channel, and log it in the thread (`hook:chatbot:sent`).
   *
   * @param threadId - Thread to send the message on.
   * @param envelope - Message to send.
   * @param options - Who sends the message, and what it answers.
   * @returns The sent message's id, with its thread, recipient and channel.
   * @throws {OutboundMessageRefusedError} When the thread, its subscriber or
   * the subscriber's channel is missing.
   */
  async sendToThread(
    threadId: string,
    envelope: StdOutgoingMessage,
    options: OutboundMessageOptions = {},
  ): Promise<SentOutboundMessage> {
    const thread = await this.findThread(threadId);
    const recipient = await this.findRecipient(thread.subscriber.id);

    return await this.send(thread, recipient, envelope, options);
  }

  /** Load a thread with its subscriber and source. */
  private async findThread(threadId: string): Promise<ThreadFull> {
    const thread = await this.threadService.findOneAndPopulate(threadId);
    if (!thread?.subscriber) {
      throw new OutboundMessageRefusedError(
        'thread_not_found',
        `Thread with ID ${threadId} not found`,
      );
    }

    return thread;
  }

  /** Load a subscriber with the channel that reaches them. */
  private async findRecipient(subscriberId: string): Promise<Recipient> {
    const subscriber = await this.subscriberService.findOne(subscriberId);
    if (!subscriber) {
      throw new OutboundMessageRefusedError(
        'subscriber_not_found',
        `Subscriber with ID ${subscriberId} not found`,
      );
    }

    const channelName = subscriber.channel?.name as ChannelName | undefined;
    const handler = channelName
      ? this.channelRegistry.findChannel(channelName)
      : undefined;
    if (!channelName || !handler) {
      throw new OutboundMessageRefusedError(
        'channel_unavailable',
        'Subscriber channel not found',
      );
    }
    if (!subscriber.foreignId) {
      throw new OutboundMessageRefusedError(
        'recipient_unreachable',
        'Subscriber foreign ID is missing',
      );
    }

    return {
      subscriber: subscriber as Recipient['subscriber'],
      channelName,
      handler,
    };
  }

  private async send(
    thread: ThreadFull,
    { subscriber, channelName, handler }: Recipient,
    envelope: StdOutgoingMessage,
    options: OutboundMessageOptions,
  ): Promise<SentOutboundMessage> {
    const lastMid =
      options.inReplyTo ||
      (
        await this.messageService.findLastMessages(
          { id: thread.id } as Thread,
          1,
        )
      ).at(0)?.mid;
    const context = new ChannelInboundEventContext<
      ChannelName,
      Record<string, unknown>,
      Record<string, unknown>
    >(
      channelName,
      { source: options.origin ?? 'outbound-message' },
      (subscriber.channel.data ?? {}) as Record<string, unknown>,
      new Date(),
      lastMid ?? randomUUID(),
      subscriber.foreignId,
      null,
    );
    const event = new SyntheticMessageInboundEvent<
      ChannelName,
      Record<string, unknown>
    >(
      context,
      { type: IncomingMessageType.text, data: { text: '' } },
      IncomingMessageType.text,
      handler,
    );
    event.setInitiator(subscriber);
    event.setThreadId(thread.id);
    event.setSourceContext(thread.source.id, thread.source.settings);

    const { mid } = await handler.sendMessage(event, envelope, {});
    const sentMessage: MessageCreateDto = {
      mid,
      recipient: subscriber.id,
      thread: thread.id,
      message: envelope,
      sentBy: options.sentBy,
      read: false,
      delivery: false,
      handover: false,
    };
    // Awaited, so the message is in the thread once this returns.
    await this.eventEmitter.emitAsync('hook:chatbot:sent', sentMessage);

    return { mid, channel: channelName, thread, recipient: subscriber };
  }
}

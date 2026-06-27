/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Between, In } from 'typeorm';

import { StatsType } from '@/analytics/entities/stats.entity';
import { MessageInboundEvent } from '@/channel/lib/inbound-events';
import { config } from '@/config';
import {
  DeliveryNotificationInboundEvent,
  ReadNotificationInboundEvent,
} from '@/extensions/channels/web/inbound';
import { LoggerService } from '@/logger/logger.service';
import { AgenticService } from '@/workflow/services/agentic.service';

import { MessageCreateDto } from '../dto/message.dto';

import { MessageService } from './message.service';
import { SubscriberService } from './subscriber.service';
import { ThreadService } from './thread.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: LoggerService,
    private readonly messageService: MessageService,
    private readonly subscriberService: SubscriberService,
    private readonly threadService: ThreadService,
    @Inject(forwardRef(() => AgenticService))
    private readonly agenticService: AgenticService,
  ) {}

  private async ensureThreadTitle(
    thread: { id: string; title?: string | null },
    event: MessageInboundEvent,
  ) {
    if (!!thread.title?.trim()) {
      return;
    }

    const candidateTitle = this.threadService.buildThreadTitleFromIncomingText(
      event.getText(),
    );
    if (!candidateTitle) {
      return;
    }

    try {
      const updated = await this.threadService.setThreadTitleIfMissing(
        thread.id,
        candidateTitle,
      );
      if (updated?.title) {
        thread.title = updated.title;
      }
    } catch (err) {
      this.logger.warn(
        `Unable to set title for thread ${thread.id} from first incoming message`,
        err,
      );
    }
  }

  /**
   * Finds or creates a message and broadcast it to the websocket "Message" room
   *
   * @param sentMessage - The message that has been sent
   */
  @OnEvent('hook:chatbot:sent', { promisify: true })
  async handleSentMessage(sentMessage: MessageCreateDto) {
    if (sentMessage.thread) {
      await this.threadService.touchThread(sentMessage.thread);
    }

    if (sentMessage.mid) {
      try {
        await this.messageService.findOneOrCreate(
          {
            where: { mid: sentMessage.mid },
          },
          sentMessage,
        );
        this.logger.debug('Message has been logged.', sentMessage.mid);
      } catch (err) {
        this.logger.error('Unable to log sent message.', err);
      }
    }
  }

  /**
   * Creates the received message and broadcast it to the websocket "Message" room
   *
   * @param event - The received event
   */
  @OnEvent('hook:chatbot:received')
  async handleReceivedMessage(event: MessageInboundEvent) {
    let messageId = '';
    this.logger.debug('Received message');
    try {
      messageId = event.getId();
    } catch (err) {
      this.logger.warn('Failed to get the event id', messageId, err);
    }
    const subscriber = event.getInitiator();
    const threadId =
      event.getThreadId() ??
      (
        await this.threadService.resolveOrCreateThread({
          subscriberId: subscriber.id,
        })
      ).id;
    const received: MessageCreateDto = {
      mid: messageId,
      sender: subscriber.id,
      thread: threadId,
      message: event.getMessage(),
      delivery: true,
      read: true,
    };
    this.logger.debug('Logging message', received);
    try {
      const msg = await this.messageService.create(received);
      const populatedMsg = await this.messageService.findOneAndPopulate(msg.id);

      if (!populatedMsg) {
        this.logger.warn('Unable to find populated message.', event);
        throw new Error(`Unable to find Message by ID ${msg.id} not found`);
      }

      this.eventEmitter.emit(
        'hook:stats:entry',
        StatsType.incoming,
        'Incoming',
      );
      this.eventEmitter.emit(
        'hook:stats:entry',
        StatsType.all_messages,
        'All Messages',
      );
    } catch (err) {
      this.logger.error('Unable to log received message.', err, event);
    }
  }

  /**
   * Marks messages as delivered and broadcast it to the websocket "Message" room
   *
   * @param event - The received event
   */
  @OnEvent('hook:chatbot:delivery')
  async handleMessageDelivery(event: DeliveryNotificationInboundEvent) {
    if (config.chatbot.messages.track_delivery) {
      const deliveredMessages = event.getDeliveredMessages();
      try {
        await this.messageService.updateMany(
          { where: { mid: In(deliveredMessages) } },
          { delivery: true },
        );
      } catch (err) {
        this.logger.error('Unable to mark message as delivered.', err);
      }
    }
  }

  /**
   * Mark messages as read and broadcast to websocket "Message" room
   *
   * @param event - The received event
   */
  @OnEvent('hook:chatbot:read')
  async handleMessageRead(event: ReadNotificationInboundEvent) {
    if (config.chatbot.messages.track_read) {
      const subscriber = event.getInitiator();
      const watermark = new Date(event.getWatermark());
      const start = new Date(watermark.getTime() - 24 * 3600 * 1000);

      try {
        await this.messageService.updateMany(
          {
            where: {
              recipient: { id: subscriber.id },
              createdAt: Between(start, watermark),
            },
          },
          {
            delivery: true,
            read: true,
          },
        );
      } catch (err) {
        this.logger.error('Unable to mark message as read.', err);
      }
    }
  }

  /**
   * Handle echoing messages
   *
   * @param event - The received event
   */
  @OnEvent('hook:chatbot:echo')
  async handleEchoMessage(event: MessageInboundEvent) {
    this.logger.verbose('Message echo received', event.getRaw());
    const foreignId = event.getRecipientForeignId();
    const sourceId =
      typeof event.getSourceId === 'function'
        ? (event.getSourceId() ?? undefined)
        : undefined;

    if (foreignId) {
      try {
        const recipient = await this.subscriberService.findOneByForeignId(
          foreignId,
          sourceId,
        );

        if (!recipient) {
          throw new Error(`Subscriber with foreign ID ${foreignId} not found`);
        }

        const sentMessage: MessageCreateDto = {
          mid: event.getId(),
          recipient: recipient.id,
          thread: (
            await this.threadService.resolveOrCreateThread({
              subscriberId: recipient.id,
              explicitThreadId: event.getThreadId(),
              sourceId,
            })
          ).id,
          message: event.getMessage(),
          delivery: true,
          read: false,
        };

        this.eventEmitter.emit('hook:chatbot:sent', sentMessage);
        this.eventEmitter.emit('hook:stats:entry', StatsType.echo, 'Echo');
      } catch (err) {
        this.logger.error('Unable to log echo message', err, event);
      }
    }
  }

  /**
   * Handle new incoming messages
   *
   * @param event - The received event
   */
  @OnEvent('hook:chatbot:message', { promisify: true })
  async handleNewMessage(event: MessageInboundEvent) {
    this.logger.debug('New message received', event.getRaw());

    const foreignId = event.getSenderForeignId();
    const sourceId =
      typeof event.getSourceId === 'function'
        ? (event.getSourceId() ?? undefined)
        : undefined;
    if (!sourceId) {
      throw new Error('Cannot handle incoming message without source id');
    }
    const handler = event.getHandler();

    try {
      let subscriber = await this.subscriberService.findOneByForeignId(
        foreignId,
        sourceId,
      );

      if (!subscriber) {
        const subscriberData = await handler.getSubscriberData(event);
        subscriberData.channel = event.getChannelData();
        subscriberData.source = sourceId;
        subscriber = await this.subscriberService.create(subscriberData);

        if (!subscriber) {
          throw new Error('Unable to create a new subscriber');
        }

        // Retrieve and store the subscriber avatar
        // @TODO: We need to handle the avatar update (based on the lastvisit?)
        if (handler.getSubscriberAvatar) {
          try {
            const file = await handler.getSubscriberAvatar(event);
            if (file) {
              subscriber = await this.subscriberService.storeAvatar(
                subscriber.id,
                file,
              );
            }
          } catch (err) {
            this.logger.error(
              `Unable to retrieve avatar for subscriber ${event.getSenderForeignId()}`,
              err,
            );
          }
        }
      }
      event.setInitiator(subscriber);
      // Exec lastvisit hook
      this.eventEmitter.emit('hook:user:lastvisit', subscriber);

      // Set the subscriber object
      event.setInitiator(subscriber!);

      const channelSettings =
        typeof event.getSourceSettings === 'function'
          ? event.getSourceSettings()
          : {};
      const inactivityHours =
        this.threadService.resolveInactivityHours(channelSettings);
      const thread = await this.threadService.resolveThreadForIncoming({
        subscriberId: subscriber.id,
        explicitThreadId: event.getThreadId(),
        inactivityHours,
        sourceId,
      });
      event.setThreadId(thread.id);

      // Preprocess the event (persist attachments, ...)
      if (event.preprocess) {
        await event.preprocess();
      }

      await this.ensureThreadTitle(thread, event);

      // Trigger message received event
      this.eventEmitter.emit('hook:chatbot:received', event);

      if (subscriber?.assignedTo) {
        this.logger.debug('Chat taken over', subscriber.assignedTo);

        return;
      }

      await this.agenticService.handleEvent(event);
    } catch (err) {
      this.logger.error('Error handling new message', err);
    }
  }
}

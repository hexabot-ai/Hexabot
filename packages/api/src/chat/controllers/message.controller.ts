/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  Message,
  MessageFull,
  Thread,
  IncomingMessageType,
  OutgoingMessage,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { FindManyOptions } from 'typeorm';

import { ChannelService } from '@/channel/channel.service';
import {
  ChannelInboundEventContext,
  SyntheticMessageInboundEvent,
} from '@/channel/lib/inbound-events';
import { ChannelName } from '@/channel/types';
import { BaseOrmEntity } from '@/database/entities/base.entity';
import { getAuthenticatedUserId } from '@/user/utils/authenticated-user';
import { UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import { MessageSendDto } from '../dto/message.dto';
import { MessageOrmEntity } from '../entities/message.entity';
import { MessageService } from '../services/message.service';
import { SubscriberService } from '../services/subscriber.service';
import { ThreadService } from '../services/thread.service';

@Controller('message')
export class MessageController extends BaseOrmController<MessageOrmEntity> {
  constructor(
    private readonly messageService: MessageService,
    private readonly subscriberService: SubscriberService,
    private readonly threadService: ThreadService,
    private readonly channelService: ChannelService,
  ) {
    super(messageService);
  }

  /** Retrieves messages using TypeORM filters and optional relation population. */
  @Get()
  async findMessages(
    @Query(PopulatePipe)
    populate: string[],
    @Query(
      new TypeOrmSearchFilterPipe<MessageOrmEntity>({
        allowedFields: [
          'thread.id',
          'sentBy.id',
          'mid',
          'read',
          'delivery',
          'handover',
        ],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<MessageOrmEntity>,
  ): Promise<Message[] | MessageFull[]> {
    return await this.find(options, populate);
  }

  /**
   * Counts the filtered number of messages.
   * @returns A promise that resolves to an object representing the filtered number of messages.
   */
  @Get('count')
  async filterCount(
    @Query(
      new TypeOrmSearchFilterPipe<MessageOrmEntity>({
        allowedFields: [
          'thread.id',
          'sentBy.id',
          'mid',
          'read',
          'delivery',
          'handover',
        ],
      }),
    )
    options: FindManyOptions<MessageOrmEntity> = {},
  ): Promise<{ count: number }> {
    return await this.count(options);
  }

  @Get(':id')
  async findMessage(
    @UuidParam('id') id: string,
    @Query(PopulatePipe)
    populate: string[],
  ): Promise<Message | MessageFull> {
    return await this.findOne(id, populate);
  }

  @Post()
  async create(@Body() messageDto: MessageSendDto, @Req() req: Request) {
    if (!messageDto.thread) {
      throw new BadRequestException(
        'MessageController send : thread id is required',
      );
    }

    const thread = await this.threadService.findOneAndPopulate(
      messageDto.thread,
    );
    if (!thread?.subscriber) {
      this.logger.warn(`Unable to find thread by id ${messageDto.thread}`);
      throw new NotFoundException(
        `Thread with ID ${messageDto.thread} not found`,
      );
    }

    const subscriber = await this.subscriberService.findOne(
      thread.subscriber.id,
    );
    if (!subscriber) {
      this.logger.warn(
        `Unable to find subscriber by id ${thread.subscriber.id}`,
      );
      throw new NotFoundException(
        `Subscriber with ID ${thread.subscriber.id} not found`,
      );
    }

    const channelData = subscriber.channel;
    const channelName = channelData.name;
    if (!channelName || !this.channelService.findChannel(channelName)) {
      throw new BadRequestException(`Subscriber channel not found`);
    }
    if (!subscriber.foreignId) {
      throw new BadRequestException(`Subscriber foreign ID is missing`);
    }

    const envelope = messageDto.message;
    const latestMessageId = messageDto.inReplyTo
      ? messageDto.inReplyTo
      : (
          await this.messageService.findLastMessages(
            { id: thread.id } as Thread,
            1,
          )
        ).at(0)?.mid;
    const typedChannelName = channelName as ChannelName;
    const channelHandler =
      this.channelService.getChannelHandler(typedChannelName);
    const eventContext = new ChannelInboundEventContext<
      ChannelName,
      Record<string, unknown>,
      Record<string, unknown>
    >(
      typedChannelName,
      {
        source: 'message-controller',
      },
      (channelData.data ?? {}) as Record<string, unknown>,
      new Date(),
      latestMessageId ?? randomUUID(),
      subscriber.foreignId,
      null,
    );
    const event = new SyntheticMessageInboundEvent<
      ChannelName,
      Record<string, unknown>
    >(
      eventContext,
      { type: IncomingMessageType.text, data: { text: '' } },
      IncomingMessageType.text,
      channelHandler,
    );

    event.setInitiator(subscriber);
    event.setThreadId(thread.id);
    event.setSourceContext(thread.source.id, thread.source.settings);
    try {
      const { mid } = await channelHandler.sendMessage(event, envelope, {});
      // Trigger sent message event
      const sentMessage: Omit<OutgoingMessage, keyof BaseOrmEntity> = {
        mid,
        recipient: subscriber.id,
        thread: thread.id,
        message: messageDto.message,
        sentBy: getAuthenticatedUserId(req),
        read: false,
        delivery: false,
        handover: false,
      };
      this.eventEmitter.emit('hook:chatbot:sent', sentMessage, event);

      return {
        success: true,
      };
    } catch (err) {
      this.logger.debug('Unable to send message', err);
      throw new BadRequestException(
        'MessageController send : unable to send message',
      );
    }
  }
}

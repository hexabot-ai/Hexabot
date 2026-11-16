/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Message, MessageFull } from '@hexabot-ai/types';
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

import {
  OutboundMessageRefusalCode,
  OutboundMessageRefusedError,
  OutboundMessageService,
} from '@/channel/services/outbound-message.service';
import { UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import { MessageSendDto } from '../dto/message.dto';
import { MessageOrmEntity } from '../entities/message.entity';
import { MessageService } from '../services/message.service';

/** Refusals of a send that mean its thread or recipient does not exist. */
const NOT_FOUND_REFUSALS: ReadonlySet<OutboundMessageRefusalCode> = new Set([
  'thread_not_found',
  'subscriber_not_found',
]);

@Controller('message')
export class MessageController extends BaseOrmController<MessageOrmEntity> {
  constructor(
    private readonly messageService: MessageService,
    private readonly outboundMessageService: OutboundMessageService,
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

    try {
      await this.outboundMessageService.sendToThread(
        messageDto.thread,
        messageDto.message,
        {
          inReplyTo: messageDto.inReplyTo,
          sentBy: req.session.passport?.user?.id,
          origin: 'message-controller',
        },
      );

      return {
        success: true,
      };
    } catch (err) {
      if (err instanceof OutboundMessageRefusedError) {
        this.logger.warn(err.message);
        throw NOT_FOUND_REFUSALS.has(err.code)
          ? new NotFoundException(err.message)
          : new BadRequestException(err.message);
      }

      this.logger.debug('Unable to send message', err);
      throw new BadRequestException(
        'MessageController send : unable to send message',
      );
    }
  }
}

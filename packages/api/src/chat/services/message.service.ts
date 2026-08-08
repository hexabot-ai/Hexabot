/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Message, Thread, ThreadStub } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';

import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { MessageOrmEntity } from '../entities/message.entity';
import { MessageRepository } from '../repositories/message.repository';

@Injectable()
export class MessageService extends BaseOrmService<MessageOrmEntity> {
  constructor(readonly repository: MessageRepository) {
    super(repository);
  }

  /**
   * Retrieves the message history for a given subscriber up until a specific
   * date, with an optional limit on the number of messages to return.
   *
   * @param thread - The thread whose message history is being retrieved.
   * @param until - The date until which to retrieve messages (defaults to the current date).
   * @param limit - The maximum number of messages to return (defaults to 30).
   *
   * @returns The message history until the specified date.
   */
  async findHistoryUntilDate<S extends ThreadStub>(
    thread: S,
    until = new Date(),
    limit: number = 30,
  ): Promise<Message[]> {
    return await this.repository.findHistoryUntilDate(thread, until, limit);
  }

  /**
   * Retrieves the message history for a given subscriber since a specific
   * date, with an optional limit on the number of messages to return.
   *
   * @param thread - The thread whose message history is being retrieved.
   * @param since - The date since which to retrieve messages (defaults to the current date).
   * @param limit - The maximum number of messages to return (defaults to 30).
   *
   * @returns The message history since the specified date.
   */
  async findHistorySinceDate<S extends ThreadStub>(
    thread: S,
    since = new Date(),
    limit: number = 30,
  ): Promise<Message[]> {
    return await this.repository.findHistorySinceDate(thread, since, limit);
  }

  /**
   * Retrieves the latest messages for a given subscriber
   *
   * @param thread - The thread whose message history is being retrieved.
   * @param limit - The maximum number of messages to return (defaults to 5).
   *
   * @returns The message history since the specified date.
   */
  async findLastMessages(
    thread: Thread,
    limit: number = 5,
  ): Promise<Message[]> {
    return await this.repository.findLastMessagesForThread(thread, limit);
  }

  /**
   * Checks if a subscriber has the required permission to access the message including the attachment.
   * @param subscriberId - The ID of the subscriber.
   * @param attachmentId - The ID of the attachment
   * @returns A promise that resolves to a boolean
   */
  async isAttachmentAccessibleBySubscriber(
    subscriberId: string,
    attachmentId: string,
  ) {
    return await this.repository.isAttachmentAccessibleBySubscriber(
      subscriberId,
      attachmentId,
    );
  }
}

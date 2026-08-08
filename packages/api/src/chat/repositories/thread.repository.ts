/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Thread, ThreadFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseOrmRepository } from '@/utils/generics/base-orm.repository';

import { ThreadOrmEntity } from '../entities/thread.entity';

@Injectable()
export class ThreadRepository extends BaseOrmRepository<ThreadOrmEntity> {
  constructor(
    @InjectRepository(ThreadOrmEntity)
    repository: Repository<ThreadOrmEntity>,
  ) {
    super(repository, ['subscriber', 'source']);
  }

  async findOpenThreads(): Promise<ThreadFull[]> {
    return await this.findAndPopulate({
      where: {
        status: 'open',
      },
    });
  }

  async findLatestOpenThreadForSubscriber(
    subscriberId: string,
  ): Promise<Thread | null> {
    return await this.findOne({
      where: {
        subscriber: { id: subscriberId },
        status: 'open',
      },
      order: {
        lastMessageAt: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  async findLatestThreadForSubscriber(
    subscriberId: string,
  ): Promise<Thread | null> {
    return await this.findOne({
      where: {
        subscriber: { id: subscriberId },
      },
      order: {
        lastMessageAt: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  async findOneForSubscriber(
    threadId: string,
    subscriberId: string,
  ): Promise<Thread | null> {
    return await this.findOne({
      where: {
        id: threadId,
        subscriber: { id: subscriberId },
      },
    });
  }

  async setTitleIfMissing(
    threadId: string,
    title: string,
  ): Promise<Thread | null> {
    const result = await this.repository
      .createQueryBuilder()
      .update(ThreadOrmEntity)
      .set({ title })
      .where('id = :threadId', { threadId })
      .andWhere("(title IS NULL OR title = '')")
      .execute();

    if (!result.affected) {
      return null;
    }

    return await this.findOne(threadId);
  }
}

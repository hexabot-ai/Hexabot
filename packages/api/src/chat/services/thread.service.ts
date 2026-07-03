/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Thread } from '@hexabot-ai/types';
import { BadRequestException, Injectable } from '@nestjs/common';
import { FindOneOptions } from 'typeorm';

import { UpdateOneOptions } from '@/utils/generics/base-orm.repository';
import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { ThreadCreateDto, ThreadUpdateDto } from '../dto/thread.dto';
import { ThreadOrmEntity } from '../entities/thread.entity';
import { ThreadRepository } from '../repositories/thread.repository';

import { SubscriberService } from './subscriber.service';

@Injectable()
export class ThreadService extends BaseOrmService<ThreadOrmEntity> {
  public static readonly THREAD_TITLE_MAX_LENGTH = 96;

  public static readonly THREAD_TITLE_ELLIPSIS = '...';

  private extractSourceId(source: unknown): string | null {
    if (typeof source === 'string' && source.length > 0) {
      return source;
    }
    if (
      source &&
      typeof source === 'object' &&
      'id' in source &&
      typeof (source as { id?: unknown }).id === 'string'
    ) {
      return (source as { id: string }).id;
    }

    return null;
  }

  constructor(
    readonly repository: ThreadRepository,
    private readonly subscriberService: SubscriberService,
  ) {
    super(repository);
  }

  private async resolveThreadSourceId({
    subscriberId,
    sourceId,
  }: {
    subscriberId: string;
    sourceId?: string;
  }): Promise<string> {
    // Incoming event context is authoritative when present.
    if (sourceId) {
      return sourceId;
    }

    const subscriber = await this.subscriberService.findOne(subscriberId);
    if (!subscriber) {
      throw new Error(
        `Unable to resolve source for subscriber ${subscriberId}`,
      );
    }

    const subscriberSourceId = this.extractSourceId(subscriber.source);
    if (subscriberSourceId) {
      return subscriberSourceId;
    }

    throw new Error(`Unable to resolve source for subscriber ${subscriberId}`);
  }

  override async create(
    payload: ThreadCreateDto & { source?: string },
  ): Promise<Thread> {
    const sourceId = await this.resolveThreadSourceId({
      subscriberId: payload.subscriber,
      sourceId: payload.source,
    });

    return await super.create({
      ...payload,
      source: sourceId,
    } as ThreadCreateDto);
  }

  getDefaultInactivityHours(): number {
    return 24;
  }

  getInactivityThresholdMs(hours?: number): number {
    const normalizedHours = Number.isFinite(hours)
      ? Math.max(0, Number(hours))
      : this.getDefaultInactivityHours();

    return normalizedHours * 60 * 60 * 1000;
  }

  async findThreadForSubscriber(
    threadId: string,
    subscriberId: string,
  ): Promise<Thread | null> {
    return await this.repository.findOneForSubscriber(threadId, subscriberId);
  }

  async createThread(
    subscriberId: string,
    title?: string | null,
    sourceId?: string,
  ) {
    return await this.create({
      subscriber: subscriberId,
      source: sourceId,
      title: title ?? null,
      status: 'open',
      lastMessageAt: new Date(),
      closeReason: null,
      closedAt: null,
    });
  }

  override async updateOne(
    idOrOptions: string | FindOneOptions<ThreadOrmEntity>,
    payload: ThreadUpdateDto,
    options?: UpdateOneOptions,
  ): Promise<Thread> {
    if ('subscriber' in (payload ?? {}) || 'source' in (payload ?? {})) {
      throw new BadRequestException(
        'Thread subscriber and source cannot be updated',
      );
    }

    return await super.updateOne(idOrOptions, payload, options);
  }

  buildThreadTitleFromIncomingText(input?: string | null): string | null {
    if (typeof input !== 'string') {
      return null;
    }

    const normalized = input.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    if (normalized.length <= ThreadService.THREAD_TITLE_MAX_LENGTH) {
      return normalized;
    }

    const trimmedMax = Math.max(
      1,
      ThreadService.THREAD_TITLE_MAX_LENGTH -
        ThreadService.THREAD_TITLE_ELLIPSIS.length,
    );

    return `${normalized.slice(0, trimmedMax).trimEnd()}${ThreadService.THREAD_TITLE_ELLIPSIS}`;
  }

  async setThreadTitleIfMissing(threadId: string, title: string) {
    return await this.repository.setTitleIfMissing(threadId, title);
  }

  async touchThread(threadId: string, at: Date = new Date()) {
    return await this.updateOne(threadId, {
      lastMessageAt: at,
    });
  }

  async closeThread(
    threadId: string,
    reason: 'manual' | 'inactivity' = 'manual',
    at: Date = new Date(),
  ) {
    return await this.updateOne(threadId, {
      status: 'closed',
      closeReason: reason,
      closedAt: at,
      lastMessageAt: at,
    });
  }

  async reopenThread(threadId: string, at: Date = new Date()) {
    return await this.updateOne(threadId, {
      status: 'open',
      closeReason: null,
      closedAt: null,
      lastMessageAt: at,
    });
  }

  async resolveThreadForIncoming({
    subscriberId,
    explicitThreadId,
    inactivityHours,
    sourceId,
  }: {
    subscriberId: string;
    explicitThreadId?: string;
    inactivityHours?: number;
    sourceId?: string;
  }): Promise<Thread> {
    const now = new Date();

    if (explicitThreadId) {
      const explicit = await this.repository.findOne({
        where: {
          id: explicitThreadId,
          subscriber: { id: subscriberId },
        },
      });
      if (!explicit) {
        throw new Error(
          `Thread ${explicitThreadId} was not found for subscriber ${subscriberId}`,
        );
      }

      if (explicit.status === 'closed') {
        return await this.createThread(subscriberId, null, sourceId);
      }

      await this.touchThread(explicit.id, now);

      return explicit;
    }

    const latestOpen =
      await this.repository.findLatestOpenThreadForSubscriber(subscriberId);

    if (!latestOpen) {
      return await this.createThread(subscriberId, null, sourceId);
    }

    const anchor = latestOpen.lastMessageAt ?? latestOpen.createdAt;
    const inactivityMs = this.getInactivityThresholdMs(inactivityHours);
    const hasExpired = now.getTime() - anchor.getTime() > inactivityMs;

    if (hasExpired) {
      await this.closeThread(latestOpen.id, 'inactivity', now);

      return await this.createThread(subscriberId, null, sourceId);
    }

    await this.touchThread(latestOpen.id, now);

    return latestOpen;
  }

  async resolveOrCreateThread({
    subscriberId,
    explicitThreadId,
    sourceId,
  }: {
    subscriberId: string;
    explicitThreadId?: string;
    sourceId?: string;
  }): Promise<Thread> {
    const resolved = await this.resolveThread({
      subscriberId,
      explicitThreadId,
    });
    if (resolved) {
      return resolved;
    }

    return await this.createThread(subscriberId, null, sourceId);
  }

  async resolveThread({
    subscriberId,
    explicitThreadId,
  }: {
    subscriberId: string;
    explicitThreadId?: string;
  }): Promise<Thread | null> {
    if (explicitThreadId) {
      const explicit = await this.findThreadForSubscriber(
        explicitThreadId,
        subscriberId,
      );
      if (!explicit) {
        throw new Error(
          `Thread ${explicitThreadId} was not found for subscriber ${subscriberId}`,
        );
      }

      if (explicit.status !== 'closed') {
        return explicit;
      }
      // Explicit thread is closed; fall through to the latest open thread
      // so callers (subscribe/history flows) don't serve stale history.
      const latestOpenAfterClose =
        await this.repository.findLatestOpenThreadForSubscriber(subscriberId);

      return latestOpenAfterClose ?? null;
    }

    const latestOpen =
      await this.repository.findLatestOpenThreadForSubscriber(subscriberId);

    if (latestOpen) {
      return latestOpen;
    }

    const latest =
      await this.repository.findLatestThreadForSubscriber(subscriberId);

    return latest ?? null;
  }

  /**
   * Resolve inactivity timeout from channel settings object.
   */
  resolveInactivityHours(settings: unknown): number {
    const candidate = (settings as { thread_inactivity_hours?: unknown })
      ?.thread_inactivity_hours;

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.max(0, candidate);
    }
    if (typeof candidate === 'string') {
      const parsed = Number.parseInt(candidate, 10);
      if (!Number.isNaN(parsed)) {
        return Math.max(0, parsed);
      }
    }

    return this.getDefaultInactivityHours();
  }
}

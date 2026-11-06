/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Stats, Subscriber } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Between } from 'typeorm';

import { SubscriberUpdateDto } from '@/chat/dto/subscriber.dto';
import { SubscriberOrmEntity } from '@/chat/entities/subscriber.entity';
import { MessageService } from '@/chat/services/message.service';
import { config } from '@/config';
import { BaseOrmService } from '@/utils/generics/base-orm.service';
import { InsertEntityEvent } from '@/utils/types/entity-event.types';
import { WorkflowRunService } from '@/workflow/services/workflow-run.service';
import { WorkflowService } from '@/workflow/services/workflow.service';

import {
  StatsFailedWorkflowRunsDto,
  StatsSummaryDto,
  StatsThreadSnapshotDto,
} from '../dto/stats.dto';
import { StatsOrmEntity, StatsType } from '../entities/stats.entity';
import { StatsRepository } from '../repositories/stats.repository';

const THREAD_SNAPSHOT_TYPES = [
  StatsType.new_threads,
  StatsType.handoffs,
] as const;
const startOfDay = (date: Date): Date => {
  const day = new Date(date);
  day.setMilliseconds(0);
  day.setSeconds(0);
  day.setMinutes(0);
  day.setHours(0);

  return day;
};
const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);

  return result;
};
const formatDayKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
};
const getLast24hRange = (): { since: Date; now: Date } => {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return { since, now };
};

@Injectable()
export class StatsService extends BaseOrmService<StatsOrmEntity> {
  constructor(
    readonly repository: StatsRepository,
    private readonly workflowService: WorkflowService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly messageService: MessageService,
  ) {
    super(repository);
  }

  /**
   * Counts a new user once the subscriber is saved: before that, it has no
   * `id` or timestamps and cannot be serialized.
   */
  @OnEvent('hook:subscriber:postCreate')
  async handleSubscriberPostCreate(
    event: InsertEntityEvent<SubscriberOrmEntity>,
  ) {
    const subscriber = event.entity.toPlainCls();

    await this.eventEmitter.emitAsync(
      'hook:stats:entry',
      StatsType.new_users,
      'New users',
      subscriber,
    );
  }

  /**
   * Retrieves statistics for messages within a specified time range and of specified types.
   *
   * @param from - The start date for filtering messages.
   * @param to - The end date for filtering messages.
   * @param types - An array of message types (of type StatsType) to filter the statistics.
   *
   * @returns A promise that resolves to an array of `Stats` objects representing the message statistics.
   */
  async findMessages(
    from: Date,
    to: Date,
    types: StatsType[],
  ): Promise<Stats[]> {
    return await this.repository.findMessages(from, to, types);
  }

  async getThreadSnapshot(
    from?: Date,
    to?: Date,
  ): Promise<StatsThreadSnapshotDto> {
    const end = startOfDay(to ?? new Date());
    const start = startOfDay(from ?? addDays(end, -6));
    const days: string[] = [];

    for (
      let current = new Date(start);
      current.getTime() <= end.getTime();
      current = addDays(current, 1)
    ) {
      days.push(formatDayKey(current));
    }

    const stats = await this.findMessages(start, end, [
      ...THREAD_SNAPSHOT_TYPES,
    ]);
    const valuesByTypeAndDay = new Map<StatsType, Map<string, number>>();

    for (const type of THREAD_SNAPSHOT_TYPES) {
      valuesByTypeAndDay.set(type, new Map());
    }

    for (const stat of stats) {
      const dayKey = formatDayKey(startOfDay(stat.day));
      const valuesByDay = valuesByTypeAndDay.get(stat.type);

      if (valuesByDay) {
        valuesByDay.set(dayKey, (valuesByDay.get(dayKey) ?? 0) + stat.value);
      }
    }

    return {
      xAxis: days,
      series: THREAD_SNAPSHOT_TYPES.map((type) => ({
        type,
        data: days.map((day) => valuesByTypeAndDay.get(type)?.get(day) ?? 0),
      })) as StatsThreadSnapshotDto['series'],
    };
  }

  async getSummary(): Promise<StatsSummaryDto> {
    const { since, now } = getLast24hRange();
    const [
      totalWorkflows,
      totalRunsLast24h,
      totalMessagesLast24h,
      successfulRunsLast24h,
      failedRunsLast24h,
    ] = await Promise.all([
      this.workflowService.count(),
      this.workflowRunService.count({
        where: { createdAt: Between(since, now) },
      }),
      this.messageService.count({
        where: { createdAt: Between(since, now) },
      }),
      this.workflowRunService.count({
        where: { status: 'finished', finishedAt: Between(since, now) },
      }),
      this.workflowRunService.count({
        where: { status: 'failed', failedAt: Between(since, now) },
      }),
    ]);
    const completedRuns = successfulRunsLast24h + failedRunsLast24h;
    const successRateLast24h =
      completedRuns > 0 ? successfulRunsLast24h / completedRuns : 0;

    return {
      totalWorkflows,
      totalRunsLast24h,
      successRateLast24h,
      totalMessagesLast24h,
    };
  }

  async getFailedWorkflowRunsLast24h(
    limit = 3,
  ): Promise<StatsFailedWorkflowRunsDto> {
    const { since, now } = getLast24hRange();
    const take = Math.max(1, limit);
    const where = { status: 'failed' as const, failedAt: Between(since, now) };
    const [total, runs] = await Promise.all([
      this.workflowRunService.count({ where }),
      this.workflowRunService.findAndPopulate({
        where,
        order: { failedAt: 'DESC', createdAt: 'DESC' },
        take,
      }),
    ]);

    return { total, runs };
  }

  /**
   * Handles the event to track user activity and emit statistics for loyalty, returning users, and retention.
   *
   * This method checks the last visit of the subscriber and emits relevant analytics events
   * based on configured thresholds for loyalty, returning users, and retention.
   *
   * @param {Subscriber} subscriber - The subscriber object that contains last visit and retention data.
   */
  @OnEvent('hook:user:lastvisit')
  handleLastVisit(subscriber: Subscriber) {
    const now = +new Date();
    if (subscriber.lastvisit) {
      // A loyal subscriber is a subscriber that comes back after some inactivity
      if (now - +subscriber.lastvisit > config.analytics.thresholds.loyalty) {
        this.eventEmitter.emit(
          'hook:stats:entry',
          StatsType.returning_users,
          'Loyalty',
          subscriber,
        );
      }

      // Returning subscriber is a subscriber that comes back after some inactivity
      if (now - +subscriber.lastvisit > config.analytics.thresholds.returning) {
        this.eventEmitter.emit(
          'hook:stats:entry',
          StatsType.returning_users,
          'Returning users',
          subscriber,
        );
      }
    }
    // Retention
    if (
      subscriber.retainedFrom &&
      now - +subscriber.retainedFrom > config.analytics.thresholds.retention
    ) {
      this.eventEmitter.emit(
        'hook:stats:entry',
        StatsType.retention,
        'Retentioned users',
      );
    }
  }

  @OnEvent('hook:thread:postCreate')
  async handleThreadPostCreate(): Promise<void> {
    await this.eventEmitter.emitAsync(
      'hook:stats:entry',
      StatsType.new_threads,
      'New Threads',
    );
  }

  @OnEvent('hook:subscriber:assign')
  async handleSubscriberAssign(update: SubscriberUpdateDto): Promise<void> {
    if (!update.assignedTo) {
      return;
    }

    await this.eventEmitter.emitAsync(
      'hook:stats:entry',
      StatsType.handoffs,
      'Handoffs',
    );
  }

  /**
   * Handles the event to update bot statistics.
   *
   * @param type - The type of bot statistics being tracked (e.g., user messages, bot responses).
   * @param name - The name or identifier of the statistics entry (e.g., a specific feature or component being tracked).
   */
  @OnEvent('hook:stats:entry')
  async handleStatEntry(type: StatsType, name: string): Promise<void> {
    const day = startOfDay(new Date());

    try {
      const insight = await this.findOneOrCreate(
        { where: { day, type, name } },
        { day, type, name, value: 0 },
      );

      try {
        await this.updateOne(insight.id, { value: insight.value + 1 });
      } catch (err) {
        this.logger.error('Unable to update insight', err);
      }
    } catch (err) {
      this.logger.error('Unable to find or create insight', err);
    }
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EventEmitter2 } from '@nestjs/event-emitter';
import { TestingModule } from '@nestjs/testing';

import { MessageService } from '@/chat/services/message.service';
import {
  installStatsFixturesTypeOrm,
  statsFixtures,
} from '@/utils/test/fixtures/stats';
import { buildTestingMocks } from '@/utils/test/utils';
import { WorkflowRunService } from '@/workflow/services/workflow-run.service';
import { WorkflowService } from '@/workflow/services/workflow.service';

import { StatsType } from '../entities/stats.entity';
import { StatsRepository } from '../repositories/stats.repository';

import { StatsService } from './stats.service';

describe('StatsService', () => {
  let statsService: StatsService;
  let statsRepository: StatsRepository;
  let module: TestingModule;
  let eventEmitter: EventEmitter2;
  const workflowService = {
    count: jest.fn(),
  } as jest.Mocked<Pick<WorkflowService, 'count'>>;
  const workflowRunService = {
    count: jest.fn(),
    findAndPopulate: jest.fn(),
  } as jest.Mocked<Pick<WorkflowRunService, 'count' | 'findAndPopulate'>>;
  const messageService = {
    count: jest.fn(),
  } as jest.Mocked<Pick<MessageService, 'count'>>;
  const sortByDayAndType = <T extends { day: Date; type: string }>(
    items: T[],
  ) =>
    [...items].sort((left, right) => {
      const leftTime = new Date(left.day).getTime();
      const rightTime = new Date(right.day).getTime();
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return left.type.localeCompare(right.type);
    });

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        StatsService,
        { provide: WorkflowService, useValue: workflowService },
        { provide: WorkflowRunService, useValue: workflowRunService },
        { provide: MessageService, useValue: messageService },
      ],
      typeorm: {
        fixtures: installStatsFixturesTypeOrm,
      },
    });
    module = testingModule;
    [statsService, statsRepository] = await getMocks([
      StatsService,
      StatsRepository,
    ]);
    eventEmitter = module.get(EventEmitter2);
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findMessages', () => {
    it('should return all messages', async () => {
      jest.spyOn(statsRepository, 'findMessages');
      const from = statsFixtures[0].day;
      const to = new Date();
      const result = await statsService.findMessages(
        from,
        to,
        Object.values(StatsType),
      );

      expect(statsRepository.findMessages).toHaveBeenCalledWith(
        from,
        to,
        Object.values(StatsType),
      );
      expect(sortByDayAndType(result)).toEqualPayload(
        sortByDayAndType(statsFixtures),
      );
    });

    it('should return messages between the given date range', async () => {
      jest.spyOn(statsRepository, 'findMessages');
      const from = statsFixtures[0].day;
      const to = statsFixtures[2].day;
      const result = await statsService.findMessages(
        from,
        to,
        Object.values(StatsType),
      );
      expect(statsRepository.findMessages).toHaveBeenCalledWith(
        from,
        to,
        Object.values(StatsType),
      );
      expect(sortByDayAndType(result)).toEqualPayload(
        sortByDayAndType(statsFixtures.slice(0, 3)),
      );
    });

    it('should return messages of a given type', async () => {
      jest.spyOn(statsRepository, 'findMessages');
      const from = statsFixtures[0].day;
      const to = new Date();
      const result = await statsService.findMessages(from, to, [
        StatsType.outgoing,
      ]);
      expect(statsRepository.findMessages).toHaveBeenCalledWith(from, to, [
        StatsType.outgoing,
      ]);
      expect(result).toEqualPayload([statsFixtures[5]]);
    });

    it('should return messages of type audiance', async () => {
      jest.spyOn(statsRepository, 'findMessages');
      const from = statsFixtures[0].day;
      const to = new Date();
      const result = await statsService.findMessages(from, to, [
        StatsType.new_users,
        StatsType.returning_users,
        StatsType.retention,
      ]);
      expect(statsRepository.findMessages).toHaveBeenCalledWith(from, to, [
        StatsType.new_users,
        StatsType.returning_users,
        StatsType.retention,
      ]);
      expect(result).toEqualPayload(statsFixtures.slice(1, 4));
    });
  });

  describe('handleSubscriberPreCreate', () => {
    it('should emit new users stat entry', async () => {
      const emitSpy = jest.spyOn(eventEmitter, 'emitAsync');
      const subscriber = { id: 'subscriber-id', first_name: 'John' };
      const event = {
        entity: {
          toPlainCls: () => subscriber,
        },
      } as any;

      await statsService.handleSubscriberPreCreate(event);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(
        'hook:stats:entry',
        StatsType.new_users,
        'New users',
        subscriber,
      );
    });
  });

  describe('thread snapshot events', () => {
    it('should emit new thread stat entry when a thread is created', async () => {
      const emitSpy = jest.spyOn(eventEmitter, 'emitAsync');

      await statsService.handleThreadPostCreate();

      expect(emitSpy).toHaveBeenCalledWith(
        'hook:stats:entry',
        StatsType.new_threads,
        'New Threads',
      );
    });

    it('should emit handoff stat entry when a subscriber is assigned', async () => {
      const emitSpy = jest.spyOn(eventEmitter, 'emitAsync');

      await statsService.handleSubscriberAssign({
        assignedTo: 'user-id',
      } as any);

      expect(emitSpy).toHaveBeenCalledWith(
        'hook:stats:entry',
        StatsType.handoffs,
        'Handoffs',
      );
    });

    it('should ignore subscriber assign events without an assignee', async () => {
      const emitSpy = jest.spyOn(eventEmitter, 'emitAsync');

      await statsService.handleSubscriberAssign({
        assignedTo: null,
      } as any);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('getThreadSnapshot', () => {
    it('should aggregate seven sorted daily buckets and fill missing days', async () => {
      const from = new Date(2024, 0, 1);
      const to = new Date(2024, 0, 7);

      await statsService.create({
        day: new Date(2024, 0, 1),
        type: StatsType.new_threads,
        name: 'New Threads',
        value: 2,
      });
      await statsService.create({
        day: new Date(2024, 0, 3),
        type: StatsType.new_threads,
        name: 'New Threads',
        value: 4,
      });
      await statsService.create({
        day: new Date(2024, 0, 3),
        type: StatsType.new_threads,
        name: 'New Threads from import',
        value: 1,
      });
      await statsService.create({
        day: new Date(2024, 0, 4),
        type: StatsType.handoffs,
        name: 'Handoffs',
        value: 2,
      });

      const result = await statsService.getThreadSnapshot(from, to);

      expect(result).toEqual({
        xAxis: [
          '2024-01-01',
          '2024-01-02',
          '2024-01-03',
          '2024-01-04',
          '2024-01-05',
          '2024-01-06',
          '2024-01-07',
        ],
        series: [
          {
            type: StatsType.new_threads,
            data: [2, 0, 5, 0, 0, 0, 0],
          },
          {
            type: StatsType.handoffs,
            data: [0, 0, 0, 2, 0, 0, 0],
          },
        ],
      });
    });
  });

  describe('getSummary', () => {
    it('should aggregate workflow, run, success, and message stats', async () => {
      workflowService.count.mockResolvedValue(4);
      workflowRunService.count
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(8);
      messageService.count.mockResolvedValue(105);

      const result = await statsService.getSummary();

      expect(result).toEqual({
        totalWorkflows: 4,
        totalRunsLast24h: 20,
        successRateLast24h: 0.6,
        totalMessagesLast24h: 105,
      });
      expect(workflowService.count).toHaveBeenCalledTimes(1);
      expect(workflowRunService.count).toHaveBeenCalledTimes(3);
      expect(messageService.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFailedWorkflowRunsLast24h', () => {
    it('should return total and latest failed workflow runs from the last 24 hours', async () => {
      const now = new Date('2026-01-02T12:00:00.000Z');
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const runs = [{ id: 'run-1' }, { id: 'run-2' }] as any;

      jest.useFakeTimers();
      jest.setSystemTime(now);
      workflowRunService.count.mockResolvedValue(5);
      workflowRunService.findAndPopulate.mockResolvedValue(runs);

      try {
        const result = await statsService.getFailedWorkflowRunsLast24h(3);

        expect(result).toEqual({ total: 5, runs });
        expect(workflowRunService.count).toHaveBeenCalledTimes(1);
        expect(workflowRunService.findAndPopulate).toHaveBeenCalledTimes(1);

        const countOptions = workflowRunService.count.mock.calls[0][0] as any;
        const findOptions = workflowRunService.findAndPopulate.mock
          .calls[0][0] as any;

        expect(countOptions.where.status).toBe('failed');
        expect(countOptions.where.failedAt.type).toBe('between');
        expect(countOptions.where.failedAt.value).toEqual([since, now]);
        expect(findOptions.where.status).toBe('failed');
        expect(findOptions.where.failedAt.type).toBe('between');
        expect(findOptions.where.failedAt.value).toEqual([since, now]);
        expect(findOptions.order).toEqual({
          failedAt: 'DESC',
          createdAt: 'DESC',
        });
        expect(findOptions.take).toBe(3);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

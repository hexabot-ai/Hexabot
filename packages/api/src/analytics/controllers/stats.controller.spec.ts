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

import { StatsController } from './stats.controller';

describe('StatsController', () => {
  let statsController: StatsController;
  let module: TestingModule;
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

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [StatsController],
      providers: [
        EventEmitter2,
        { provide: WorkflowService, useValue: workflowService },
        { provide: WorkflowRunService, useValue: workflowRunService },
        { provide: MessageService, useValue: messageService },
      ],
      typeorm: {
        fixtures: installStatsFixturesTypeOrm,
      },
    });
    module = testingModule;
    [statsController] = await getMocks([StatsController]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findMessages', () => {
    it('should return no messages in the given date range', async () => {
      const result = await statsController.findMessages({
        from: new Date('2024-11-01T23:00:00.000Z'),
        to: new Date('2024-11-05T23:00:00.000Z'),
      });
      expect(result).toHaveLength(3);
      expect(result).toEqualPayload([
        {
          id: 1,
          name: StatsType.all_messages,
          values: [],
        },
        {
          id: 2,
          name: StatsType.incoming,
          values: [],
        },
        {
          id: 3,
          name: StatsType.outgoing,
          values: [],
        },
      ]);
    });

    it('should return messages in the given date range', async () => {
      const from = new Date('2023-11-01T23:00:00.000Z');
      const to = new Date('2023-11-05T23:00:00.000Z');
      const result = await statsController.findMessages({
        from,
        to,
      });
      expect(result).toEqualPayload([
        {
          id: 1,
          name: StatsType.all_messages,
          values: [
            {
              ...statsFixtures[0],
              date: statsFixtures[0].day,
            },
          ],
        },
        {
          id: 2,
          name: StatsType.incoming,
          values: [
            {
              ...statsFixtures[4],
              date: statsFixtures[4].day,
            },
          ],
        },
        {
          id: 3,
          name: StatsType.outgoing,
          values: [],
        },
      ]);
    });
  });

  describe('datum', () => {
    it('should return messages of a given type', async () => {
      const result = await statsController.datum({
        from: new Date('2023-11-06T23:00:00.000Z'),
        to: new Date('2023-11-08T23:00:00.000Z'),
        type: StatsType.outgoing,
      });

      expect(result).toEqualPayload([
        {
          id: 1,
          name: StatsType.outgoing,
          values: [
            {
              ...statsFixtures[5],
              date: statsFixtures[5].day,
            },
          ],
        },
      ]);
    });
  });

  describe('audiance', () => {
    it('should return audiance messages', async () => {
      const result = await statsController.audiance({
        from: new Date('2023-11-01T23:00:00.000Z'),
        to: new Date('2023-11-08T23:00:00.000Z'),
      });

      expect(result).toEqualPayload([
        {
          id: 1,
          name: StatsType.new_users,
          values: [
            {
              ...statsFixtures[1],
              date: statsFixtures[1].day,
            },
          ],
        },
        {
          id: 2,
          name: StatsType.returning_users,
          values: [
            {
              ...statsFixtures[2],
              date: statsFixtures[2].day,
            },
          ],
        },
        {
          id: 3,
          name: StatsType.retention,
          values: [
            {
              ...statsFixtures[3],
              date: statsFixtures[3].day,
            },
          ],
        },
      ]);
    });
  });

  describe('summary', () => {
    it('should return summary stats for the last 24 hours', async () => {
      workflowService.count.mockResolvedValue(2);
      workflowRunService.count
        .mockResolvedValueOnce(11)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(4);
      messageService.count.mockResolvedValue(42);

      const result = await statsController.summary();

      expect(result).toEqual({
        totalWorkflows: 2,
        totalRunsLast24h: 11,
        successRateLast24h: 0.6363636363636364,
        totalMessagesLast24h: 42,
      });
    });
  });

  describe('failedWorkflowRuns', () => {
    it('should pass the provided limit to failed workflow run stats', async () => {
      workflowRunService.count.mockResolvedValue(4);
      workflowRunService.findAndPopulate.mockResolvedValue([]);

      const result = await statsController.failedWorkflowRuns(5);

      expect(result).toEqual({ total: 4, runs: [] });
      expect(workflowRunService.findAndPopulate).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('should default failed workflow run stats to three rows', async () => {
      workflowRunService.count.mockResolvedValue(0);
      workflowRunService.findAndPopulate.mockResolvedValue([]);

      const result = await statsController.failedWorkflowRuns();

      expect(result).toEqual({ total: 0, runs: [] });
      expect(workflowRunService.findAndPopulate).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });
  });

  describe('threadSnapshot', () => {
    it('should return default seven-day thread snapshot stats', async () => {
      const result = await statsController.threadSnapshot({});

      expect(result.xAxis).toHaveLength(7);
      expect(result.series).toEqual([
        {
          type: StatsType.new_threads,
          data: Array(7).fill(0),
        },
        {
          type: StatsType.handoffs,
          data: Array(7).fill(0),
        },
      ]);
    });
  });
});

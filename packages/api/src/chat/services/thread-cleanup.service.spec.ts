/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { SchedulerRegistry } from '@nestjs/schedule';

import { config } from '@/config';
import { LoggerService } from '@/logger/logger.service';

import { ThreadCleanupService } from './thread-cleanup.service';
import { ThreadService } from './thread.service';

describe('ThreadCleanupService', () => {
  const originalEnv = config.env;
  let schedulerRegistry: SchedulerRegistry;
  let threadService: {
    closeInactiveThreads: jest.Mock;
  };
  let logger: {
    log: jest.Mock;
    error: jest.Mock;
  };
  let service: ThreadCleanupService;

  const flushCronCallbacks = async () =>
    await new Promise<void>((resolve) => setImmediate(resolve));

  beforeEach(() => {
    config.env = 'development';
    schedulerRegistry = new SchedulerRegistry();
    threadService = {
      closeInactiveThreads: jest.fn().mockResolvedValue(0),
    };
    logger = {
      log: jest.fn(),
      error: jest.fn(),
    };
    service = new ThreadCleanupService(
      threadService as unknown as ThreadService,
      schedulerRegistry,
      logger as unknown as LoggerService,
    );
  });

  afterEach(() => {
    service.onApplicationShutdown();
    config.env = originalEnv;
    jest.clearAllMocks();
  });

  it('runs cleanup on startup and on each scheduled tick', async () => {
    await service.onApplicationBootstrap();

    const job = schedulerRegistry.getCronJob('thread-inactivity-cleanup');
    expect(job.isActive).toBe(true);
    expect(threadService.closeInactiveThreads).toHaveBeenCalledTimes(1);

    job.fireOnTick();
    await flushCronCallbacks();

    expect(threadService.closeInactiveThreads).toHaveBeenCalledTimes(2);

    service.onApplicationShutdown();
    expect(job.isActive).toBe(false);
    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('does not register a scheduler in test environments', async () => {
    config.env = 'test';

    await service.onApplicationBootstrap();

    expect(threadService.closeInactiveThreads).not.toHaveBeenCalled();
    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('logs cleanup failures without stopping the scheduler', async () => {
    threadService.closeInactiveThreads.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await service.onApplicationBootstrap();

    expect(logger.error).toHaveBeenCalledWith(
      'Unable to close inactive threads',
      expect.any(Error),
    );
    expect(
      schedulerRegistry.getCronJob('thread-inactivity-cleanup').isActive,
    ).toBe(true);
  });
});

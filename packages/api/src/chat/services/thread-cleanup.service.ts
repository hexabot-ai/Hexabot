/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { config } from '@/config';
import { LoggerService } from '@/logger/logger.service';

import { ThreadService } from './thread.service';

@Injectable()
export class ThreadCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private static readonly JOB_NAME = 'thread-inactivity-cleanup';

  private static readonly CLEANUP_SCHEDULE = '0 * * * * *';

  constructor(
    private readonly threadService: ThreadService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (config.env === 'test') {
      return;
    }

    this.removeCleanupJob();
    await this.cleanupInactiveThreads();

    const job = new CronJob(
      ThreadCleanupService.CLEANUP_SCHEDULE,
      () => void this.cleanupInactiveThreads(),
    );
    this.schedulerRegistry.addCronJob(ThreadCleanupService.JOB_NAME, job);
    job.start();
  }

  onApplicationShutdown(): void {
    this.removeCleanupJob();
  }

  private async cleanupInactiveThreads(): Promise<void> {
    try {
      const closedCount = await this.threadService.closeInactiveThreads();
      if (closedCount > 0) {
        this.logger.log(`Closed ${closedCount} inactive thread(s)`);
      }
    } catch (error) {
      this.logger.error('Unable to close inactive threads', error);
    }
  }

  private removeCleanupJob(): void {
    try {
      const job = this.schedulerRegistry.getCronJob(
        ThreadCleanupService.JOB_NAME,
      );
      job.stop();
      this.schedulerRegistry.deleteCronJob(ThreadCleanupService.JOB_NAME);
    } catch {
      // The cleanup job has not been registered yet.
    }
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';

/** How long the work in flight may hold up the shutdown of the app. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

/**
 * Work on workflow runs that no caller waits for, such as the pass of a run
 * an HTTP request claimed: the request answers before the run goes on.
 *
 * The errors of the work are logged, never thrown. The work in flight is
 * tracked: tests wait for it ({@link onIdle}), and the app lets it finish,
 * for a while, before it shuts down; Nest only runs that hook on SIGTERM
 * once `app.enableShutdownHooks()` is set. Work cut short is recovered like
 * a crash, once the claims it held lapse.
 */
@Injectable()
export class WorkflowJobs implements BeforeApplicationShutdown {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly logger: LoggerService) {}

  /**
   * Start work right away, without waiting for it.
   *
   * @param work - The work.
   * @param failureMessage - Message logged when the work throws.
   * @param details - Details logged along with the error.
   */
  spawn(
    work: () => Promise<unknown>,
    failureMessage: string,
    details: Record<string, unknown> = {},
  ): void {
    const job = (async () => {
      try {
        await work();
      } catch (error) {
        this.logger.error(failureMessage, error, details);
      }
    })();
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
  }

  /**
   * Wait until no work is in flight, including work started meanwhile.
   */
  async onIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(this.inFlight);
    }
  }

  /**
   * Let the work in flight finish before the app shuts down, for at most
   * {@link SHUTDOWN_DRAIN_TIMEOUT_MS}.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.inFlight.size === 0) {
      return;
    }

    this.logger.log('Waiting for the workflow runs in flight to settle', {
      count: this.inFlight.size,
    });
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.onIdle(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
  }
}

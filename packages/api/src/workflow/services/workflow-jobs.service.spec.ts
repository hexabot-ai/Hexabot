/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { LoggerService } from '@/logger/logger.service';

import { WorkflowJobs } from './workflow-jobs.service';

/** A promise and the function that resolves it. */
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

describe('WorkflowJobs', () => {
  const logger = { log: jest.fn(), error: jest.fn() };
  let jobs: WorkflowJobs;

  beforeEach(() => {
    jest.resetAllMocks();
    jobs = new WorkflowJobs(logger as unknown as LoggerService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts work right away, without waiting for it', () => {
    const work = jest.fn(() => new Promise(() => {}));

    jobs.spawn(work, 'Work failed');

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('logs the error of work that throws, and never rejects', async () => {
    const error = new Error('boom');

    jobs.spawn(
      async () => {
        throw error;
      },
      'Work failed',
      { runId: 'run-1' },
    );
    jobs.spawn(() => {
      throw error;
    }, 'Work failed early');
    await jobs.onIdle();

    expect(logger.error).toHaveBeenCalledWith('Work failed', error, {
      runId: 'run-1',
    });
    expect(logger.error).toHaveBeenCalledWith('Work failed early', error, {});
  });

  it('waits for the work in flight, including work it starts meanwhile', async () => {
    const first = deferred();
    const second = deferred();
    const done: string[] = [];
    jobs.spawn(async () => {
      await first.promise;
      jobs.spawn(async () => {
        await second.promise;
        done.push('second');
      }, 'Work failed');
      done.push('first');
    }, 'Work failed');

    const idle = jobs.onIdle().then(() => done.push('idle'));
    first.resolve();
    await Promise.resolve();
    second.resolve();
    await idle;

    expect(done).toEqual(['first', 'second', 'idle']);
  });

  describe('when the app shuts down', () => {
    it('lets the work in flight finish', async () => {
      const work = deferred();
      let finished = false;
      jobs.spawn(async () => {
        await work.promise;
        finished = true;
      }, 'Work failed');

      const shutdown = jobs.beforeApplicationShutdown();
      work.resolve();
      await shutdown;

      expect(finished).toBe(true);
    });

    it('stops waiting for work that outlasts the drain timeout', async () => {
      jest.useFakeTimers();
      jobs.spawn(() => new Promise(() => {}), 'Work failed');

      const shutdown = jobs.beforeApplicationShutdown();
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(shutdown).resolves.toBeUndefined();
    });

    it('returns right away when no work is in flight', async () => {
      await expect(jobs.beforeApplicationShutdown()).resolves.toBeUndefined();
      expect(logger.log).not.toHaveBeenCalled();
    });
  });
});

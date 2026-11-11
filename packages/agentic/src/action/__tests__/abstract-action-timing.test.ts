/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { BaseWorkflowContext } from '../../context';
import { Settings } from '../../dsl.types';
import { EventEmitterLike } from '../../workflow-event-emitter';
import { AbstractAction } from '../abstract-action';
import { ActionExecutionArgs, ActionMetadata } from '../action.types';

const InputSchema = z.object({ value: z.number() });
const OutputSchema = z.object({ result: z.number() });

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;
const NoSettingsSchema = z.any();
type NoSettings = unknown;

class TestContext extends BaseWorkflowContext {
  public eventEmitter: EventEmitterLike = { emit: jest.fn(), on: jest.fn() };

  constructor() {
    super({});
  }
}

class HarnessedAction extends AbstractAction<
  Input,
  Output,
  TestContext,
  NoSettings
> {
  constructor(
    private readonly executor: (
      args: ActionExecutionArgs<Input, TestContext, NoSettings>,
    ) => Promise<Output>,
  ) {
    const metadata: ActionMetadata<Input, Output, NoSettings> = {
      name: 'timing_action',
      description: 'Action used to validate retry and timeout behavior.',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      settingsSchema: NoSettingsSchema,
    };

    super(metadata);
  }

  execute(
    args: ActionExecutionArgs<Input, TestContext, NoSettings>,
  ): Promise<Output> {
    return this.executor(args);
  }
}

describe('AbstractAction timing and retries', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fails when execution exceeds the configured timeout', async () => {
    jest.useFakeTimers();
    let attempts = 0;

    const action = new HarnessedAction(async () => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));

      return { result: 1 };
    });
    const settings: Partial<Settings> = {
      timeout_ms: 50,
      retries: {
        enabled: true,
        max_attempts: 1,
        backoff_ms: 0,
        max_delay_ms: 0,
        jitter: 0,
        multiplier: 1,
      },
    };
    const runPromise = action.run({ value: 1 }, new TestContext(), settings);
    const runExpectation =
      expect(runPromise).rejects.toThrow(/timeout of 50ms/);
    await jest.advanceTimersByTimeAsync(60);

    await runExpectation;
    expect(attempts).toBe(1);
  });

  it('applies exponential backoff capped by max_delay_ms', async () => {
    jest.useFakeTimers();

    let attempts = 0;
    const attemptTimestamps: number[] = [];
    const action = new HarnessedAction(async () => {
      attempts += 1;
      attemptTimestamps.push(Date.now());

      if (attempts < 3) {
        throw new Error('Retry me');
      }

      return { result: attempts };
    });
    const runPromise = action.run({ value: 1 }, new TestContext(), {
      timeout_ms: 0,
      retries: {
        enabled: true,
        max_attempts: 3,
        backoff_ms: 10,
        max_delay_ms: 15,
        jitter: 0,
        multiplier: 2,
      },
    });

    await Promise.resolve();
    expect(attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(9);
    expect(attempts).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);

    await jest.advanceTimersByTimeAsync(14);
    expect(attempts).toBe(2);
    await jest.advanceTimersByTimeAsync(1);

    await expect(runPromise).resolves.toEqual({ result: 3 });

    expect(attempts).toBe(3);
    expect(attemptTimestamps[1] - attemptTimestamps[0]).toBe(10);
    expect(attemptTimestamps[2] - attemptTimestamps[1]).toBe(15);
  });

  it('uses jitter to randomize retry delays', async () => {
    jest.useFakeTimers();

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(1);
    let attempts = 0;
    const attemptTimestamps: number[] = [];
    const action = new HarnessedAction(async () => {
      attempts += 1;
      attemptTimestamps.push(Date.now());

      if (attempts < 2) {
        throw new Error('Intermittent');
      }

      return { result: attempts };
    });
    const runPromise = action.run({ value: 1 }, new TestContext(), {
      timeout_ms: 0,
      retries: {
        enabled: true,
        max_attempts: 2,
        backoff_ms: 100,
        max_delay_ms: 0,
        jitter: 0.5,
        multiplier: 1,
      },
    });

    await Promise.resolve();
    expect(attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(149);
    expect(attempts).toBe(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(runPromise).resolves.toEqual({ result: 2 });

    expect(attempts).toBe(2);
    expect(randomSpy).toHaveBeenCalled();
    expect(attemptTimestamps[1] - attemptTimestamps[0]).toBe(150);
  });
  it('runs once without a retries block', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('Boom'));
    const action = new HarnessedAction(execute);

    await expect(action.run({ value: 1 }, new TestContext())).rejects.toThrow(
      'Boom',
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('runs once when retries are disabled, whatever max_attempts says', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('Boom'));
    const action = new HarnessedAction(execute);

    await expect(
      action.run({ value: 1 }, new TestContext(), {
        retries: { enabled: false, max_attempts: 3, backoff_ms: 0 },
      } as Partial<Settings>),
    ).rejects.toThrow('Boom');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries when a retries block leaves enabled out', async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error('Boom'))
      .mockRejectedValueOnce(new Error('Boom'))
      .mockResolvedValue({ result: 3 });
    const action = new HarnessedAction(execute);

    await expect(
      action.run({ value: 1 }, new TestContext(), {
        retries: { max_attempts: 3, backoff_ms: 0 },
      } as Partial<Settings>),
    ).resolves.toEqual({ result: 3 });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('gives up after max_attempts and throws the last error', async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error('First'))
      .mockRejectedValueOnce(new Error('Last'));
    const action = new HarnessedAction(execute);

    await expect(
      action.run({ value: 1 }, new TestContext(), {
        retries: { max_attempts: 2, backoff_ms: 0 },
      } as Partial<Settings>),
    ).rejects.toThrow('Last');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('retries right away when the jittered delay rounds to zero', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error('Boom'))
      .mockResolvedValue({ result: 2 });
    const action = new HarnessedAction(execute);

    // A jitter of 1 with Math.random() at 0 scales the delay by 0.
    await expect(
      action.run({ value: 1 }, new TestContext(), {
        retries: { max_attempts: 2, backoff_ms: 100, jitter: 1 },
      } as Partial<Settings>),
    ).resolves.toEqual({ result: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('stops retrying once the signal is aborted', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const execute = jest.fn().mockRejectedValue(new Error('Boom'));
    const action = new HarnessedAction(execute);
    const runPromise = action.run(
      { value: 1 },
      new TestContext(),
      {
        retries: { max_attempts: 3, backoff_ms: 100 },
      } as Partial<Settings>,
      undefined,
      controller.signal,
    );
    const outcome = expect(runPromise).rejects.toThrow('stopped');

    await jest.advanceTimersByTimeAsync(50);
    controller.abort(new Error('stopped'));
    await outcome;
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

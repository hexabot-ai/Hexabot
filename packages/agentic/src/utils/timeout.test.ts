/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowCancellationError } from '../errors';

import { sleep, withTimeout } from './timeout';

const never = () => new Promise<never>(() => undefined);

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('settles with the promise when there is neither a timeout nor a signal', async () => {
    jest.useFakeTimers();
    const promise = Promise.resolve('value');

    await expect(withTimeout(promise)).resolves.toBe('value');
    await expect(withTimeout(promise, 0)).resolves.toBe('value');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('settles with the promise and detaches the timer and the signal', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');

    await expect(
      withTimeout(Promise.resolve('value'), 1_000, controller.signal),
    ).resolves.toBe('value');
    expect(jest.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));

    const error = new Error('boom');
    await expect(
      withTimeout(Promise.reject(error), 1_000, controller.signal),
    ).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects once the timeout elapses', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const result = withTimeout(never(), 50, controller.signal);

    jest.advanceTimersByTime(50);

    await expect(result).rejects.toThrow(
      'Step execution exceeded timeout of 50ms',
    );
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('applies a timeout without a signal', async () => {
    jest.useFakeTimers();
    const late = withTimeout(never(), 50);

    jest.advanceTimersByTime(50);
    await expect(late).rejects.toThrow(
      'Step execution exceeded timeout of 50ms',
    );
    await expect(withTimeout(Promise.resolve('value'), 50)).resolves.toBe(
      'value',
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the abort reason and clears the timeout', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const result = withTimeout(never(), 1_000, controller.signal);
    const reason = new Error('stopped');

    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects right away when the signal is already aborted', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(
      withTimeout(never(), 1_000, controller.signal),
    ).rejects.toBeInstanceOf(WorkflowCancellationError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the first outcome when a later one arrives', async () => {
    const controller = new AbortController();
    let resolve: (value: string) => void = () => undefined;
    const result = withTimeout(
      new Promise<string>((done) => {
        resolve = done;
      }),
      undefined,
      controller.signal,
    );
    const reason = new Error('first');

    controller.abort(reason);
    resolve('late');

    await expect(result).rejects.toBe(reason);
  });
});

describe('sleep', () => {
  it('resolves after the duration', async () => {
    jest.useFakeTimers();
    const done = jest.fn();
    const pending = sleep(100).then(done);

    jest.advanceTimersByTime(99);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await pending;
    expect(done).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('rejects with the abort reason and clears its timer', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const pending = sleep(100, controller.signal);
    const reason = new Error('stopped');

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => sleep(100, controller.signal)).toThrow(
      WorkflowCancellationError,
    );
  });
});

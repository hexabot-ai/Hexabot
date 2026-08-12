/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ChannelInboundEvent } from '@/channel/lib/inbound-events';

import { HelperService } from './helper.service';
import { InboundMiddlewareService } from './inbound-middleware.service';
import {
  BaseMiddlewareHelper,
  InboundMiddlewareNext,
} from './lib/base-middleware-helper';
import { HelperType } from './types';

/** Minimal middleware double driven by the provided `handle` callback. */
const makeMiddleware = (
  name: string,
  priority: number,
  handle: (
    event: ChannelInboundEvent,
    next: InboundMiddlewareNext,
  ) => Promise<void>,
): BaseMiddlewareHelper =>
  ({
    getName: () => name,
    getType: () => HelperType.MIDDLEWARE,
    getPriority: () => priority,
    handle,
  }) as unknown as BaseMiddlewareHelper;

describe('InboundMiddlewareService', () => {
  let service: InboundMiddlewareService;
  let helperService: jest.Mocked<Pick<HelperService, 'getAllByType'>>;
  const event = {} as ChannelInboundEvent;

  beforeEach(() => {
    helperService = { getAllByType: jest.fn() };
    service = new InboundMiddlewareService(
      helperService as unknown as HelperService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('runs middlewares in ascending priority order around next', async () => {
    const calls: string[] = [];
    const next = jest.fn(async () => {
      calls.push('downstream');
    });
    helperService.getAllByType.mockReturnValue([
      makeMiddleware('second', 10, async (_e, n) => {
        calls.push('second:before');
        await n();
        calls.push('second:after');
      }),
      makeMiddleware('first', -10, async (_e, n) => {
        calls.push('first:before');
        await n();
        calls.push('first:after');
      }),
    ] as any);

    await service.run(event, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'first:before',
      'second:before',
      'downstream',
      'second:after',
      'first:after',
    ]);
  });

  it('does not run downstream when a middleware drops (skips next)', async () => {
    const next = jest.fn();
    const laterHandle = jest.fn();
    helperService.getAllByType.mockReturnValue([
      makeMiddleware('dropper', 0, async () => {
        // deliberately does not call next()
      }),
      makeMiddleware('later', 10, laterHandle as any),
    ] as any);

    await service.run(event, next);

    expect(next).not.toHaveBeenCalled();
    expect(laterHandle).not.toHaveBeenCalled();
  });

  it('propagates a downstream failure to the wrapping middleware', async () => {
    const next = jest.fn().mockRejectedValue(new Error('downstream boom'));
    const seen: string[] = [];
    helperService.getAllByType.mockReturnValue([
      makeMiddleware('observer', 0, async (_e, n) => {
        try {
          await n();
        } catch (err) {
          seen.push((err as Error).message);
          throw err;
        }
      }),
    ] as any);

    await expect(service.run(event, next)).rejects.toThrow('downstream boom');
    expect(seen).toEqual(['downstream boom']);
  });

  it('throws when a middleware calls next() more than once', async () => {
    const next = jest.fn().mockResolvedValue(undefined);
    helperService.getAllByType.mockReturnValue([
      makeMiddleware('double', 0, async (_e, n) => {
        await n();
        await n();
      }),
    ] as any);

    await expect(service.run(event, next)).rejects.toThrow(
      'called multiple times',
    );
  });

  it('runs next once when no middleware is registered', async () => {
    const next = jest.fn().mockResolvedValue(undefined);
    helperService.getAllByType.mockReturnValue([] as any);

    await service.run(event, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

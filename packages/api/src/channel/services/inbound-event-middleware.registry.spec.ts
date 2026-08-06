/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DiscoveryService } from '@nestjs/core';

import {
  InboundEventMiddleware,
  InboundEventMiddlewareNext,
  InboundEventMiddlewareProvider,
} from '../lib/inbound-event-middleware';
import type ChannelInboundEvent from '../lib/inbound-events/channel-inbound-event';

import { InboundEventMiddlewareRegistry } from './inbound-event-middleware.registry';

type MiddlewareHandler = (
  event: ChannelInboundEvent,
  next: InboundEventMiddlewareNext,
) => Promise<void>;

@InboundEventMiddlewareProvider()
class TestMiddleware implements InboundEventMiddleware {
  constructor(
    readonly order: number | undefined,
    private readonly handler: MiddlewareHandler,
  ) {}

  async handle(
    event: ChannelInboundEvent,
    next: InboundEventMiddlewareNext,
  ): Promise<void> {
    await this.handler(event, next);
  }
}

@InboundEventMiddlewareProvider()
class InvalidMiddleware {}

class UnmarkedMiddleware {
  async handle(
    _event: ChannelInboundEvent,
    next: InboundEventMiddlewareNext,
  ): Promise<void> {
    await next();
  }
}

const event = {} as ChannelInboundEvent;
const buildRegistry = (
  providers: Array<{
    instance?: unknown;
    metatype?: unknown;
    name?: string;
  }>,
): InboundEventMiddlewareRegistry =>
  new InboundEventMiddlewareRegistry({
    getProviders: () => providers,
  } as unknown as DiscoveryService);
const provider = (instance: object, name = instance.constructor.name) => ({
  instance,
  metatype: instance.constructor,
  name,
});

describe('InboundEventMiddlewareRegistry', () => {
  it('runs middleware in stable ascending order with onion-style unwinding', async () => {
    const calls: string[] = [];
    const middleware = (name: string, order?: number) =>
      new TestMiddleware(order, async (_event, next) => {
        calls.push(`before:${name}`);
        await next();
        calls.push(`after:${name}`);
      });
    const registry = buildRegistry([
      provider(middleware('late', 10)),
      provider(middleware('default-a')),
      provider(middleware('early', -10)),
      provider(middleware('default-b')),
    ]);

    await registry.dispatch(event, async () => {
      calls.push('handler');
    });

    expect(calls).toEqual([
      'before:early',
      'before:default-a',
      'before:default-b',
      'before:late',
      'handler',
      'after:late',
      'after:default-b',
      'after:default-a',
      'after:early',
    ]);
  });

  it('runs the downstream handler directly when no middleware is registered', async () => {
    const next = jest.fn().mockResolvedValue(undefined);
    const registry = buildRegistry([
      provider(new UnmarkedMiddleware(), 'UnmarkedMiddleware'),
    ]);

    await registry.dispatch(event, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('short-circuits when middleware returns without calling next', async () => {
    const next = jest.fn().mockResolvedValue(undefined);
    const registry = buildRegistry([
      provider(new TestMiddleware(0, async () => undefined)),
    ]);

    await registry.dispatch(event, next);

    expect(next).not.toHaveBeenCalled();
  });

  it('propagates middleware errors', async () => {
    const registry = buildRegistry([
      provider(
        new TestMiddleware(0, async () => {
          throw new Error('middleware failed');
        }),
      ),
    ]);

    await expect(
      registry.dispatch(event, async () => undefined),
    ).rejects.toThrow('middleware failed');
  });

  it('rejects repeated next calls before running the handler twice', async () => {
    const next = jest.fn().mockResolvedValue(undefined);
    const registry = buildRegistry([
      provider(
        new TestMiddleware(0, async (_event, invokeNext) => {
          await invokeNext();
          await invokeNext();
        }),
      ),
    ]);

    await expect(registry.dispatch(event, next)).rejects.toThrow(
      'next() called multiple times',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects decorated providers without a handle method', async () => {
    const registry = buildRegistry([
      provider(new InvalidMiddleware(), 'InvalidMiddleware'),
    ]);

    await expect(
      registry.dispatch(event, async () => undefined),
    ).rejects.toThrow('missing a valid handle() method');
  });

  it('rejects non-finite middleware order values', async () => {
    const registry = buildRegistry([
      provider(new TestMiddleware(Number.NaN, async () => undefined)),
    ]);

    await expect(
      registry.dispatch(event, async () => undefined),
    ).rejects.toThrow('has an invalid order');
  });
});

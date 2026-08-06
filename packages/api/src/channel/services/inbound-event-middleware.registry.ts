/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

import {
  INBOUND_EVENT_MIDDLEWARE_METADATA,
  InboundEventMiddleware,
  InboundEventMiddlewareNext,
} from '../lib/inbound-event-middleware';
import type ChannelInboundEvent from '../lib/inbound-events/channel-inbound-event';

type DiscoveredProvider = {
  instance?: unknown;
  metatype?: unknown;
  name?: string;
};

type DiscoveredMiddleware = {
  discoveryIndex: number;
  middleware: InboundEventMiddleware;
};

@Injectable()
export class InboundEventMiddlewareRegistry implements OnModuleInit {
  private initialized = false;

  private middlewares: InboundEventMiddleware[] = [];

  constructor(private readonly discoveryService: DiscoveryService) {}

  onModuleInit(): void {
    this.ensureInitialized();
  }

  async dispatch(
    event: ChannelInboundEvent,
    next: InboundEventMiddlewareNext,
  ): Promise<void> {
    this.ensureInitialized();

    let currentIndex = -1;
    const invoke = async (index: number): Promise<void> => {
      if (index <= currentIndex) {
        throw new Error(
          'Inbound event middleware next() called multiple times',
        );
      }

      currentIndex = index;
      const middleware = this.middlewares[index];
      if (!middleware) {
        await next();

        return;
      }

      await middleware.handle(event, () => invoke(index + 1));
    };

    await invoke(0);
  }

  private ensureInitialized(): void {
    if (this.initialized) {
      return;
    }

    this.middlewares = this.discoverMiddlewares()
      .sort((left, right) => {
        const orderDifference =
          (left.middleware.order ?? 0) - (right.middleware.order ?? 0);

        return orderDifference || left.discoveryIndex - right.discoveryIndex;
      })
      .map(({ middleware }) => middleware);
    this.initialized = true;
  }

  private discoverMiddlewares(): DiscoveredMiddleware[] {
    return this.discoveryService
      .getProviders()
      .flatMap((provider: DiscoveredProvider, discoveryIndex) => {
        if (!this.hasMiddlewareMetadata(provider)) {
          return [];
        }

        if (!this.isMiddlewareInstance(provider.instance)) {
          throw new Error(
            `Inbound event middleware provider ${
              provider.name ?? 'unknown'
            } is missing a valid handle() method`,
          );
        }

        if (
          provider.instance.order !== undefined &&
          !Number.isFinite(provider.instance.order)
        ) {
          throw new Error(
            `Inbound event middleware provider ${
              provider.name ?? provider.instance.constructor.name
            } has an invalid order`,
          );
        }

        return [
          {
            discoveryIndex,
            middleware: provider.instance,
          },
        ];
      });
  }

  private hasMiddlewareMetadata(provider: DiscoveredProvider): boolean {
    const metatype =
      typeof provider.metatype === 'function' ? provider.metatype : null;
    const instanceConstructor =
      provider.instance && typeof provider.instance === 'object'
        ? provider.instance.constructor
        : null;

    return [metatype, instanceConstructor].some(
      (target) =>
        !!target &&
        Reflect.getMetadata(INBOUND_EVENT_MIDDLEWARE_METADATA, target) === true,
    );
  }

  private isMiddlewareInstance(
    value: unknown,
  ): value is InboundEventMiddleware {
    return (
      typeof value === 'object' &&
      value !== null &&
      'handle' in value &&
      typeof value.handle === 'function'
    );
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';

import type ChannelInboundEvent from './inbound-events/channel-inbound-event';

export const INBOUND_EVENT_MIDDLEWARE_METADATA = Symbol(
  'INBOUND_EVENT_MIDDLEWARE_METADATA',
);

export type InboundEventMiddlewareNext = () => Promise<void>;

export interface InboundEventMiddleware {
  readonly order?: number;

  handle(
    event: ChannelInboundEvent,
    next: InboundEventMiddlewareNext,
  ): Promise<void>;
}

/**
 * Marks an injectable provider for discovery as inbound channel middleware.
 */
export const InboundEventMiddlewareProvider = (): ClassDecorator =>
  applyDecorators(
    Injectable(),
    SetMetadata(INBOUND_EVENT_MIDDLEWARE_METADATA, true),
  );

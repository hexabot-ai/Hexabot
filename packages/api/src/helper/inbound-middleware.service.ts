/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';

import type { ChannelInboundEvent } from '@/channel/lib/inbound-events/channel-inbound-event';

import { HelperService } from './helper.service';
import { InboundMiddlewareNext } from './lib/base-middleware-helper';
import { HelperType } from './types';

/**
 * Composes the registered {@link HelperType.MIDDLEWARE} helpers into an
 * onion-style chain around the handling of an inbound channel event.
 *
 * Invoked by the transports via `ChannelHandler.dispatchInboundEvent`, so the
 * chain wraps all post-decode processing (subscriber resolution, uploads,
 * thread resolution, broadcast, dispatch) uniformly for every channel (messages
 * and status events), with that processing passed as the innermost `next`. A
 * middleware that does not call `next()` drops the event; one that awaits
 * `next()` observes downstream success or failure.
 *
 * Helpers run in ascending `getPriority()` order (outermost first). Errors are
 * **not** swallowed — a throwing middleware (or downstream) propagates to the
 * transport, which logs it and abandons the event; middleware that only observes
 * must guard its own errors and still call `next()`.
 */
@Injectable()
export class InboundMiddlewareService {
  constructor(private readonly helperService: HelperService) {}

  /**
   * Runs the middleware chain around `next`.
   *
   * @param event - The inbound channel event (message or status).
   * @param next - The dispatch to wrap (emit to the event's chatbot hook).
   */
  async run(
    event: ChannelInboundEvent,
    next: InboundMiddlewareNext,
  ): Promise<void> {
    const middlewares = this.helperService
      .getAllByType(HelperType.MIDDLEWARE)
      .sort((a, b) => a.getPriority() - b.getPriority());

    let currentIndex = -1;
    const invoke = async (index: number): Promise<void> => {
      if (index <= currentIndex) {
        throw new Error('Inbound middleware next() called multiple times');
      }

      currentIndex = index;
      const middleware = middlewares[index];
      if (!middleware) {
        await next();

        return;
      }

      await middleware.handle(event, () => invoke(index + 1));
    };

    await invoke(0);
  }
}

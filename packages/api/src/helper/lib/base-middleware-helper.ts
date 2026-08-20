/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ChannelInboundEvent } from '@/channel/lib/inbound-events/channel-inbound-event';

import { HelperName, HelperType } from '../types';

import BaseHelper from './base-helper';

/**
 * Runs the remainder of the middleware chain and, at its core, all post-decode
 * processing of the event: subscriber resolution, attachment persistence and
 * uploads, thread resolution, socket broadcasts, and emission to the event's
 * chatbot hook (which drives the workflow engine for messages, or the relevant
 * listeners for status events).
 *
 * Awaiting it lets a middleware observe downstream success (it resolves) or
 * failure (it rejects) — enabling patterns such as committing a deduplication
 * claim only after the event was handled, or measuring end-to-end turn
 * duration.
 */
export type InboundMiddlewareNext = () => Promise<void>;

/**
 * Base class for **middleware** helpers — an onion-style chain of pluggable
 * pre-processors that wrap the handling of every inbound channel event (user
 * messages *and* status events: delivery, read, typing, echo, ...).
 *
 * The chain is executed by each transport through
 * `ChannelHandler.dispatchInboundEvent(event, next)`, which wraps **all
 * post-decode processing** as `next`. A middleware therefore runs before any
 * side effect — subscriber resolution/creation, attachment uploads, thread
 * resolution, broadcasts, and hook emission. Each helper receives the event and
 * a `next` continuation:
 *
 * - call `await next()` to let the event proceed (optionally after mutating it
 *   in place — e.g. Speech-to-Text sets the transcript as text);
 * - **do not** call `next()` to drop the event (e.g. deduplicate provider
 *   redeliveries, rate limit a contact) — none of the above side effects run;
 * - wrap `await next()` in `try/catch`/`try/finally` to react to downstream
 *   success or failure (e.g. roll back a dedup claim, record metrics).
 *
 * Helpers that are message-specific should narrow on the event type (e.g.
 * `event instanceof MessageInboundEvent`) and pass other events straight
 * through via `next()`.
 *
 * Unlike storage/RAG helpers (where a single "default" helper is selected), all
 * registered middleware helpers participate, ordered by {@link getPriority}.
 *
 * A helper that throws propagates the error to the caller of the emit; a helper
 * that only observes must guard its own errors and still call `next()`.
 */
export abstract class BaseMiddlewareHelper<
  N extends HelperName = HelperName,
> extends BaseHelper<N> {
  protected readonly type: HelperType = HelperType.MIDDLEWARE;

  constructor(name: N) {
    super(name);
  }

  /**
   * Execution order within the chain. Lower runs first (outermost onion layer).
   * Defaults to `0`.
   *
   * Override to position a helper relative to others (e.g. deduplication before
   * heavier transforms such as Speech-to-Text).
   */
  public getPriority(): number {
    return 0;
  }

  /**
   * Wrap the dispatch of an inbound channel event.
   *
   * @param event - The inbound event (message or status).
   * @param next - Continuation that runs the rest of the chain and the actual
   *   dispatch. Call it to proceed; omit it to drop the event.
   */
  abstract handle(
    event: ChannelInboundEvent,
    next: InboundMiddlewareNext,
  ): Promise<void>;
}

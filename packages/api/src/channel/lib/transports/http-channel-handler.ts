/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Source, StdEventType, Subscriber } from '@hexabot-ai/types';
import { Inject, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';

import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';

import {
  SubscriberResolution,
  SubscriberResolver,
} from '../../services/subscriber-resolver.service';
import { ChannelName } from '../../types';
import ChannelHandler from '../Handler';
import type ChannelInboundEvent from '../inbound-events/channel-inbound-event';
import type MessageInboundEvent from '../inbound-events/message-inbound-event';

/**
 * Abstract base for channels that receive events over plain HTTP webhooks
 * (Facebook Messenger, WhatsApp Business, Slack, Discord, …).
 *
 * Provides the shared webhook dispatch loop so implementors only need to
 * supply:
 *  - `decode(req)` — parse the raw request body into typed inbound events
 *  - `sendMessage(event, envelope, options)` — deliver outbound messages via
 *    the platform's own HTTP API
 *  - `getSubscriberData(event)` — map the platform's user object to a
 *    Hexabot SubscriberCreateDto
 *
 * Optional overrides for common HTTP webhook concerns:
 *  - `verifyWebhook(req, res, source)` — respond to the platform's subscription
 *    handshake (e.g. Facebook hub.verify challenge)
 *  - `verifySignature(req, res, source)` — authenticate the incoming payload (e.g.
 *    HMAC-SHA256 as used by Meta, Slack, Discord)
 *  - `resolveSubscriber(event)` — find or create a Hexabot subscriber from
 *    the event's sender identity (default: SubscriberResolver.resolve())
 *  - `normalizeSenderId(rawId)` — transform the platform's sender identifier
 *    before it is used as a Hexabot foreignId
 */
@Injectable()
export abstract class HttpChannelHandler<N extends ChannelName>
  extends ChannelHandler<N>
  implements SubscriberResolution<N>
{
  @Inject(SubscriberResolver)
  private readonly subscriberResolver: SubscriberResolver;

  /**
   * Entry point called by ChannelService / WebhookController.
   *
   * - GET  → `verifyWebhook()` (subscription handshake)
   * - POST → `verifySignature()` → acknowledge 200 immediately → decode +
   *          dispatch events asynchronously
   *
   * Sending 200 before event processing is intentional: most messaging
   * platforms retry if they don't receive a fast acknowledgement, leading to
   * duplicate events.
   */
  async handle(
    req: Request | SocketRequest,
    res: Response | SocketResponse,
    source: Source,
    workflowId?: string,
  ): Promise<void> {
    if ((req as Request).method === 'GET') {
      return this.verifyWebhook(req as Request, res as Response, source);
    }

    try {
      await this.verifySignature(req as Request, res as Response, source);
    } catch (err) {
      this.logger.warn('Webhook signature verification failed', err);
      (res as Response).status(401).json({ error: 'Unauthorized' });

      return;
    }

    let events: ChannelInboundEvent<N>[];
    try {
      events = await this.decode(req as Request, source);
    } catch (err) {
      this.logger.warn('Failed to decode webhook payload', err);
      (res as Response).status(400).json({ error: 'Bad Request' });

      return;
    }

    // Acknowledge the platform before processing — prevents retries.
    (res as Response).status(200).json({ success: true });

    for (const event of events) {
      event.setHandler(
        this as unknown as Parameters<typeof event.setHandler>[0],
      );
      event.setSourceContext(source.id, source.settings);
      if (workflowId) {
        event.setWorkflowId(workflowId);
      }

      try {
        await this.dispatchInboundEvent(event, async () => {
          const subscriber = await this.resolveSubscriber(event);
          event.setInitiator(subscriber);

          if (event.getEventType() === StdEventType.message) {
            const messageEvent = event as unknown as MessageInboundEvent<N>;
            await messageEvent.preprocess();
            await this.channelEventBus.emitMessage(messageEvent);
          } else {
            this.channelEventBus.emitStatusEvent(event);
          }
        });
      } catch (err) {
        this.logger.error('Failed to process webhook event', err);
      }
    }
  }

  /**
   * Respond to the platform's webhook subscription handshake (GET request).
   *
   * Default implementation returns HTTP 200 OK. Override to handle
   * challenge-response flows (e.g. Facebook's `hub.challenge` parameter).
   */
  protected async verifyWebhook(
    _req: Request,
    res: Response,
    _source: Source,
  ): Promise<void> {
    res.sendStatus(200);
  }

  /**
   * Verify the authenticity of an incoming POST webhook payload.
   *
   * Default is a no-op (accepts all requests). Override to validate
   * HMAC-SHA256 signatures or other platform-specific auth schemes.
   * Throw any error to reject the request with HTTP 401.
   */
  protected async verifySignature(
    _req: Request,
    _res: Response,
    _source: Source,
  ): Promise<void> {}

  /**
   * Parse the raw HTTP request body into an array of typed inbound events.
   *
   * Return multiple events when the platform batches several interactions in
   * one webhook call (e.g. Facebook's `entry[].messaging[]` structure).
   */
  protected abstract decode(
    req: Request,
    source: Source,
  ): Promise<ChannelInboundEvent<N>[]>;

  /**
   * Find the Hexabot subscriber that corresponds to the event's sender, or
   * create one if they are new.
   *
   * Delegates to SubscriberResolver using this handler as the SubscriberResolution
   * delegate (provides `getSubscriberData` and optionally `normalizeSenderId`).
   *
   * Override when the platform requires a different identity resolution strategy
   * (e.g. recipient-based lookup for delivery receipts, token exchange, etc.).
   */
  protected async resolveSubscriber(
    event: ChannelInboundEvent<N>,
  ): Promise<Subscriber> {
    return this.subscriberResolver.resolve(event, this);
  }

  /**
   * Transform a raw sender identifier from the platform before it is stored
   * as a Hexabot foreignId.
   *
   * Default: return the identifier unchanged.
   * Override to apply prefixes, case normalisation, or other channel-specific
   * transformations.
   */
  normalizeSenderId(rawSenderId: string): string {
    return rawSenderId;
  }
}

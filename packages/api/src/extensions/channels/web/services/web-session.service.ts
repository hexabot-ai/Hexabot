/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Subscriber, Thread } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { Response } from 'express';

import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { ThreadService } from '@/chat/services/thread.service';
import { LoggerService } from '@/logger/logger.service';
import { isAllowedOrigin, normalizeOrigin } from '@/utils/helpers/origin';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';

/**
 * Handles all web-channel session and CORS concerns.
 *
 * Instantiated per-channel through `@ExtensionInject()` on the channel handler.
 * The base `ChannelHandler` resolves these providers during `onModuleInit()` via
 * `ModuleRef.create()`, so each channel gets its own DI-scoped instance.
 */
@Injectable()
export class WebSessionService {
  constructor(
    private readonly subscriberService: SubscriberService,
    private readonly threadService: ThreadService,
    private readonly logger: LoggerService,
  ) {}

  normalizeThreadId(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const v = raw.trim();

    return v.length > 0 ? v : undefined;
  }

  getThreadIdFromQuery(req: SocketRequest): string | undefined {
    const raw = req.query.thread_id;

    return this.normalizeThreadId(Array.isArray(raw) ? raw[0] : raw);
  }

  getThreadIdFromBody(req: SocketRequest): string | undefined {
    const body = req.body as { thread_id?: unknown } | undefined;

    return this.normalizeThreadId(body?.thread_id);
  }

  /**
   * Validates the request Origin against the configured allow-list and sets
   * the appropriate CORS response headers. Throws on any violation.
   *
   * @param req - Socket request
   * @param res - Socket request
   * @param allowedDomains - Comma-separated list of allowed origins (or "*").
   */
  async validateCors(
    req: SocketRequest,
    res: Response | SocketResponse,
    allowedDomains: string,
  ): Promise<void> {
    const origin = req.headers?.origin;

    if (!origin) {
      this.logger.debug('No origin ', req.headers);
      throw new Error('CORS - No origin provided!');
    }

    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin) {
      throw new Error('CORS - Invalid origin!');
    }

    if (!isAllowedOrigin(normalizedOrigin, allowedDomains)) {
      res.set('Access-Control-Allow-Origin', '');
      this.logger.debug('No origin found ', origin);
      throw new Error('CORS - Domain not allowed!');
    }

    res.set('Access-Control-Allow-Origin', normalizedOrigin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Expose-Headers', '');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.set('Access-Control-Allow-Headers', 'content-type');
    }
  }

  /**
   * Returns the subscriber from the active session, or attempts to recover it
   * from the message `author` field. Writes a 403 and returns null when no
   * valid identity can be established.
   *
   * @param req
   * @param res
   */
  async validateSession(
    req: SocketRequest,
    res: Response | SocketResponse,
    sourceId: string,
  ): Promise<Subscriber | null> {
    if (req.session.web?.profile?.id && req.session.web.sourceId === sourceId) {
      return req.session.web.profile;
    }

    const body = req.body as { author?: unknown } | undefined;
    const authorForeignId =
      typeof body?.author === 'string' && body.author.trim().length > 0
        ? body.author.trim()
        : undefined;

    if (authorForeignId) {
      try {
        const subscriber = await this.subscriberService.findOneByForeignId(
          authorForeignId,
          sourceId,
        );
        if (subscriber) {
          const thread = await this.threadService.resolveThread({
            subscriberId: subscriber.id,
            explicitThreadId:
              this.getThreadIdFromBody(req) ?? this.getThreadIdFromQuery(req),
          });
          req.session.web = {
            profile: subscriber,
            threadId: thread?.id,
            sourceId,
          };
          this.logger.debug(
            `Recovered missing web session from author ${authorForeignId}`,
          );

          return subscriber;
        }
      } catch (error) {
        this.logger.warn(
          `Unable to recover missing session from author ${authorForeignId}`,
          error,
        );
      }
    }

    this.logger.warn('No session ID to be found!', req.session);
    res.status(403).json({ err: 'Web Channel Handler : Unauthorized!' });

    return null;
  }

  /**
   * Returns the existing subscriber for this session, or creates a new one
   * using the provided factory. Updates `req.session.web` accordingly.
   *
   * @param req
   * @param buildProfile - Called only when no session exists; returns the DTO
   *   for the new subscriber (channel name, generated ID, etc. are caller's
   *   responsibility since they are channel-specific).
   */
  async getOrCreateSession(
    req: SocketRequest,
    sourceId: string,
    buildProfile: () => SubscriberCreateDto,
  ): Promise<Subscriber> {
    const sessionProfile = req.session.web?.profile;

    if (sessionProfile && req.session.web?.sourceId === sourceId) {
      const subscriber = await this.subscriberService.findOne(
        sessionProfile.id,
      );
      if (!subscriber || !req.session.web) {
        throw new Error('Subscriber session was not persisted in DB');
      }
      const thread = await this.threadService.resolveThread({
        subscriberId: subscriber.id,
        explicitThreadId: req.session.web.threadId,
      });
      req.session.web.profile = subscriber;
      req.session.web.threadId = thread?.id;
      req.session.web.sourceId = sourceId;

      return subscriber;
    }

    req.session.web = undefined;

    const profile = await this.subscriberService.create(buildProfile());
    req.session.web = { profile, sourceId };

    return profile;
  }

  /**
   * Resolves a thread for the given subscriber, optionally using an explicit
   * thread id. Does not read from or write to the request/session.
   */
  async resolveThread(
    subscriberId: string,
    explicitThreadId?: string,
  ): Promise<Thread | null> {
    return this.threadService.resolveThread({ subscriberId, explicitThreadId });
  }

  resolveInactivityHours(settings: unknown): number {
    return this.threadService.resolveInactivityHours(settings);
  }

  /**
   * Resolves a thread from the request query/body and writes the result back
   * to the session. Used by the subscribe/history flows.
   */
  async resolveThreadForHistory(
    req: SocketRequest,
    subscriberId: string,
  ): Promise<Thread | null> {
    const explicitThreadId =
      this.getThreadIdFromQuery(req) ?? this.getThreadIdFromBody(req);
    const thread = await this.resolveThread(subscriberId, explicitThreadId);
    if (req.session.web) {
      req.session.web.threadId = thread?.id;
    }

    return thread;
  }

  /**
   * Resolves the writable thread for an incoming message and persists it on the
   * socket session before chatbot processing continues asynchronously.
   */
  async resolveThreadForIncoming(
    req: SocketRequest,
    subscriberId: string,
    {
      explicitThreadId,
      inactivityHours,
      sourceId,
    }: {
      explicitThreadId?: string;
      inactivityHours?: number;
      sourceId?: string;
    },
  ): Promise<Thread> {
    const thread = await this.threadService.resolveThreadForIncoming({
      subscriberId,
      explicitThreadId,
      inactivityHours,
      sourceId,
    });

    if (req.session.web) {
      req.session.web.threadId = thread.id;
    }

    return thread;
  }
}

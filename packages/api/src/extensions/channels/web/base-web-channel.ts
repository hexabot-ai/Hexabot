/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import type {
  Attachment,
  Source,
  StdOutgoingMessageEnvelope,
  Subscriber,
} from '@hexabot-ai/types';
import {
  ActionOptions,
  OutgoingMessageType,
  StdEventType,
} from '@hexabot-ai/types';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Request, Response } from 'express';
import { Socket } from 'socket.io';
import type { z } from 'zod';

import { AttachmentOrmEntity } from '@/attachment/entities/attachment.entity';
import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
} from '@/attachment/types';
import {
  ChannelCapabilities,
  DEFAULT_CHANNEL_CAPABILITIES,
} from '@/channel/lib/channel-capabilities';
import { ExtensionInject } from '@/channel/lib/extension-inject.decorator';
import { MessageInboundEvent } from '@/channel/lib/inbound-events';
import { WebSocketChannelHandler } from '@/channel/lib/transports/websocket-channel-handler';
import { SourceService } from '@/channel/services/source.service';
import { ChannelName } from '@/channel/types';
import { MessageCreateDto } from '@/chat/dto/message.dto';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { MessageService } from '@/chat/services/message.service';
import type { SubscriberChannelData } from '@/chat/types/channel';
import { MenuService } from '@/cms/services/menu.service';
import { config } from '@/config';
import { getAllowedDomains } from '@/utils/helpers/origin';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';

import {
  AttachmentMessageInboundEvent,
  BaseWebInboundEvent,
  createWebInboundEventDecoder,
  createWebInboundMessageEncoder,
  WebInboundEventDecoder,
  WebInboundMessageEncoder,
  WebMessageInboundEvent,
} from './inbound';
import {
  createWebOutboundMessageEncoder,
  WebOutboundMessageEncoder,
} from './outbound';
import {
  WebFormatContext,
  WebHistoryService,
} from './services/web-history.service';
import { WebSessionService } from './services/web-session.service';
import { WEB_CHANNEL_NAME } from './settings.schema';
import { Web } from './types';

type WebSocketData = Socket['data'] & {
  webMessageQueue?: Promise<void>;
};

/**
 * Base handler for the Socket.IO-backed "web" channel.
 *
 * Responsibilities:
 * - resolves per-channel helpers via `@ExtensionInject()` (encoder/decoder, session, history)
 * - enforces web-channel CORS rules for the HTTP socket transport endpoints
 * - manages web session bootstrap and thread resolution
 * - decodes inbound web events and broadcasts outbound messages over Socket.IO
 */
@Injectable()
export default abstract class BaseWebChannelHandler<N extends ChannelName>
  extends WebSocketChannelHandler<N>
  implements OnModuleInit
{
  @Inject(MenuService)
  private readonly menuService: MenuService;

  @Inject(MessageService)
  private readonly messageService: MessageService;

  @Inject(SourceService)
  private readonly sourceService: SourceService;

  @ExtensionInject((name) => createWebOutboundMessageEncoder(name))
  private outboundMessageEncoder!: WebOutboundMessageEncoder;

  @ExtensionInject((name) => createWebInboundMessageEncoder(name))
  private inboundMessageEncoder!: WebInboundMessageEncoder;

  @ExtensionInject((name) => createWebInboundEventDecoder(name))
  private inboundEventDecoder!: WebInboundEventDecoder<N>;

  @ExtensionInject(WebSessionService)
  private sessionService!: WebSessionService;

  @ExtensionInject(WebHistoryService)
  private historyService!: WebHistoryService;

  constructor(name: N, sourceSettingsSchema?: z.ZodTypeAny) {
    super(name, sourceSettingsSchema);
  }

  async onModuleInit() {
    await super.onModuleInit();
    this.logger.debug('initialization ...');
  }

  getCapabilities(): ChannelCapabilities {
    return { ...DEFAULT_CHANNEL_CAPABILITIES, typingIndicator: true };
  }

  generateId(): string {
    return `${this.name}-${randomUUID()}`;
  }

  getChannelAttributes(
    req: SocketRequest,
  ): SubscriberChannelDict[typeof WEB_CHANNEL_NAME] {
    return {
      isSocket: true,
      ipAddress: this.getIpAddress(req),
      agent: req.headers['user-agent'] || 'browser',
    };
  }

  private formatCtx(sourceId: string): WebFormatContext {
    return {
      inboundEncoder: this.inboundMessageEncoder,
      outboundEncoder: this.outboundMessageEncoder,
      generateId: () => this.generateId(),
      sourceId,
    };
  }

  private getSourceIdFromHandshake(client: Socket): string | null {
    const rawSourceId = client.handshake.query.source_id;
    const sourceId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;

    if (typeof sourceId !== 'string') {
      return null;
    }

    const normalizedSourceId = sourceId.trim();

    return normalizedSourceId.length > 0 ? normalizedSourceId : null;
  }

  private enqueueMessageDispatch(
    req: SocketRequest,
    event: MessageInboundEvent,
  ): void {
    const socket = req.socket as Socket & { data?: WebSocketData };
    const socketData = (socket.data ??= {});
    // Keep chatbot processing ordered per socket without making the client ack
    // wait for slow actions, LLM calls, or external integrations.
    const previous = socketData.webMessageQueue ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.channelEventBus.emitMessage(event))
      .catch((err) => {
        this.logger.error('Failed to process web socket message', err);
      });

    socketData.webMessageQueue = next;
    void next.finally(() => {
      if (socketData.webMessageQueue === next) {
        delete socketData.webMessageQueue;
      }
    });
  }

  @OnEvent('hook:websocket:connection', { async: true })
  async onWebSocketConnection(client: Socket) {
    try {
      const sourceId = this.getSourceIdFromHandshake(client);

      if (!sourceId) {
        if (client.request.session.passport?.user?.id) {
          // Core websocket connection for system notifications (not the web/console channel one)
          return;
        }

        this.logger.warn('Missing source_id in websocket handshake');
        client.disconnect();

        return;
      }

      const source = await this.sourceService.findActiveById(sourceId);
      const profile = client.request.session.web?.profile;

      if (source.channel !== this.getName()) {
        return;
      }

      client.request.session.web = {
        ...client.request.session.web,
        sourceId,
      };

      let messages: Web.Message[] | undefined;
      let threadId: string | undefined;

      if (profile?.foreignId) {
        await client.join(profile.foreignId);
        const thread = await this.sessionService.resolveThread(
          profile.id,
          client.request.session.web?.threadId,
        );
        threadId = thread?.id;
        client.request.session.web = {
          profile: client.request.session.web?.profile,
          threadId,
          sourceId,
        };
        messages = thread
          ? await this.historyService.fetchHistory(
              thread,
              this.formatCtx(source.id),
            )
          : [];
      }

      this.logger.debug('WS connected .. sending settings');
      const settings = source.settings;

      try {
        const menu = await this.menuService.getTree();
        client.emit('settings', {
          menu,
          profile,
          thread_id: threadId ?? null,
          messages,
          ...settings,
        });
      } catch (err) {
        this.logger.warn('Unable to retrieve menu ', err);
        client.emit('settings', {
          profile,
          thread_id: threadId ?? null,
          messages,
          ...settings,
        });
      }
    } catch (err) {
      this.logger.error('Unable to initiate websocket connection', err);
      client.disconnect();
    }
  }

  @OnEvent('hook:websocket:error')
  broadcastError(socket: Socket, error: HttpException): void {
    const response = (
      error instanceof HttpException
        ? error.getResponse()
        : {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Internal Server Error',
          }
    ) as SocketResponse;
    const subscriber = socket.request.session.web?.profile;
    const sourceId = this.getSourceIdFromHandshake(socket);

    if (
      !sourceId ||
      socket.request.session.web?.sourceId !== sourceId ||
      !subscriber
    ) {
      return;
    }

    this.broadcast(subscriber, StdEventType.error, response, [socket.id]);
  }

  /**
   * Verify the origin against whitelisted domains.
   *
   * @param req
   * @param res
   */
  private async ensureValidCors(
    req: SocketRequest,
    res: Response | SocketResponse,
    source: Source,
  ): Promise<void> {
    await this.sessionService.validateCors(
      req,
      res,
      getAllowedDomains(source.settings),
    );
  }

  protected async getOrCreateSession(
    req: SocketRequest,
    source: Source,
  ): Promise<Subscriber> {
    return this.sessionService.getOrCreateSession(req, source.id, () => {
      const data = req.query;

      return {
        foreignId: this.generateId(),
        firstName: data.first_name ? String(data.first_name) : 'Anon.',
        lastName: data.last_name ? String(data.last_name) : 'Web User',
        assignedTo: null,
        assignedAt: null,
        lastvisit: new Date(),
        retainedFrom: new Date(),
        avatar: null,
        channel: {
          name: this.getName(),
          data: this.getChannelAttributes(req),
        },
        language: '',
        locale: '',
        timezone: 0,
        gender: 'male',
        country: '',
        labels: [],
        source: source.id,
      };
    });
  }

  /**
   * Allow the subscription to a web's webhook after verification
   *
   * @param req
   * @param res
   */
  protected async subscribe(
    req: SocketRequest,
    res: Response | SocketResponse,
    source: Source,
  ): Promise<void> {
    this.logger.debug('subscribe (isSocket=true)');
    try {
      const profile = await this.getOrCreateSession(req, source);
      const profileForeignId = profile.foreignId;
      if (!profileForeignId) {
        throw new Error('Session profile foreignId is missing');
      }
      try {
        await req.socket.join(profileForeignId);
      } catch (err) {
        this.logger.error('Unable to subscribe via websocket', err);
      }
      const criteria =
        'since' in req.query ? req.query.since : (req.body?.since ?? undefined);
      const messages = await this.historyService.fetchHistoryForRequest(
        req,
        this.sessionService,
        this.formatCtx(source.id),
        criteria,
      );

      res.status(200).json({
        profile,
        messages,
        thread_id: req.session.web?.threadId ?? null,
      });
    } catch (err) {
      this.logger.warn('Unable to subscribe ', err);
      res.status(500).json({ err: 'Unable to subscribe' });
    }
  }

  /**
   * Handles upload via WebSocket.
   *
   * @param req - The WebSocket request containing the session and the file data.
   * @returns A Promise that resolves to the stored `Attachment`, or `null` if
   *          the session is invalid or no file is provided.
   * @throws Error if missing file payload.
   * @throws Error if the max upload size is exceeded.
   * @throws Error when storing the uploaded file fails.
   */
  async handleWsUpload(req: SocketRequest): Promise<Attachment | null> {
    try {
      const { type, data } = req.body as Web.InboundMessage;

      if (!req.session.web?.profile?.id) {
        this.logger.debug('No session provided');

        return null;
      }
      if (type !== Web.InboundMessageType.file) {
        this.logger.debug('No files provided');

        return null;
      }
      if (!('file' in data) || !data.file) {
        throw new Error('File payload is missing');
      }

      const { name: fileName, type: mimeType } = data as {
        name: string;
        type: string;
      };
      const size = Buffer.byteLength(data.file);

      if (size > config.parameters.maxUploadSize) {
        throw new Error('Max upload size has been exceeded');
      }

      return await this.attachmentService.store(data.file, {
        name: fileName,
        size,
        type: mimeType,
        resourceRef: AttachmentResourceRef.MessageAttachment,
        access: AttachmentAccess.Private,
        createdByRef: AttachmentCreatedByRef.Subscriber,
        createdBy: req.session.web.profile.id,
      });
    } catch (err) {
      this.logger.error('Unable to store uploaded file', err);
      throw new Error('Unable to upload file!');
    }
  }

  /**
   * Handle channel event (probably a message)
   *
   * @param req - WS request (Synthetic Object)
   * @param res - Either a HTTP Express response or a WS response (Synthetic Object)
   */
  async handleEvent(
    req: SocketRequest,
    res: Response | SocketResponse,
    source: Source,
    workflowId?: string,
  ): Promise<void> {
    if (!req.body) {
      this.logger.debug('Empty body');
      res.status(400).json({ err: 'Web Channel Handler : Bad Request!' });

      return;
    }

    if (
      typeof req.body === 'object' &&
      req.body !== null &&
      'data' in req.body
    ) {
      const payload = req.body as { data?: unknown };
      payload.data =
        typeof payload.data === 'string'
          ? JSON.parse(payload.data)
          : payload.data;
    }

    const profile = await this.sessionService.validateSession(
      req,
      res,
      source.id,
    );
    if (!profile) return;

    const channelAttrs = this.getChannelAttributes(req);
    let events: Array<
      BaseWebInboundEvent<N> | WebMessageInboundEvent<N, Web.InboundMessage>
    >;
    try {
      events = this.inboundEventDecoder.createEvents(
        req.body,
        channelAttrs,
      ) as Array<
        BaseWebInboundEvent<N> | WebMessageInboundEvent<N, Web.InboundMessage>
      >;
    } catch (err) {
      this.logger.warn('Invalid event payload', err);

      return void res
        .status(400)
        .json({ err: 'Web Channel Handler : Bad Request!' });
    }

    if (!events.length) {
      return void res
        .status(400)
        .json({ err: 'Web Channel Handler : Bad Request!' });
    }

    const explicitThreadId =
      this.sessionService.getThreadIdFromBody(req) ??
      this.sessionService.getThreadIdFromQuery(req) ??
      req.session.web?.threadId;
    const responseBody = events[0].getRaw();

    for (const event of events) {
      event.setHandler(this);
      event.setSourceContext(source.id, source.settings);
      if (explicitThreadId) event.setThreadId(explicitThreadId);
      event.setInitiator(profile);
      event.setWorkflowId(workflowId);

      if (event.getEventType() === StdEventType.message) {
        const messageEvent = event as WebMessageInboundEvent<
          N,
          Web.InboundMessage
        >;

        if (messageEvent instanceof AttachmentMessageInboundEvent) {
          try {
            const attachment = await this.handleWsUpload(req);
            if (attachment) {
              messageEvent.setUploadedAttachment(attachment);
              messageEvent.setUploadedRawData(
                AttachmentOrmEntity.getTypeByMime(attachment.type),
                await this.channelAttachmentService.getPublicUrl(
                  source.id,
                  attachment,
                ),
              );
            }
          } catch (err) {
            this.logger.warn('Unable to upload file ', err);

            return void res
              .status(403)
              .json({ err: 'Web Channel Handler : File upload failed!' });
          }
        }

        if (messageEvent.isSyncFromChatbot()) {
          const thread = await this.sessionService.resolveThreadForHistory(
            req,
            profile.id,
          );
          if (!thread) {
            return void res.status(409).json({
              err: 'Web Channel Handler : No thread available before first user message',
            });
          }
          messageEvent.setThreadId(thread.id);
          if (req.session.web) req.session.web.threadId = thread.id;

          const sentMessage: MessageCreateDto = {
            mid: messageEvent.getId(),
            message: {
              type: OutgoingMessageType.text,
              data: { text: messageEvent.getText() },
            },
            recipient: profile.id,
            thread: thread.id,
            read: true,
            delivery: true,
          };
          this.channelEventBus.emitSent(sentMessage, messageEvent);
          continue;
        }

        messageEvent.setMessageId(this.generateId());
        if (profile.foreignId) {
          messageEvent.setAuthorForeignId(profile.foreignId);
        }
        messageEvent.setCreatedAt(new Date());
        // Resolve the thread before acknowledging the socket request so the
        // client receives a stable thread_id, then dispatch chatbot work later.
        const thread = await this.sessionService.resolveThreadForIncoming(
          req,
          profile.id,
          {
            explicitThreadId: messageEvent.getThreadId(),
            inactivityHours: this.sessionService.resolveInactivityHours(
              source.settings,
            ),
            sourceId: source.id,
          },
        );
        messageEvent.setThreadId(thread.id);
        messageEvent.setThreadIdOnRaw(thread.id);

        this.broadcast(profile, StdEventType.message, messageEvent.getRaw());
        this.enqueueMessageDispatch(req, messageEvent);

        continue;
      }

      const type = event.getEventType();
      const threadId = event.getThreadId();
      if (threadId) event.setThreadIdOnRaw(threadId);
      this.broadcast(profile, type, event.getRaw());
      this.channelEventBus.emitStatusEvent(event);
    }

    res.status(200).json(responseBody);
  }

  protected async processSocketGet(
    req: SocketRequest,
    res: Response | SocketResponse,
    source: Source,
  ): Promise<void> {
    try {
      await this.ensureValidCors(req, res, source);
      if (req.query._disconnect) {
        req.session.web = undefined;

        return void res.status(200).json({ _disconnect: true });
      }
      await this.subscribe(req, res, source);
    } catch (err) {
      this.logger.warn('Request check failed', err);
      res.status(403).json({ err: 'Web Channel Handler : Unauthorized!' });
    }
  }

  protected async processSocketPost(
    req: SocketRequest,
    res: Response | SocketResponse,
    source: Source,
    workflowId?: string,
  ): Promise<void> {
    try {
      await this.ensureValidCors(req, res, source);
      await this.handleEvent(req, res, source, workflowId);
    } catch (err) {
      this.logger.warn('Request check failed', err);
      res.status(403).json({ err: 'Web Channel Handler : Unauthorized!' });
    }
  }

  protected async doSendMessage(
    event: MessageInboundEvent<N>,
    envelope: StdOutgoingMessageEnvelope,
    options: ActionOptions,
  ): Promise<{ mid: string }> {
    const sourceId = event.getSourceId();

    if (!sourceId) {
      throw new Error(
        `Missing sourceId while sending ${this.getName()} outbound message`,
      );
    }

    const messageBase = await this.outboundMessageEncoder.encode(envelope, {
      ...(options ?? {}),
      sourceId,
    });
    const subscriber = event.getInitiator();
    const message: Web.OutboundMessage = {
      ...messageBase,
      mid: this.generateId(),
      author: 'chatbot',
      thread_id: event.getThreadId(),
      createdAt: new Date(),
      handover: !!(options && options.assignTo),
    };
    const send = async (): Promise<{ mid: string }> => {
      this.broadcast(subscriber, StdEventType.message, message);

      return { mid: message.mid };
    };

    if (options?.typing) {
      const autoTimeout =
        message?.data && 'text' in message.data
          ? message.data.text.length * 10
          : 1000;
      const timeout =
        typeof options.typing === 'number' ? options.typing : autoTimeout;
      try {
        await this.sendTypingIndicator(subscriber, timeout);

        return send();
      } catch (err) {
        this.logger.error('Failed in sending typing indicator ', err);
      }
    }

    return send();
  }

  /**
   * Fetch the end-user profile data
   *
   * @param event - The message event received
   *
   * @returns The web's response, otherwise an error
   */
  async getSubscriberData(
    event: MessageInboundEvent<N>,
  ): Promise<SubscriberCreateDto> {
    const sender = event.getInitiator();
    if (!sender.source) {
      throw new Error('Unable to resolve subscriber source for web channel');
    }
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = sender;

    return {
      ...rest,
      source: sender.source,
      channel: sender.channel as SubscriberChannelData<N>,
    };
  }

  /**
   * Checks if the request is authorized to download a given attachment file.
   * Can be overridden by the channel handler to customize, by default it shouldn't
   * allow any client to download a subscriber attachment for example.
   *
   * @param attachment The attachment object
   * @param req - The HTTP express request object.
   * @return True, if requester is authorized to download the attachment
   */
  public async hasDownloadAccess(attachment: Attachment, req: Request) {
    const subscriberId = req.session.web?.profile?.id;

    if (attachment.access === AttachmentAccess.Public) return true;

    if (!subscriberId) {
      this.logger.warn(
        `Unauthorized access attempt to attachment ${attachment.id}`,
      );

      return false;
    }

    if (
      attachment.createdByRef === AttachmentCreatedByRef.Subscriber &&
      subscriberId === attachment.createdBy
    ) {
      return true;
    }

    return this.messageService.isAttachmentAccessibleBySubscriber(
      subscriberId,
      attachment.id,
    );
  }
}

/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import bodyParser from 'body-parser';
import { NextFunction, Request, Response } from 'express';
import multer, { diskStorage, memoryStorage } from 'multer';
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { AttachmentService } from '@/attachment/services/attachment.service';
import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
} from '@/attachment/types';
import { ChannelService } from '@/channel/channel.service';
import ChannelHandler from '@/channel/lib/Handler';
import { ChannelName } from '@/channel/types';
import { MessageCreateDto } from '@/chat/dto/message.dto';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { VIEW_MORE_PAYLOAD } from '@/chat/helpers/constants';
import {
  Subscriber,
  SubscriberFull,
  SubscriberStub,
} from '@/chat/schemas/subscriber.schema';
import { AttachmentRef } from '@/chat/schemas/types/attachment';
import { Button, ButtonType, PayloadType } from '@/chat/schemas/types/button';
import {
  AnyMessage,
  ContentElement,
  IncomingMessage,
  IncomingMessageType,
  OutgoingMessage,
  OutgoingMessageFormat,
  StdEventType,
  StdOutgoingAttachmentMessage,
  StdOutgoingButtonsMessage,
  StdOutgoingEnvelope,
  StdOutgoingListMessage,
  StdOutgoingMessage,
  StdOutgoingQuickRepliesMessage,
  StdOutgoingTextMessage,
} from '@/chat/schemas/types/message';
import { BlockOptions } from '@/chat/schemas/types/options';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { Content } from '@/cms/schemas/content.schema';
import { MenuService } from '@/cms/services/menu.service';
import { config } from '@/config';
import { I18nService } from '@/i18n/services/i18n.service';
import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';
import { WebsocketGateway } from '@/websocket/websocket.gateway';

import { WEB_CHANNEL_NAME, WEB_CHANNEL_NAMESPACE } from './settings';
import { Web } from './types';
import WebEventWrapper from './wrapper';

// Handle multipart uploads (Long Pooling only)
const upload = multer({
  limits: {
    fileSize: config.parameters.maxUploadSize,
  },
  storage: (() => {
    if (config.parameters.storageMode === 'memory') {
      return memoryStorage();
    } else {
      return diskStorage({});
    }
  })(),
}).single('file'); // 'file' is the field name in the form

@Injectable()
export default abstract class BaseWebChannelHandler<
  N extends ChannelName,
> extends ChannelHandler<N> {
  constructor(
    name: N,
    settingService: SettingService,
    channelService: ChannelService,
    logger: LoggerService,
    protected readonly eventEmitter: EventEmitter2,
    protected readonly i18n: I18nService,
    protected readonly subscriberService: SubscriberService,
    public readonly attachmentService: AttachmentService,
    protected readonly messageService: MessageService,
    protected readonly menuService: MenuService,
    protected readonly websocketGateway: WebsocketGateway,
  ) {
    super(name, settingService, channelService, logger);
  }

  /**
   * No init needed for the moment
   *
   * @returns -
   */
  init(): void {
    this.logger.debug('initialization ...');
  }

  /**
   * Verify web websocket connection and return settings
   *
   * @param client - The socket client
   */
  @OnEvent('hook:websocket:connection', { async: true })
  async onWebSocketConnection(client: Socket) {
    try {
      const settings = await this.getSettings();
      const handshake = client.handshake;
      const { channel } = handshake.query;
      const profile = client.request.session.web?.profile;

      if (channel !== this.getName()) {
        return;
      }

      let messages: Web.Message[] | undefined;

      if (profile?.foreign_id) {
        await client.join(profile.foreign_id);
        const messagesHistory =
          await this.messageService.findHistoryUntilDate(profile);
        messages = await this.formatMessages(messagesHistory.reverse());
      }

      this.logger.debug('WS connected .. sending settings');

      try {
        const menu = await this.menuService.getTree();

        client.emit('settings', {
          menu,
          profile,
          messages,
          ...settings,
        });
      } catch (err) {
        this.logger.warn('Unable to retrieve menu ', err);
        client.emit('settings', { profile, messages, ...settings });
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

    const subscriber = socket.request.session.web?.profile as
      | Subscriber
      | undefined;

    if (socket.handshake.query.channel !== this.getName() || !subscriber) {
      return;
    }

    this.broadcast(subscriber, StdEventType.error, response, [socket.id]);
  }

  /**
   * Adapt incoming message structure for web channel
   *
   * @param incoming - Incoming message
   * @returns Formatted web message
   */
  private async formatIncomingHistoryMessage(
    incoming: IncomingMessage,
  ): Promise<Web.IncomingMessageBase> {
    // Format incoming message
    if ('type' in incoming.message) {
      if (incoming.message.type === PayloadType.location) {
        const coordinates = incoming.message.coordinates;
        return {
          type: Web.IncomingMessageType.location,
          data: {
            coordinates: {
              lat: coordinates.lat,
              lng: coordinates.lon,
            },
          },
        };
      } else {
        // @TODO : handle multiple files
        const attachmentPayload = Array.isArray(incoming.message.attachment)
          ? incoming.message.attachment[0]
          : incoming.message.attachment;

        return {
          type: Web.IncomingMessageType.file,
          data: {
            type: attachmentPayload.type,
            url: await this.getPublicUrl(attachmentPayload.payload),
          },
        };
      }
    } else {
      return {
        type: Web.IncomingMessageType.text,
        data: incoming.message,
      };
    }
  }

  /**
   * Adapt the outgoing message structure for web channel
   *
   * @param outgoing - The outgoing message
   * @returns Formatted web message
   */
  private async formatOutgoingHistoryMessage(
    outgoing: OutgoingMessage,
  ): Promise<Web.OutgoingMessageBase> {
    // Format outgoing message
    if ('buttons' in outgoing.message) {
      return this._buttonsFormat(outgoing.message);
    } else if ('attachment' in outgoing.message) {
      return this._attachmentFormat(outgoing.message);
    } else if ('quickReplies' in outgoing.message) {
      return this._quickRepliesFormat(outgoing.message);
    } else if ('options' in outgoing.message) {
      if (outgoing.message.options.display === 'carousel') {
        return await this._carouselFormat(outgoing.message, {
          content: outgoing.message.options,
        });
      } else {
        return await this._listFormat(outgoing.message, {
          content: outgoing.message.options,
        });
      }
    } else {
      return this._textFormat(outgoing.message);
    }
  }

  /**
   * Checks if a given message is an IncomingMessage
   *
   * @param message Any type of message
   * @returns True, if it's a incoming message
   */
  private isIncomingMessage(message: AnyMessage): message is IncomingMessage {
    return 'sender' in message && !!message.sender;
  }

  /**
   * Adapt the message structure for web channel
   *
   * @param messages - The messages to be formatted
   *
   * @returns Formatted message
   */
  protected async formatMessages(
    messages: AnyMessage[],
  ): Promise<Web.Message[]> {
    const formattedMessages: Web.Message[] = [];

    for (const anyMessage of messages) {
      if (this.isIncomingMessage(anyMessage)) {
        const message = await this.formatIncomingHistoryMessage(anyMessage);
        formattedMessages.push({
          ...message,
          author: anyMessage.sender,
          read: true, // Temporary fix as read is false in the bd
          mid: anyMessage.mid,
          createdAt: anyMessage.createdAt,
        });
      } else {
        const message = await this.formatOutgoingHistoryMessage(anyMessage);
        formattedMessages.push({
          ...message,
          author: 'chatbot',
          read: true, // Temporary fix as read is false in the bd
          mid: anyMessage.mid || this.generateId(),
          handover: !!anyMessage.handover,
          createdAt: anyMessage.createdAt,
        });
      }
    }

    return formattedMessages;
  }

  /**
   * Fetches the messaging history from the DB.
   * @param req - Either an HTTP Express request or a WS SocketRequest (synthetic)
   * @param [until=new Date()] - Date before which to fetch
   * @param [n=30] - Number of messages to fetch
   * @returns Promise resolving to an array of messages.
   * Fetches the last 'n' messages for the session profile up to the given date.
   */
  protected async fetchHistory(
    req: Request | SocketRequest,
    until: Date = new Date(),
    n: number = 30,
  ): Promise<Web.Message[]> {
    const profile = req.session.web?.profile;
    if (profile) {
      const messages = await this.messageService.findHistoryUntilDate(
        profile,
        until,
        n,
      );
      return await this.formatMessages(messages.reverse());
    }
    return [];
  }

  /**
   * Poll new messages by a given start datetime
   * @param req - HTTP Express Request
   * @param since - Date after which to fetch
   * @param n - Number of messages to fetch
   * @returns Promise resolving to an array of messages.
   * Fetches the last 'n' new messages for the session profile since the given date.
   */
  private async pollMessages(
    req: Request,
    since: Date = new Date(10e14),
    n: number = 30,
  ): Promise<Web.Message[]> {
    const profile = req.session.web?.profile;
    if (profile) {
      const messages = await this.messageService.findHistorySinceDate(
        profile,
        since,
        n,
      );
      return await this.formatMessages(messages);
    }
    return [];
  }

  /**
   * Verify the origin against whitelisted domains.
   *
   * @param req
   * @param res
   */
  private async validateCors(
    req: Request | SocketRequest,
    res: Response | SocketResponse,
  ) {
    const settings = await this.getSettings<typeof WEB_CHANNEL_NAMESPACE>();

    // Check if we have an origin header...
    if (!req.headers?.origin) {
      this.logger.debug('No origin ', req.headers);
      throw new Error('CORS - No origin provided!');
    }

    const originUrl = new URL(req.headers.origin);
    const allowedProtocols = new Set(['http:', 'https:']);
    if (!allowedProtocols.has(originUrl.protocol)) {
      throw new Error('CORS - Invalid origin!');
    }

    // Get the allowed origins
    const origins: string[] = settings.allowed_domains.split(',');
    const foundOrigin = origins
      .filter((origin) => origin.trim() !== '*') // Skip "*"
      .map((origin) => {
        try {
          return new URL(origin.trim()).origin;
        } catch (error) {
          this.logger.error(`Invalid URL in allowed domains: ${origin}`, error);
          return null;
        }
      })
      .filter(
        (normalizedOrigin): normalizedOrigin is string =>
          normalizedOrigin !== null,
      )
      .some((origin: string) => {
        // If we find a whitelisted origin, send the Access-Control-Allow-Origin header
        // to greenlight the request.
        return origin === originUrl.origin;
      });

    if (!foundOrigin && !origins.includes('*')) {
      // For HTTP requests, set the Access-Control-Allow-Origin header to '', which the browser will
      // interpret as, 'no way Jose.'
      res.set('Access-Control-Allow-Origin', '');
      this.logger.debug('No origin found ', req.headers.origin);
      throw new Error('CORS - Domain not allowed!');
    } else {
      res.set('Access-Control-Allow-Origin', originUrl.origin);
    }
    // Determine whether or not to allow cookies to be passed cross-origin
    res.set('Access-Control-Allow-Credentials', 'true');
    // This header lets a server whitelist headers that browsers are allowed to access
    res.set('Access-Control-Expose-Headers', '');
    // Handle preflight requests
    if (req.method == 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.set('Access-Control-Allow-Headers', 'content-type');
    }
  }

  /**
   * Makes sure that message request is legitimate.
   *
   * @param req
   * @param res
   */
  private validateSession(
    req: Request | SocketRequest,
    res: Response | SocketResponse,
    next: <S extends SubscriberStub>(profile: S) => void,
  ) {
    if (!req.session.web?.profile?.id) {
      this.logger.warn('No session ID to be found!', req.session);
      return res
        .status(403)
        .json({ err: 'Web Channel Handler : Unauthorized!' });
    } else if (
      (this.isSocketRequest(req) &&
        !!req.isSocket !== req.session.web.isSocket) ||
      !Array.isArray(req.session.web.messageQueue)
    ) {
      this.logger.warn(
        'Mixed channel request or invalid session data!',
        req.session,
      );
      return res
        .status(403)
        .json({ err: 'Web Channel Handler : Unauthorized!' });
    }
    next(req.session.web?.profile);
  }

  /**
   * Perform all security measures on the request
   *
   * @param req
   * @param res
   */
  protected async checkRequest(
    req: Request | SocketRequest,
    res: Response | SocketResponse,
  ) {
    try {
      await this.validateCors(req, res);
    } catch (err) {
      this.logger.warn('Attempt to access from an unauthorized origin', err);
      throw new Error('Unauthorized, invalid origin !');
    }
  }

  /**
   * Get or create a session profile for the subscriber
   *
   * @param req
   *
   * @returns Subscriber's profile
   */
  protected async getOrCreateSession(
    req: Request | SocketRequest,
  ): Promise<SubscriberFull> {
    const data = req.query;
    // Subscriber has already a session
    const sessionProfile = req.session.web?.profile;
    if (sessionProfile) {
      const subscriber = await this.subscriberService.findOneAndPopulate(
        sessionProfile.id,
      );
      if (!subscriber || !req.session.web) {
        throw new Error('Subscriber session was not persisted in DB');
      }
      req.session.web.profile = subscriber;
      return subscriber;
    }

    const newProfile: SubscriberCreateDto = {
      foreign_id: this.generateId(),
      first_name: data.first_name ? data.first_name.toString() : 'Anon.',
      last_name: data.last_name ? data.last_name.toString() : 'Web User',
      assignedTo: null,
      assignedAt: null,
      lastvisit: new Date(),
      retainedFrom: new Date(),
      channel: {
        name: this.getName(),
        ...this.getChannelAttributes(req),
      },
      language: '',
      locale: '',
      timezone: 0,
      gender: 'male',
      country: '',
      labels: [],
    };
    const subscriber = await this.subscriberService.create(newProfile);
    // Init session
    const profile: SubscriberFull = {
      ...subscriber,
      labels: [],
      assignedTo: null,
      avatar: null,
    };

    req.session.web = {
      profile,
      isSocket: this.isSocketRequest(req),
      messageQueue: [],
      polling: false,
    };
    return profile;
  }

  /**
   * Return message queue (using by long polling case only)
   *
   * @param req HTTP Express Request
   * @param res HTTP Express Response
   */
  private getMessageQueue(req: Request, res: Response) {
    // Polling not authorized when using websockets
    if (this.isSocketRequest(req)) {
      this.logger.warn('Polling not authorized when using websockets');
      return res
        .status(403)
        .json({ err: 'Polling not authorized when using websockets' });
    }
    // Session must be active
    if (!(req.session && req.session.web && req.session.web?.profile?.id)) {
      this.logger.warn('Must be connected to poll messages');
      return res
        .status(403)
        .json({ err: 'Polling not authorized : Must be connected' });
    }

    // Can only request polling once at a time
    if (req.session && req.session.web && req.session.web.polling) {
      this.logger.warn('Poll rejected ... already requested');
      return res
        .status(403)
        .json({ err: 'Poll rejected ... already requested' });
    }

    req.session.web.polling = true;

    const fetchMessages = async (req: Request, res: Response, retrials = 1) => {
      try {
        if (!req.query.since)
          throw new BadRequestException(`QueryParam 'since' is missing`);

        const since = new Date(req.query.since.toString());
        const messages = await this.pollMessages(req, since);
        if (messages.length === 0 && retrials <= 5) {
          // No messages found, retry after 5 sec
          setTimeout(async () => {
            await fetchMessages(req, res, retrials * 2);
          }, retrials * 1000);
        } else if (req.session.web) {
          req.session.web.polling = false;
          return res.status(200).json(messages.map((msg) => ['message', msg]));
        } else {
          this.logger.error('Polling failed .. no session data');
          return res.status(500).json({ err: 'No session data' });
        }
      } catch (err) {
        if (req.session.web) {
          req.session.web.polling = false;
        }
        this.logger.error('Polling failed', err);
        return res.status(500).json({ err: 'Polling failed' });
      }
    };
    fetchMessages(req, res);
  }

  /**
   * Allow the subscription to a web's webhook after verification
   *
   * @param req
   * @param res
   */
  protected async subscribe(
    req: Request | SocketRequest,
    res: Response | SocketResponse,
  ) {
    this.logger.debug('subscribe (isSocket=' + this.isSocketRequest(req) + ')');
    try {
      const profile = await this.getOrCreateSession(req);
      // Join socket room when using websocket
      if (this.isSocketRequest(req)) {
        try {
          await req.socket.join(profile.foreign_id);
        } catch (err) {
          this.logger.error('Unable to subscribe via websocket', err);
        }
      }
      // Fetch message history
      const criteria =
        'since' in req.query
          ? req.query.since // Long polling case
          : req.body?.since || undefined; // Websocket case
      const messages = await this.fetchHistory(req, criteria);
      return res.status(200).json({ profile, messages });
    } catch (err) {
      this.logger.warn('Unable to subscribe ', err);
      return res.status(500).json({ err: 'Unable to subscribe' });
    }
  }

  /**
   * Handles upload via WebSocket.
   *
   * @param req - The WebSocket request containing the session and the file data.
   * @returns A Promise that resolves to the stored `Attachment`, or `null` if
   *          the session is invalid or no file is provided.
   * @throws Error if the max upload size is exceeded.
   * @throws Error when storing the uploaded file fails.
   */
  async handleWsUpload(req: SocketRequest): Promise<Attachment | null> {
    try {
      const { type, data } = req.body as Web.IncomingMessage;

      if (!req.session.web?.profile?.id) {
        this.logger.debug('No session');
        return null;
      }

      // Check if any file is provided
      if (
        type !== Web.IncomingMessageType.file ||
        !('file' in data) ||
        !data.file
      ) {
        this.logger.debug('No files provided');
        return null;
      }

      const size = Buffer.byteLength(data.file);

      if (size > config.parameters.maxUploadSize) {
        throw new Error('Max upload size has been exceeded');
      }

      return await this.attachmentService.store(data.file, {
        name: data.name,
        size,
        type: data.type,
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
   * Handles file upload via HTTP multipart/form-data requests.
   *
   * @param req - The Express HTTP request.
   * @param _res - The Express HTTP response.
   * @returns A Promise that resolves to the stored `Attachment`, or `null`/`undefined`
   *          if the session is invalid or no file is provided.
   * @throws Error when storing the uploaded file fails.
   */
  async handleWebUpload(
    req: Request,
    _res: Response,
  ): Promise<Attachment | null | undefined> {
    try {
      if (!req.session.web?.profile?.id) {
        this.logger.debug('Upload denied, no session is defined');
        return null;
      }

      // Check if any file is provided
      if (!req.file) {
        this.logger.debug('No files provided');
        return null;
      }

      return await this.attachmentService.store(req.file, {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        resourceRef: AttachmentResourceRef.MessageAttachment,
        access: AttachmentAccess.Private,
        createdByRef: AttachmentCreatedByRef.Subscriber,
        createdBy: req.session.web.profile.id,
      });
    } catch (err) {
      this.logger.error('Unable to store uploaded file', err);
      throw err;
    }
  }

  /**
   * Upload file as attachment if provided
   *
   * @param req Either a HTTP Express request or a WS request (Synthetic Object)
   * @param res Either a HTTP Express response or a WS response (Synthetic Object)
   * @returns A Promise that resolves to the uploaded Attachment, or `null`/`undefined` if no file is uploaded.
   * @throws Error Propagated from underlying upload handlers.
   */
  async handleUpload(
    req: Request | SocketRequest,
    res: Response | SocketResponse,
  ): Promise<Attachment | null | undefined> {
    // Check if any file is provided
    if (!req.session.web) {
      this.logger.debug('No session provided');
      return null;
    }

    if (this.isSocketRequest(req)) {
      return this.handleWsUpload(req);
    } else {
      return this.handleWebUpload(req, res as Response);
    }
  }

  /**
   * Returns the request client IP address
   *
   * @param req Either a HTTP request or a WS Request (Synthetic object)
   *
   * @returns IP Address
   */
  protected getIpAddress(req: Request | SocketRequest): string {
    if (this.isSocketRequest(req)) {
      return req.socket.handshake.address;
    } else if (Array.isArray(req.ips) && req.ips.length > 0) {
      // If config.http.trustProxy is enabled, this variable contains the IP addresses
      // in this request's "X-Forwarded-For" header as an array of the IP address strings.
      // Otherwise an empty array is returned.
      return req.ips.join(',');
    } else {
      return req.ip || '0.0.0.0';
    }
  }

  /**
   * Return subscriber channel specific attributes
   *
   * @param req Either a HTTP Express request or a WS request (Synthetic Object)
   *
   * @returns The subscriber channel's attributes
   */
  getChannelAttributes(
    req: Request | SocketRequest,
  ): SubscriberChannelDict[typeof WEB_CHANNEL_NAME] {
    return {
      isSocket: this.isSocketRequest(req),
      ipAddress: this.getIpAddress(req),
      agent: req.headers['user-agent'] || 'browser',
    };
  }

  /**
   * Handle channel event (probably a message)
   *
   * @param req Either a HTTP Express request or a WS request (Synthetic Object)
   * @param res Either a HTTP Express response or a WS response (Synthetic Object)
   */
  _handleEvent(
    req: Request | SocketRequest,
    res: Response | SocketResponse,
  ): void {
    // @TODO: perform payload validation
    if (!req.body) {
      this.logger.debug('Empty body');
      res.status(400).json({ err: 'Web Channel Handler : Bad Request!' });
      return;
    } else {
      // Parse json form data (in case of content-type multipart/form-data)
      req.body.data =
        typeof req.body.data === 'string'
          ? JSON.parse(req.body.data)
          : req.body.data;
    }

    this.validateSession(req, res, async (profile) => {
      // Set data in file upload case
      const body: Web.IncomingMessage = req.body;

      const channelAttrs = this.getChannelAttributes(req);
      const event = new WebEventWrapper<N>(this, body, channelAttrs);
      if (event._adapter.eventType === StdEventType.message) {
        // Handle upload when files are provided
        if (event._adapter.messageType === IncomingMessageType.attachments) {
          try {
            const attachment = await this.handleUpload(req, res);
            if (attachment) {
              event._adapter.attachment = attachment;
              event._adapter.raw.data = {
                type: Attachment.getTypeByMime(attachment.type),
                url: await this.getPublicUrl(attachment),
              };
            }
          } catch (err) {
            this.logger.warn('Unable to upload file ', err);
            return res
              .status(403)
              .json({ err: 'Web Channel Handler : File upload failed!' });
          }
        }

        // Handler sync message sent by chatbot
        if (body.sync && body.author === 'chatbot') {
          const sentMessage: MessageCreateDto = {
            mid: event.getId(),
            message: event.getMessage() as StdOutgoingMessage,
            recipient: profile.id,
            read: true,
            delivery: true,
          };
          this.eventEmitter.emit('hook:chatbot:sent', sentMessage, event);
          return res.status(200).json(event._adapter.raw);
        } else {
          // Generate unique ID and handle message
          event._adapter.raw.mid = this.generateId();
          // Force author id from session
          event._adapter.raw.author = profile.foreign_id;
        }
      }

      event.setSender(profile as Subscriber);

      const type = event.getEventType();
      if (type) {
        this.broadcast(profile as Subscriber, type, event._adapter.raw);
        this.eventEmitter.emit(`hook:chatbot:${type}`, event);
      } else {
        this.logger.error('Webhook received unknown event ', event);
      }
      res.status(200).json(event._adapter.raw);
    });
  }

  /**
   * Checks if a given request is a socket request
   *
   * @param req Either a HTTP express request or a WS request
   * @returns True if it's a WS request
   */
  isSocketRequest(req: Request | SocketRequest): req is SocketRequest {
    return 'isSocket' in req && req.isSocket;
  }

  /**
   * Process incoming Web Channel data (finding out its type and assigning it to its proper handler)
   *
   * @param req Either a HTTP Express request or a WS request (Synthetic Object)
   * @param res Either a HTTP Express response or a WS response (Synthetic Object)
   */
  async handle(req: Request | SocketRequest, res: Response | SocketResponse) {
    const settings = await this.getSettings();
    // Web Channel messaging can be done through websockets or long-polling
    try {
      await this.checkRequest(req, res);
      if (req.method === 'GET') {
        if (!this.isSocketRequest(req) && req.query._get) {
          switch (req.query._get) {
            case 'settings':
              this.logger.debug('connected .. sending settings');
              try {
                const menu = await this.menuService.getTree();
                return res.status(200).json({
                  menu,
                  server_date: new Date().toISOString(),
                  ...settings,
                });
              } catch (err) {
                this.logger.warn('Unable to retrieve menu ', err);
                return res.status(500).json({ err: 'Unable to retrieve menu' });
              }
            case 'polling':
              // Handle polling when user is not connected via websocket
              return this.getMessageQueue(req, res as Response);
            default:
              this.logger.error('Webhook received unknown command');
              return res
                .status(500)
                .json({ err: 'Webhook received unknown command' });
          }
        } else if (req.query._disconnect) {
          req.session.web = undefined;
          return res.status(200).json({ _disconnect: true });
        } else {
          // Handle webhook subscribe requests
          return await this.subscribe(req, res);
        }
      } else {
        // Handle incoming messages (through POST)
        return this._handleEvent(req, res);
      }
    } catch (err) {
      this.logger.warn('Request check failed', err);
      return res
        .status(403)
        .json({ err: 'Web Channel Handler : Unauthorized!' });
    }
  }

  /**
   * Returns a unique identifier for the subscriber
   *
   * @returns UUID
   */
  generateId(): string {
    return 'web-' + uuidv4();
  }

  /**
   * Formats a text message that will be sent to the widget
   *
   * @param message - A text to be sent to the end user
   * @param _options - might contain additional settings
   *
   * @returns A ready to be sent text message
   */
  _textFormat(
    message: StdOutgoingTextMessage,
    _options?: BlockOptions,
  ): Web.OutgoingMessageBase {
    return {
      type: Web.OutgoingMessageType.text,
      data: message,
    };
  }

  /**
   * Formats a text + quick replies message that can be sent back
   *
   * @param message - A text + quick replies to be sent to the end user
   * @param _options - might contain additional settings
   *
   * @returns A ready to be sent text message
   */
  _quickRepliesFormat(
    message: StdOutgoingQuickRepliesMessage,
    _options?: BlockOptions,
  ): Web.OutgoingMessageBase {
    return {
      type: Web.OutgoingMessageType.quick_replies,
      data: {
        text: message.text,
        quick_replies: message.quickReplies,
      },
    };
  }

  /**
   * Formats a text + buttons message that can be sent back
   *
   * @param message - A text + buttons to be sent to the end user
   * @param _options - Might contain additional settings
   *
   * @returns A formatted Object understandable by the widget
   */
  _buttonsFormat(
    message: StdOutgoingButtonsMessage,
    _options?: BlockOptions,
  ): Web.OutgoingMessageBase {
    return {
      type: Web.OutgoingMessageType.buttons,
      data: {
        text: message.text,
        buttons: message.buttons,
      },
    };
  }

  /**
   * Formats an attachment + quick replies message that can be sent to the widget
   *
   * @param message - An attachment + quick replies to be sent to the end user
   * @param _options - Might contain additional settings
   *
   * @returns A ready to be sent attachment message
   */
  async _attachmentFormat(
    message: StdOutgoingAttachmentMessage,
    _options?: BlockOptions,
  ): Promise<Web.OutgoingMessageBase> {
    const payload: Web.OutgoingMessageBase = {
      type: Web.OutgoingMessageType.file,
      data: {
        type: message.attachment.type,
        url: await this.getPublicUrl(message.attachment.payload),
      },
    };
    if (message.quickReplies && message.quickReplies.length > 0) {
      return {
        ...payload,
        data: {
          ...payload.data,
          quick_replies: message.quickReplies,
        } as Web.OutgoingFileMessageData,
      };
    }
    return payload;
  }

  /**
   * Formats a collection of items to be sent to the widget (carousel/list)
   *
   * @param data - A list of data items to be sent to the end user
   * @param options - Might contain additional settings
   *
   * @returns An array of elements object
   */
  async _formatElements(
    data: ContentElement[],
    options: BlockOptions,
  ): Promise<Web.MessageElement[]> {
    if (!options.content || !options.content.fields) {
      throw new Error('Content options are missing the fields');
    }

    const fields = options.content.fields;
    const buttons: Button[] = options.content.buttons;
    const result: Web.MessageElement[] = [];

    for (const item of data) {
      const element: Web.MessageElement = {
        title: item[fields.title],
        buttons: item.buttons || [],
      };

      if (fields.subtitle && item[fields.subtitle]) {
        element.subtitle = item[fields.subtitle];
      }

      if (fields.image_url && item[fields.image_url]) {
        const attachmentRef =
          typeof item[fields.image_url] === 'string'
            ? { url: item[fields.image_url] }
            : (item[fields.image_url].payload as AttachmentRef);
        element.image_url = await this.getPublicUrl(attachmentRef);
      }

      buttons.forEach((button: Button, index) => {
        const btn = { ...button };
        if (btn.type === ButtonType.web_url) {
          // Get built-in or an external URL from custom field
          const urlField = fields.url;
          btn.url =
            urlField && item[urlField] ? item[urlField] : Content.getUrl(item);
          if (!btn.url.startsWith('http')) {
            btn.url = 'https://' + btn.url;
          }
          // Set default action the same as the first web_url button
          if (!element.default_action) {
            const { title: _title, ...defaultAction } = btn;
            element.default_action = defaultAction;
          }
        } else {
          if (
            'action_payload' in fields &&
            fields.action_payload &&
            fields.action_payload in item
          ) {
            btn.payload = btn.title + ':' + item[fields.action_payload];
          } else {
            const postback = Content.getPayload(item);
            btn.payload = btn.title + ':' + postback;
          }
        }
        // Set custom title for first button if provided
        if (index === 0 && fields.action_title && item[fields.action_title]) {
          btn.title = item[fields.action_title];
        }
        element.buttons?.push(btn);
      });

      if (Array.isArray(element.buttons) && element.buttons.length === 0) {
        delete element.buttons;
      }

      result.push(element);
    }

    return result;
  }

  /**
   * Format a list of elements
   *
   * @param message - Contains elements to be sent to the end user
   * @param options - Might contain additional settings
   *
   * @returns A ready to be sent list template message
   */
  async _listFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
  ): Promise<Web.OutgoingMessageBase> {
    const data = message.elements || [];
    const pagination = message.pagination;
    let buttons: Button[] = [],
      elements: Web.MessageElement[] = [];

    // Items count min check
    if (!data.length) {
      this.logger.error('Insufficient content count (must be >= 0 for list)');
      throw new Error('Insufficient content count (list >= 0)');
    }

    // Toggle "View More" button (check if there's more items to display)
    if (pagination.total - pagination.skip - pagination.limit > 0) {
      buttons = [
        {
          type: ButtonType.postback,
          title: this.i18n.t('View More'),
          payload: VIEW_MORE_PAYLOAD,
        },
      ];
    }

    // Populate items (elements/cards) with content
    elements = await this._formatElements(data, options);
    const topElementStyle = options.content?.top_element_style
      ? {
          top_element_style: options.content?.top_element_style,
        }
      : {};
    return {
      type: Web.OutgoingMessageType.list,
      data: {
        elements,
        buttons,
        ...topElementStyle,
      },
    };
  }

  /**
   * Format a carousel message
   *
   * @param message - Contains elements to be sent to the end user
   * @param options - Might contain additional settings
   *
   * @returns A carousel ready to be sent as a message
   */
  async _carouselFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
  ): Promise<Web.OutgoingMessageBase> {
    const data = message.elements || [];
    // Items count min check
    if (data.length === 0) {
      this.logger.error(
        'Insufficient content count (must be > 0 for carousel)',
      );
      throw new Error('Insufficient content count (carousel > 0)');
    }

    // Populate items (elements/cards) with content
    const elements = await this._formatElements(data, options);
    return {
      type: Web.OutgoingMessageType.carousel,
      data: {
        elements,
      },
    };
  }

  /**
   * Creates an widget compliant data structure for any message envelope
   *
   * @param envelope - The message standard envelope
   * @param options - The block options related to the message
   *
   * @returns A template filled with its payload
   */
  async _formatMessage(
    envelope: StdOutgoingEnvelope,
    options: BlockOptions,
  ): Promise<Web.OutgoingMessageBase> {
    switch (envelope.format) {
      case OutgoingMessageFormat.attachment:
        return await this._attachmentFormat(envelope.message, options);
      case OutgoingMessageFormat.buttons:
        return this._buttonsFormat(envelope.message, options);
      case OutgoingMessageFormat.carousel:
        return await this._carouselFormat(envelope.message, options);
      case OutgoingMessageFormat.list:
        return await this._listFormat(envelope.message, options);
      case OutgoingMessageFormat.quickReplies:
        return this._quickRepliesFormat(envelope.message, options);
      case OutgoingMessageFormat.text:
        return this._textFormat(envelope.message, options);

      default:
        throw new Error('Unknown message format');
    }
  }

  /**
   * Sends a message to the end-user using websocket
   *
   * @param subscriber - End-user toward which message will be sent
   * @param type - The message to be sent (message, typing, ...)
   * @param content - The message payload contain additional settings
   * @param [excludedRooms=[]] - Array of room names to exclude from receiving the message.
   */
  private broadcast(
    subscriber: Subscriber,
    type: StdEventType,
    content: any,
    excludedRooms: string[] = [],
  ): void {
    const channelData =
      Subscriber.getChannelData<typeof WEB_CHANNEL_NAME>(subscriber);
    if (channelData.isSocket) {
      this.websocketGateway.broadcast(subscriber, type, content, excludedRooms);
    } else {
      // Do nothing, messages will be retrieved via polling
    }
  }

  /**
   * Send a Web Channel Message to the end-user
   *
   * @param event - Incoming event/message being responded to
   * @param envelope - The message to be sent {format, message}
   * @param options - Might contain additional settings
   * @param _context - Contextual data
   *
   * @returns The web's response, otherwise an error
   */
  async sendMessage(
    event: WebEventWrapper<N>,
    envelope: StdOutgoingEnvelope,
    options: BlockOptions,
    _context?: any,
  ): Promise<{ mid: string }> {
    const messageBase: Web.OutgoingMessageBase = await this._formatMessage(
      envelope,
      options,
    );
    const subscriber = event.getSender();

    const message: Web.OutgoingMessage = {
      ...messageBase,
      mid: this.generateId(),
      author: 'chatbot',
      createdAt: new Date(),
      handover: !!(options && options.assignTo),
    };
    const next = async (): Promise<any> => {
      this.broadcast(subscriber, StdEventType.message, message);
      return { mid: message.mid };
    };

    if (options && options.typing) {
      const autoTimeout =
        message && message.data && 'text' in message.data
          ? message.data.text.length * 10
          : 1000;
      const timeout =
        typeof options.typing === 'number' ? options.typing : autoTimeout;
      try {
        await this.sendTypingIndicator(subscriber, timeout);
        return next();
      } catch (err) {
        this.logger.error('Failed in sending typing indicator ', err);
      }
    }

    return next();
  }

  /**
   * Send a typing indicator (waterline) to the end user for a given duration
   *
   * @param recipient - The end-user object
   * @param timeout - Duration of the typing indicator in milliseconds
   */
  async sendTypingIndicator(
    recipient: Subscriber,
    timeout: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.broadcast(recipient, StdEventType.typing, true);
        setTimeout(() => {
          this.broadcast(recipient, StdEventType.typing, false);
          return resolve();
        }, timeout);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Fetch the end-user profile data
   *
   * @param event - The message event received
   *
   * @returns The web's response, otherwise an error
   */
  async getSubscriberData(
    event: WebEventWrapper<N>,
  ): Promise<SubscriberCreateDto> {
    const sender = event.getSender();
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...rest
    } = sender;
    const subscriber: SubscriberCreateDto = {
      ...rest,
      channel: Subscriber.getChannelData(sender),
    };
    return subscriber;
  }

  /**
   * Checks if the request is authorized to download a given attachment file.
   *
   * @param attachment The attachment object
   * @param req - The HTTP express request object.
   * @return True, if requester is authorized to download the attachment
   */
  public async hasDownloadAccess(attachment: Attachment, req: Request) {
    const subscriberId = req.session.web?.profile?.id as string;
    if (attachment.access === AttachmentAccess.Public) {
      return true;
    } else if (!subscriberId) {
      this.logger.warn(
        `Unauthorized access attempt to attachment ${attachment.id}`,
      );
      return false;
    } else if (
      attachment.createdByRef === AttachmentCreatedByRef.Subscriber &&
      subscriberId === attachment.createdBy
    ) {
      // Either subscriber wants to access the attachment he sent
      return true;
    } else {
      // Or, he would like to access an attachment sent to him privately
      const message = await this.messageService.findOne({
        ['recipient' as any]: subscriberId,
        $or: [
          { 'message.attachment.payload.id': attachment.id },
          {
            'message.attachment': {
              $elemMatch: { 'payload.id': attachment.id },
            },
          },
        ],
      });

      return !!message;
    }
  }

  /**
   * Web channel middleware
   *
   * @param req Express Request
   * @param res Express Response
   * @param next Callback function
   */
  async middleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!this.isSocketRequest(req)) {
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        // Handle multipart uploads (Long Pooling only)
        upload(req, res, next);
        return;
      } else if (req.headers['content-type']?.includes('text/plain')) {
        // Handle plain text payloads as JSON (retro-compatibility)
        const textParser = bodyParser.text({ type: 'text/plain' });

        textParser(req, res, () => {
          try {
            req.body =
              typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            next();
          } catch (err) {
            next(err);
          }
        });
        return;
      }
    }

    // Do nothing
    next();
  }
}

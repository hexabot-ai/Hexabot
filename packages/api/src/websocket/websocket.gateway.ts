/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type WorkflowEventMap } from '@hexabot-ai/agentic';
import { StdEventType, Subscriber, type WorkflowRun } from '@hexabot-ai/types';
import { ForbiddenException, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import Cookie from 'cookie';
import signature from 'cookie-signature';
import { Request } from 'express';
import { Session as ExpressSession, SessionData } from 'express-session';
import { ExtendedError, Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { sync as uid } from 'uid-safe';

import { SourceOrmEntity } from '@/channel/entities/source.entity';
import { config } from '@/config';
import { CONSOLE_CHANNEL_NAME } from '@/extensions/channels/console/settings.schema';
import { WEB_CHANNEL_NAME } from '@/extensions/channels/web/settings.schema';
import { LoggerService } from '@/logger/logger.service';
import { PermissionService } from '@/user/services/permission.service';
import { UserService } from '@/user/services/user.service';
import { Action } from '@/user/types/action.type';
import { type TModel } from '@/user/types/model.type';
import { rolesCanPerform } from '@/user/utilities/permissions';
import { getSessionMiddleware } from '@/utils/constants/session-middleware';
import { getSessionStore } from '@/utils/constants/session-store';
import { type WorkflowContextState } from '@/workflow/types';

import { IOIncomingMessage, IOMessagePipe } from './pipes/io-message.pipe';
import { SocketEventDispatcherService } from './services/socket-event-dispatcher.service';
import { Room } from './types';
import { buildWebSocketGatewayOptions } from './utils/gateway-options';
import { SocketRequest } from './utils/socket-request';
import { SocketResponse } from './utils/socket-response';

@WebSocketGateway(buildWebSocketGatewayOptions())
export class WebsocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    private readonly logger: LoggerService,
    private readonly eventEmitter: EventEmitter2,
    private readonly socketEventDispatcherService: SocketEventDispatcherService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @WebSocketServer() io: Server;

  broadcastWorkflowEvent({
    initiatorId,
    ...rest
  }: WorkflowEventMap[keyof WorkflowEventMap] &
    Partial<Pick<WorkflowContextState, 'initiatorId'>> & {
      workflowId: string;
      threadId?: string;
      workflowRun?: Omit<WorkflowRun, 'checkpoint'>;
      workflowEvent: string;
      t: number;
    }): void {
    const roomName = initiatorId
      ? `${Room.WORKFLOW}_${initiatorId}`
      : Room.WORKFLOW;

    this.io.to(roomName).emit('workflow', rest);
  }

  broadcast(
    subscriber: Subscriber,
    type: StdEventType,
    content: any,
    excludedRooms: string[] = [],
  ) {
    if (!subscriber.foreignId) {
      return;
    }

    this.io.to(subscriber.foreignId).except(excludedRooms).emit(type, content);
  }

  /**
   * Returns currently connected authenticated user IDs (deduplicated).
   */
  getConnectedAuthenticatedUserIds(): string[] {
    if (!this.io?.sockets?.sockets) {
      return [];
    }

    const connectedUserIds = new Set<string>();

    for (const [, socket] of this.io.sockets.sockets) {
      const userId = socket.request?.session?.passport?.user?.id;

      if (typeof userId === 'string' && userId.trim()) {
        connectedUserIds.add(userId);
      }
    }

    return Array.from(connectedUserIds);
  }

  async createAndStoreSession(client: Socket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sid = uid(24); // Sign the session ID before sending
      const signedSid = 's:' + signature.sign(sid, config.session.secret);
      // Send session ID to client to set cookie
      const cookies = Cookie.serialize(
        config.session.name,
        signedSid,
        config.session.cookie,
      );
      const newSession: SessionData = {
        cookie: {
          // Prevent access from client-side javascript
          httpOnly: true,

          // Restrict to path
          path: '/',

          originalMaxAge: config.session.cookie.maxAge,
        },
        passport: { user: {} },
      }; // Initialize your session object as needed
      getSessionStore().set(sid, newSession, (err) => {
        if (err) {
          this.logger.error('Error saving session:', err);

          return reject(new Error('Unable to establish a new socket session'));
        }

        client.emit('set-cookie', cookies);
        // Optionally set the cookie on the client's handshake object if needed
        client.handshake.headers.cookie = cookies;

        this.logger.verbose(`
          Could not fetch session, since connecting socket has no cookie in its handshake.
          Generated a one-time-use cookie:
          ${client.handshake.headers.cookie}
          and saved it on the socket handshake.
  
          > This means the socket started off with an empty session, i.e. (req.session === {})
          > That "anonymous" session will only last until the socket is disconnected. To work around this,
          > make sure the socket sends a 'cookie' header or query param when it initially connects.
          > (This usually arises due to using a non-browser client such as a native iOS/Android app,
          > React Native, a Node.js script, or some other connected device. It can also arise when
          > attempting to connect a cross-origin socket in the browser, particularly for Safari users.
          > To work around this, either supply a cookie manually, or ignore this message and use an
          > approach other than sessions-- e.g. an auth token.)
        `);

        return resolve();
      });
    });
  }

  loadSession(
    sessionID: string,
    next: (err: Error, session: any) => void,
  ): void {
    getSessionStore().get(sessionID, (err, session) => {
      this.logger.verbose('Retrieved socket session', err || session);

      return next(err, session);
    });
  }

  private normalizeSourceId(value: string | null): string | null {
    if (!value || !isUUID(value)) {
      return null;
    }

    return value;
  }

  private async findActiveSource(
    sourceId: string,
  ): Promise<SourceOrmEntity | null> {
    if (!this.dataSource) {
      return null;
    }

    return await this.dataSource.getRepository(SourceOrmEntity).findOne({
      where: {
        id: sourceId,
        state: true,
      },
    });
  }

  afterInit(): void {
    this.logger.log('Initialized websocket gateway');

    if (config.env !== 'test') {
      // Share the same session middleware (main.ts > express-session)
      this.io.engine.use(getSessionMiddleware());
      this.io.engine.on('initial_headers', (headers, request: Request) => {
        const sessionId = request.session.id;
        if (sessionId) {
          const signedSid =
            's:' + signature.sign(sessionId, config.session.secret);
          const cookie = request.session.cookie;
          // Send session ID to client to set cookie
          const cookies = Cookie.serialize(config.session.name, signedSid, {
            path: cookie.path,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            expires: cookie.expires,
          });

          headers['Set-Cookie'] = cookies;
        }
      });
    }

    // Handle session
    this.io.use(async (client, next) => {
      this.logger.verbose('Client connected, attempting to load session.');
      try {
        const { searchParams } = new URL(`ws://localhost${client.request.url}`);

        if (config.env === 'test') {
          await this.createAndStoreSession(client);
          next();

          return;
        }
        const session = client.request.session;
        const rawSourceId = searchParams.get('source_id');
        const sourceId = this.normalizeSourceId(rawSourceId);
        const userId = session.passport?.user?.id;

        if (!rawSourceId && userId) {
          // Core websocket connection for system notifications (not the web/console channel one)
          next();

          return;
        }

        if (!sourceId) {
          next(
            new Error('Missing or invalid source_id in websocket handshake'),
          );

          return;
        }

        const source = await this.findActiveSource(sourceId);

        if (!source) {
          next(new Error('Source is not available'));

          return;
        }

        const isWebCompatibleSource =
          source.channel === WEB_CHANNEL_NAME ||
          source.channel === CONSOLE_CHANNEL_NAME;

        if (!isWebCompatibleSource) {
          next(new Error('Source channel is not compatible with websocket'));

          return;
        }

        session.web = {
          ...session.web,
          sourceId: source.id,
        };

        if (
          // Either the WS connection is with an authenticated user
          userId
        ) {
          session.save((err) => {
            if (err) {
              this.logger.error('WS : Unable to save session!', err);
            }
          });
          next();
        } else if (
          // Or, the WS connection is established with a chat widget using the web channel (subscriber)
          source.channel === WEB_CHANNEL_NAME
        ) {
          session.anonymous =
            typeof session.anonymous === 'undefined' ? true : session.anonymous;
          session.save((err) => {
            if (err) {
              this.logger.error('WS : Unable to save session!', err);
            }
          });
          next();
        } else {
          next(new Error('Unauthorized to connect to WS'));
        }
      } catch (e) {
        this.logger.warn('Something unexpected happening');
        next(e as ExtendedError);
      }
    });
  }

  handleConnection(client: Socket, ..._args: any[]): void {
    const { sockets } = this.io.sockets;
    this.logger.log(`Client id: ${client.id} connected`);
    this.logger.debug(`Number of connected clients: ${sockets?.size}`);

    this.eventEmitter.emit(`hook:websocket:connection`, client);
  }

  @OnEvent('hook:user:logout')
  disconnectSockets({ id }: ExpressSession) {
    for (const [, socket] of this.io.sockets.sockets) {
      if (socket.request.session.id === id) {
        socket.disconnect(true);
      }
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`Client id: ${client.id} disconnected`);
    // Configurable custom afterDisconnect logic here
    // (default: do nothing)
    if (!config.sockets.afterDisconnect) {
      return;
    }

    try {
      // Check if the afterDisconnect logic is an asynchronous function
      await config.sockets.afterDisconnect(client);
    } catch (e) {
      // Catch synchronous errors
      this.logger.error(
        'Error in `config.sockets.afterDisconnect` lifecycle callback:',
        e,
      );
    }
  }

  @SubscribeMessage('healthcheck')
  handleHealthCheck() {
    return { event: 'event', data: 'OK' };
  }

  private async dispatchSocketMessage(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head',
    payload: IOIncomingMessage,
    client: Socket,
  ) {
    const request = new SocketRequest(client, method, payload);
    const response = new SocketResponse();
    await this.socketEventDispatcherService.handleEvent(
      method,
      payload.url,
      request,
      response,
    );

    return await response.getPromise();
  }

  @SubscribeMessage('get')
  async handleGet(
    @MessageBody(new IOMessagePipe()) payload: IOIncomingMessage,
    @ConnectedSocket() client: Socket,
  ) {
    return await this.dispatchSocketMessage('get', payload, client);
  }

  @SubscribeMessage('post')
  async handlePost(
    @MessageBody(new IOMessagePipe()) payload: IOIncomingMessage,
    @ConnectedSocket() client: Socket,
  ) {
    return await this.dispatchSocketMessage('post', payload, client);
  }

  @SubscribeMessage('put')
  async handlePut(
    @MessageBody(new IOMessagePipe()) payload: IOIncomingMessage,
    @ConnectedSocket() client: Socket,
  ) {
    return await this.dispatchSocketMessage('put', payload, client);
  }

  @SubscribeMessage('patch')
  async handlePatch(
    @MessageBody(new IOMessagePipe()) payload: IOIncomingMessage,
    @ConnectedSocket() client: Socket,
  ) {
    return await this.dispatchSocketMessage('patch', payload, client);
  }

  @SubscribeMessage('delete')
  async handleDelete(
    @MessageBody(new IOMessagePipe()) payload: IOIncomingMessage,
    @ConnectedSocket() client: Socket,
  ) {
    return await this.dispatchSocketMessage('delete', payload, client);
  }

  @SubscribeMessage('options')
  async handleOptions(
    @MessageBody(new IOMessagePipe()) payload: IOIncomingMessage,
    @ConnectedSocket() client: Socket,
  ) {
    return await this.dispatchSocketMessage('options', payload, client);
  }

  @SubscribeMessage('head')
  async handleHead(
    @MessageBody(new IOMessagePipe()) payload: IOIncomingMessage,
    @ConnectedSocket() client: Socket,
  ) {
    return await this.dispatchSocketMessage('head', payload, client);
  }

  /**
   * Determines if a user has permission to perform a specific action.
   *
   * @param userId - The user id
   * @param model - The model
   * @param action - The action
   */
  async hasAbility(userId: string, model: TModel, action: Action) {
    const user = await this.userService.findOne(userId);
    const roleIds = user?.roles || [];
    const permissions = await this.permissionService.getPermissions();

    if (
      permissions &&
      model &&
      rolesCanPerform(permissions, roleIds, model, action)
    ) {
      return true;
    }
  }

  /**
   * Allows a given socket to join a room.
   *
   * @param req - Socket request
   * @param room - The room name
   */
  async joinSockets<R extends Room>(
    req: SocketRequest,
    room: R,
    model?: TModel,
  ) {
    const userId = req.session.passport?.user?.id;
    if (!userId) {
      throw new Error(
        'Only authenticated users are allowed to join workflow rooms!',
      );
    }

    const hasAbility = model
      ? await this.hasAbility(userId, model, Action.READ)
      : false;

    if (!hasAbility) {
      throw new ForbiddenException('You are not authorized to subscribe!');
    }
    const roomId = `${room}_${userId}` as const;

    await req.socket.join(roomId);

    return roomId;
  }
}

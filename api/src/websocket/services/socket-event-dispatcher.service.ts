/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Mutex } from 'async-mutex';
import { Socket } from 'socket.io';

import { LoggerService } from '@/logger/logger.service';

import { SocketEventMetadataStorage } from '../storage/socket-event-metadata.storage';
import { SocketRequest } from '../utils/socket-request';
import { SocketResponse } from '../utils/socket-response';

type Handler = (req: any, res: SocketResponse) => Promise<any>;

export type SocketMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | string;

@Injectable()
export class SocketEventDispatcherService implements OnModuleInit {
  private routeHandlers: { [key: SocketMethod]: Map<string, Handler> } = {
    get: new Map(),
    post: new Map(),
    put: new Map(),
    patch: new Map(),
    delete: new Map(),
  };

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly modulesContainer: ModulesContainer,
    private readonly logger: LoggerService,
  ) {}

  @OnEvent('hook:websocket:connection')
  handleConnection(client: Socket) {
    client.data.mutex = new Mutex();
  }

  async handleEvent(
    socketMethod: SocketMethod,
    path: string,
    req: SocketRequest,
    res: SocketResponse,
  ) {
    // Prevent racing conditions from the same socket
    const socketData = req.socket.data;
    const release = await socketData.mutex.acquire();

    try {
      const handlers = this.routeHandlers[socketMethod];
      const foundHandler = Array.from(handlers.entries()).find(([key, _]) => {
        const urlPathname = new URL(req.url, 'http://localhost').pathname;
        const keyUrlPathName = new URL(key, 'http://localhost').pathname;

        return urlPathname === keyUrlPathName;
      });

      if (!foundHandler) {
        return res.status(HttpStatus.NOT_FOUND).send({ message: 'Not Found' });
      }

      const [_, handler] = foundHandler;

      await new Promise<Error | void>(async (resolve, reject) => {
        req.session.reload((error) => {
          if (error) {
            reject(new UnauthorizedException());
          } else {
            resolve();
          }
        });
      });

      const response = await handler(req, res);

      // Update session object (similar to what is done in express-session)
      await new Promise<void>((resolve) => {
        req.session.save((err) => {
          if (err) {
            this.logger.error('WS : Unable to update session!', err);
          }
          resolve();
        });
      });

      return response;
    } catch (error) {
      this.logger.error('Error while handling Web-socket event', error);
      return this.handleException(error, req, res);
    } finally {
      release();
    }
  }

  onModuleInit() {
    const visitedEventProviders = new Set<object>();
    const allProviders = Array.from(this.modulesContainer.values())
      .map(
        (module) =>
          module.providers.values() as MapIterator<InstanceWrapper<object>>,
      )
      .reduce(
        (prev, curr) => prev.concat(Array.from(curr)),
        [] as InstanceWrapper<object>[],
      )
      .filter((provider) => !!provider.instance);

    for (const provider of allProviders) {
      const instance = provider.instance;
      const events = SocketEventMetadataStorage.getMetadataFor(instance);
      if (events.length === 0) {
        continue;
      }

      const providerPrototype = Object.getPrototypeOf(instance);
      if (visitedEventProviders.has(providerPrototype)) {
        continue;
      }
      visitedEventProviders.add(providerPrototype);

      events.forEach((event) => {
        // Error Handling
        if (this.routeHandlers[event.socketMethod] === undefined) {
          throw new Error(`Invalid event type: ${event.socketMethod}`);
        }

        if (this.routeHandlers[event.socketMethod].has(event.path)) {
          throw new Error(
            `Duplicate event: ${event.socketMethod} ${event.path}`,
          );
        }

        // add event handler
        this.routeHandlers[event.socketMethod].set(
          event.path,
          // bind the method to the instance
          event.method.bind(instance),
        );
      });
    }
  }

  private handleException(
    error: Error,
    { socket }: SocketRequest,
    res: SocketResponse,
  ) {
    this.eventEmitter.emit('hook:websocket:error', socket, error);

    if (error instanceof HttpException) {
      // Handle known HTTP exceptions
      return res.status(error.getStatus()).send(error.getResponse());
    } else {
      // Handle generic errors
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send({ message: 'Internal Server Error' });
    }
  }
}

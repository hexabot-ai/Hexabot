/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Socket } from 'socket.io-client';

import { IOIncomingMessage } from '../pipes/io-message.pipe';

export type SocketEventMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'options'
  | 'head';

type SocketEventMetadata = {
  path: string;
  method: (payload: IOIncomingMessage, client: Socket) => Promise<any>;
  propertyKey: string | symbol;
  socketMethod: SocketEventMethod;
};

export class SocketEventMetadataStorage {
  private static metadata = new Map<string, SocketEventMetadata[]>();

  static addEventMetadata(
    target: object,
    propertyKey: SocketEventMetadata['propertyKey'],
    metadata: Omit<SocketEventMetadata, 'propertyKey'>,
  ) {
    const key = target.constructor.name;
    if (!this.metadata.has(key)) {
      this.metadata.set(key, []);
    }

    this.metadata.get(key)?.push({ propertyKey, ...metadata });
  }

  static getMetadataFor(target: object) {
    return this.metadata.get(target.constructor.name) || [];
  }
}

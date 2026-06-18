/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { Socket } from 'socket.io-client';

import { IOIncomingMessage } from '../pipes/io-message.pipe';

type SocketEventMetadata = {
  path: string;
  method: (payload: IOIncomingMessage, client: Socket) => Promise<any>;
  propertyKey: string | symbol;
  socketMethod:
    | 'get'
    | 'post'
    | 'put'
    | 'patch'
    | 'delete'
    | 'options'
    | 'head';
};

export class SocketEventMetadataStorage {
  private static metadata = new WeakMap<object, SocketEventMetadata[]>();

  static addEventMetadata(
    target: object,
    propertyKey: SocketEventMetadata['propertyKey'],
    metadata: Omit<SocketEventMetadata, 'propertyKey'>,
  ) {
    if (!this.metadata.has(target)) {
      this.metadata.set(target, []);
    }

    this.metadata.get(target)?.push({ propertyKey, ...metadata });
  }

  static getMetadataFor(target: object) {
    const metadata: SocketEventMetadata[] = [];
    let prototype =
      typeof target === 'function'
        ? target.prototype
        : Object.getPrototypeOf(target);

    while (prototype && prototype !== Object.prototype) {
      metadata.push(...(this.metadata.get(prototype) || []));
      prototype = Object.getPrototypeOf(prototype);
    }

    return metadata;
  }
}

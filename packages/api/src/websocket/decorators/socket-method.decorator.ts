/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  SocketEventMetadataStorage,
  type SocketEventMethod,
} from '../storage/socket-event-metadata.storage';

/**
 * Builds the decorator that routes socket requests of `socketMethod` on a
 * path to the decorated method.
 */
const socketMethodDecorator =
  (socketMethod: SocketEventMethod) =>
  (path: string): MethodDecorator =>
  (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    SocketEventMetadataStorage.addEventMetadata(target, propertyKey, {
      socketMethod,
      path,
      method: descriptor.value,
    });
  };

export const SocketGet = socketMethodDecorator('get');

export const SocketPost = socketMethodDecorator('post');

export const SocketPut = socketMethodDecorator('put');

export const SocketPatch = socketMethodDecorator('patch');

export const SocketDelete = socketMethodDecorator('delete');

export const SocketOptions = socketMethodDecorator('options');

export const SocketHead = socketMethodDecorator('head');

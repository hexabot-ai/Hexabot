/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { SocketEventMetadataStorage } from '../storage/socket-event-metadata.storage';

import {
  SocketDelete,
  SocketGet,
  SocketHead,
  SocketOptions,
  SocketPatch,
  SocketPost,
  SocketPut,
} from './socket-method.decorator';

class SocketMethodDecoratorSpecController {
  @SocketGet('/items')
  @SocketPost('/items')
  async list() {}

  @SocketPut('/items/:id')
  async replace() {}

  @SocketPatch('/items/:id')
  async update() {}

  @SocketDelete('/items/:id')
  async remove() {}

  @SocketOptions('/items')
  async options() {}

  @SocketHead('/items')
  async head() {}
}

describe('socket method decorators', () => {
  it('registers each decorated method under its socket method and path', () => {
    const controller = new SocketMethodDecoratorSpecController();
    const { prototype } = SocketMethodDecoratorSpecController;
    const events = SocketEventMetadataStorage.getMetadataFor(controller).map(
      ({ socketMethod, path, propertyKey, method }) => ({
        socketMethod,
        path,
        propertyKey,
        method,
      }),
    );

    expect(events).toStrictEqual([
      {
        socketMethod: 'post',
        path: '/items',
        propertyKey: 'list',
        method: prototype.list,
      },
      {
        socketMethod: 'get',
        path: '/items',
        propertyKey: 'list',
        method: prototype.list,
      },
      {
        socketMethod: 'put',
        path: '/items/:id',
        propertyKey: 'replace',
        method: prototype.replace,
      },
      {
        socketMethod: 'patch',
        path: '/items/:id',
        propertyKey: 'update',
        method: prototype.update,
      },
      {
        socketMethod: 'delete',
        path: '/items/:id',
        propertyKey: 'remove',
        method: prototype.remove,
      },
      {
        socketMethod: 'options',
        path: '/items',
        propertyKey: 'options',
        method: prototype.options,
      },
      {
        socketMethod: 'head',
        path: '/items',
        propertyKey: 'head',
        method: prototype.head,
      },
    ]);
  });
});

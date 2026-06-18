/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { ModulesContainer } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { LoggerService } from '@/logger/logger.service';
import { SocketPost } from '@/websocket/decorators/socket-method.decorator';

import { SocketEventDispatcherService } from './socket-event-dispatcher.service';

class DuplicateProviderSocketHandler {
  @SocketPost('/message/subscribe/')
  async subscribe() {
    return undefined;
  }
}

class FirstCollidingSocketHandler {
  @SocketPost('/message/subscribe/')
  async subscribe() {
    return undefined;
  }
}

class SecondCollidingSocketHandler {
  @SocketPost('/message/subscribe/')
  async subscribe() {
    return undefined;
  }
}

const createModulesContainer = (instances: object[]) =>
  new Map(
    instances.map((instance, index) => [
      `module-${index}`,
      {
        providers: new Map([[`provider-${index}`, { instance }]]),
      },
    ]),
  ) as unknown as ModulesContainer;

const createDispatcher = (instances: object[]) =>
  new SocketEventDispatcherService(
    { emit: jest.fn() } as unknown as EventEmitter2,
    createModulesContainer(instances),
    { error: jest.fn() } as unknown as LoggerService,
  );

describe('SocketEventDispatcherService', () => {
  describe('onModuleInit', () => {
    it('registers a decorated provider type once when it appears multiple times', () => {
      const dispatcher = createDispatcher([
        new DuplicateProviderSocketHandler(),
        new DuplicateProviderSocketHandler(),
      ]);

      expect(() => dispatcher.onModuleInit()).not.toThrow();
    });

    it('throws when different provider types register the same event', () => {
      const dispatcher = createDispatcher([
        new FirstCollidingSocketHandler(),
        new SecondCollidingSocketHandler(),
      ]);

      expect(() => dispatcher.onModuleInit()).toThrow(
        'Duplicate event: post /message/subscribe/',
      );
    });
  });
});

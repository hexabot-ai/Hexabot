/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { IntegrationHealthResponse } from '@hexabot-ai/types';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import pLimit from 'p-limit';

import { BaseOrmEntity } from './database';
import { HealthService } from './health/health.service';
import { I18nService } from './i18n/services/i18n.service';
import { PermissionService } from './user/services/permission.service';
import { UserService } from './user/services/user.service';
import { Action } from './user/types/action.type';
import { EHook } from './utils';
import { EmitEventProps } from './utils/types/entity-event.types';
import {
  SocketGet,
  SocketPost,
  SocketReq,
  SocketRequest,
  SocketRes,
  SocketResponse,
  WebsocketGateway,
} from './websocket';

type EntityPostHookEvent = EmitEventProps<
  BaseOrmEntity,
  EHook.postCreate | EHook.postUpdate | EHook.postDelete
> & { entityName: string };

@Injectable()
export class AppService {
  constructor(
    private readonly i18n: I18nService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly gateway: WebsocketGateway,
    private readonly healthService: HealthService,
  ) {}

  getHello(): string {
    return this.i18n.t('welcome', { lang: 'en' });
  }

  async getIntegrationHealth(): Promise<IntegrationHealthResponse> {
    return await this.healthService.getIntegrationHealth();
  }

  @SocketGet('/entity/subscribe/')
  @SocketPost('/entity/subscribe/')
  async subscribeToEntityRooms(
    @SocketReq() req: SocketRequest,
    @SocketRes() res: SocketResponse,
  ) {
    const userId = req.session.passport?.user?.id;

    if (!userId) {
      throw new ForbiddenException(
        'Only authenticated users are allowed to join entity rooms!',
      );
    }

    const user = await this.userService.findOne(userId);

    if (!user) {
      throw new ForbiddenException('You are not authorized to subscribe!');
    }

    const roleIds = user.roles ?? [];
    const permissions = await this.permissionService.getPermissions();
    const subscribe = Array.from(
      new Set(
        roleIds.flatMap((roleId) =>
          Object.entries(permissions[roleId] || {})
            .filter(([, actions]) => actions.includes(Action.READ))
            .map(([model]) => model.toLowerCase()),
        ),
      ),
    );
    const socketLimit = pLimit(15);
    await Promise.all(
      subscribe.map((room) => socketLimit(() => req.socket.join(room))),
    );

    return res.status(200).json({
      success: true,
      subscribe,
    });
  }

  private postActionToOp(action: EHook) {
    return action.replace('post', '').toLowerCase();
  }

  @OnEvent('hook:*:postCreate')
  @OnEvent('hook:*:postUpdate')
  @OnEvent('hook:*:postDelete')
  handleEntityPostEvents(event: EntityPostHookEvent) {
    this.broadcastEntityMutationEvent(event);
  }

  private broadcastEntityMutationEvent(event: EntityPostHookEvent): void {
    const { action, entityName, entity } = event;

    if (!entity || typeof entity.toPlainCls !== 'function') {
      throw new Error('Unable to extract entity event data');
    }

    const room = entityName.toLowerCase();

    this.gateway.io.to(room).emit('entity', {
      entity: entityName,
      op: this.postActionToOp(action),
      data: entity.toPlainCls(),
    });
  }
}

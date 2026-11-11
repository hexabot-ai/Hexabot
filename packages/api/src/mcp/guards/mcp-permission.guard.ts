/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PermissionService } from '@/user/services/permission.service';
import { Action } from '@/user/types/action.type';
import { TModel } from '@/user/types/model.type';

import { HexabotMcpRequest } from '../types';

export const MCP_PERMISSION_METADATA_KEY = 'mcp:hexabot-permission';

export type McpPermissionMetadata = {
  model: TModel;
  action: Action;
};

@Injectable()
export class McpPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<McpPermissionMetadata>(
      MCP_PERMISSION_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<HexabotMcpRequest>();
    const user = request.hexabotUser ?? request.user;
    const roleIds = Array.isArray(user?.roles) ? user.roles : [];

    if (roleIds.length === 0) {
      throw new ForbiddenException('MCP tool requires a Hexabot role');
    }

    const permissions = await this.permissionService.getPermissions();
    const hasPermission = roleIds.some((roleId) =>
      permissions[roleId]?.[permission.model]?.includes(permission.action),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `MCP tool requires ${permission.action} permission on ${permission.model}`,
      );
    }

    return true;
  }
}

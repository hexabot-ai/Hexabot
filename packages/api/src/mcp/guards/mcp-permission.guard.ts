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

import {
  MCP_PERMISSION_METADATA_KEY,
  McpPermissionMetadata,
} from '@/mcp/decorators/mcp-permission.decorator';
import { PermissionService } from '@/user/services/permission.service';

import { HexabotMcpRequest } from '../types';

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

    // Note: MCP bearer tokens (`hbt_mcp_…`) are intentionally unscoped — they
    // inherit the owner's full role permissions checked above — so there is no
    // per-token scope to enforce here (unlike API tokens on the REST surface).
    return true;
  }
}

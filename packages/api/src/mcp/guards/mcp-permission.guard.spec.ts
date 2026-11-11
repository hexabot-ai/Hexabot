/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { Reflector } from '@nestjs/core';

import { PermissionService } from '@/user/services/permission.service';
import { Action } from '@/user/types/action.type';

import { HexabotMcpRequest } from '../types';

import {
  MCP_PERMISSION_METADATA_KEY,
  McpPermissionGuard,
  McpPermissionMetadata,
} from './mcp-permission.guard';

const buildContext = (
  request: HexabotMcpRequest,
  permission?: McpPermissionMetadata,
): ExecutionContext => {
  const handler = () => undefined;
  if (permission) {
    Reflect.defineMetadata(MCP_PERMISSION_METADATA_KEY, permission, handler);
  }

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => handler,
    getClass: () => class TestMcpTool {},
  } as unknown as ExecutionContext;
};

describe('McpPermissionGuard', () => {
  it('allows a tool when one Hexabot role grants the required permission', async () => {
    const permissionService = {
      getPermissions: jest.fn().mockResolvedValue({
        roleA: {
          workflow: [Action.READ],
        },
      }),
    } as unknown as PermissionService;
    const guard = new McpPermissionGuard(new Reflector(), permissionService);
    const context = buildContext(
      { hexabotUser: { id: 'user-id', roles: ['roleA'] } } as HexabotMcpRequest,
      { model: 'workflow', action: Action.READ },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a tool when Hexabot roles do not grant the permission', async () => {
    const permissionService = {
      getPermissions: jest.fn().mockResolvedValue({
        roleA: {
          workflow: [Action.READ],
        },
      }),
    } as unknown as PermissionService;
    const guard = new McpPermissionGuard(new Reflector(), permissionService);
    const context = buildContext(
      { hexabotUser: { id: 'user-id', roles: ['roleA'] } } as HexabotMcpRequest,
      { model: 'workflow', action: Action.UPDATE },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MCP_GUARDS_METADATA_KEY } from '@rekog/mcp-nest';

import { Action } from '@/user/types/action.type';

import {
  MCP_PERMISSION_METADATA_KEY,
  McpPermissionGuard,
} from '../guards/mcp-permission.guard';

import { McpPermission } from './mcp-permission.decorator';

class McpPermissionDecoratorSpecTools {
  @McpPermission('workflow', Action.READ)
  async listWorkflows() {}
}

describe('McpPermission', () => {
  const tool = McpPermissionDecoratorSpecTools.prototype.listWorkflows;

  it('stores the permission the tool requires', () => {
    expect(Reflect.getMetadata(MCP_PERMISSION_METADATA_KEY, tool)).toEqual({
      model: 'workflow',
      action: Action.READ,
    });
  });

  it('guards the tool with the permission guard', () => {
    expect(Reflect.getMetadata(MCP_GUARDS_METADATA_KEY, tool)).toEqual([
      McpPermissionGuard,
    ]);
  });
});

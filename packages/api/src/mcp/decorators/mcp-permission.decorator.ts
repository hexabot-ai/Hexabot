/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ToolGuards } from '@rekog/mcp-nest';

import { Action } from '@/user/types/action.type';
import { TModel } from '@/user/types/model.type';

import {
  MCP_PERMISSION_METADATA_KEY,
  McpPermissionGuard,
  type McpPermissionMetadata,
} from '../guards/mcp-permission.guard';

/**
 * Restricts an MCP tool to the users whose roles grant `action` on `model`:
 * `McpPermissionGuard` checks it before each call, and leaves the tool out of
 * the tool list of the others.
 */
export const McpPermission = (model: TModel, action: Action): MethodDecorator =>
  applyDecorators(
    SetMetadata(MCP_PERMISSION_METADATA_KEY, {
      model,
      action,
    } satisfies McpPermissionMetadata),
    ToolGuards([McpPermissionGuard]),
  );

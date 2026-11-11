/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from '@hexabot-ai/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';

import { McpServerOrmEntity } from '@/workflow/entities/mcp-server.entity';
import { McpServerService } from '@/workflow/services/mcp-server.service';
import { McpServerTransport } from '@/workflow/types';

import { McpPermission } from '../decorators/mcp-permission.decorator';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import {
  mcpServerPayloadSchema,
  PaginationArgs,
  paginationSchema,
  uuidSchema,
} from './hexabot-mcp.schemas';

@Injectable()
export class HexabotMcpServerTools extends HexabotMcpToolBase {
  constructor(private readonly mcpServerService: McpServerService) {
    super();
  }

  @McpPermission('mcpserver', Action.READ)
  @Tool({
    name: 'hexabot_mcp_server_search',
    description: 'Search configured MCP servers.',
    parameters: z.object({
      query: z.string().optional(),
      enabled: z.boolean().optional(),
      transport: z.enum(McpServerTransport).optional(),
      credentialId: uuidSchema.optional(),
      ...paginationSchema,
    }),
  })
  async searchMcpServers(
    args: {
      query?: string;
      enabled?: boolean;
      transport?: McpServerTransport;
      credentialId?: string;
    } & PaginationArgs,
  ) {
    const base = {
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      ...(args.transport ? { transport: args.transport } : {}),
      ...(args.credentialId ? { credential: { id: args.credentialId } } : {}),
    };
    const where = args.query
      ? [
          { ...base, name: this.contains(args.query) },
          { ...base, url: this.contains(args.query) },
          { ...base, command: this.contains(args.query) },
        ]
      : base;

    return await this.listWithCount(
      this.mcpServerService,
      this.findOptions<McpServerOrmEntity>(args, where as any),
    );
  }

  @McpPermission('mcpserver', Action.READ)
  @Tool({
    name: 'hexabot_mcp_server_get',
    description: 'Read one configured MCP server.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getMcpServer(args: { id: string }) {
    const server = await this.mcpServerService.findOneAndPopulate(args.id);
    if (!server) {
      throw new NotFoundException(`MCP server ${args.id} not found`);
    }

    return server;
  }

  @McpPermission('mcpserver', Action.CREATE)
  @Tool({
    name: 'hexabot_mcp_server_create',
    description: 'Create an MCP server configuration.',
    parameters: z.object({
      ...mcpServerPayloadSchema,
      name: z.string().min(1),
    }),
  })
  async createMcpServer(args: {
    name: string;
    enabled?: boolean;
    transport?: McpServerTransport;
    url?: string | null;
    command?: string | null;
    args?: string[] | null;
    cwd?: string | null;
    credential?: string | null;
  }) {
    return await this.mcpServerService.create({
      enabled: true,
      transport: McpServerTransport.http,
      ...args,
    } as any);
  }

  @McpPermission('mcpserver', Action.UPDATE)
  @Tool({
    name: 'hexabot_mcp_server_update',
    description: 'Update an MCP server configuration.',
    parameters: z.object({
      id: uuidSchema,
      ...mcpServerPayloadSchema,
    }),
  })
  async updateMcpServer(args: { id: string } & Record<string, unknown>) {
    const { id, ...updates } = args;

    await this.getMcpServer({ id });

    return await this.mcpServerService.updateOne(id, updates as any);
  }
}

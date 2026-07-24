/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from '@hexabot-ai/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Tool, ToolGuards } from '@rekog/mcp-nest';
import { z } from 'zod';

import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import { ContentOrmEntity } from '@/cms/entities/content.entity';
import { ContentTypeService } from '@/cms/services/content-type.service';
import { ContentService } from '@/cms/services/content.service';

import { McpPermission } from '../decorators/mcp-permission.decorator';
import { McpPermissionGuard } from '../guards/mcp-permission.guard';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import {
  jsonObjectSchema,
  PaginationArgs,
  paginationSchema,
  uuidSchema,
} from './hexabot-mcp.schemas';

@Injectable()
export class HexabotCmsMcpTools extends HexabotMcpToolBase {
  constructor(
    private readonly contentTypeService: ContentTypeService,
    private readonly contentService: ContentService,
  ) {
    super();
  }

  @McpPermission('contenttype', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_type_search',
    description: 'Search CMS content types.',
    parameters: z.object({
      query: z.string().optional(),
      ...paginationSchema,
    }),
  })
  async searchContentTypes(args: { query?: string } & PaginationArgs) {
    const where = args.query ? { name: this.contains(args.query) } : {};

    return await this.listWithCount(
      this.contentTypeService,
      this.findOptions<ContentTypeOrmEntity>(args, where),
    );
  }

  @McpPermission('contenttype', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_type_get',
    description: 'Read one CMS content type.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getContentType(args: { id: string }) {
    const contentType = await this.contentTypeService.findOne(args.id);
    if (!contentType) {
      throw new NotFoundException(`Content type ${args.id} not found`);
    }

    return contentType;
  }

  @McpPermission('contenttype', Action.CREATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_type_create',
    description: 'Create a CMS content type.',
    parameters: z.object({
      name: z.string().min(1),
      schema: jsonObjectSchema,
    }),
  })
  async createContentType(args: {
    name: string;
    schema: Record<string, unknown>;
  }) {
    return await this.contentTypeService.create(args as any);
  }

  @McpPermission('contenttype', Action.UPDATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_type_update',
    description: 'Update a CMS content type.',
    parameters: z.object({
      id: uuidSchema,
      name: z.string().min(1).optional(),
      schema: jsonObjectSchema.optional(),
    }),
  })
  async updateContentType(args: { id: string } & Record<string, unknown>) {
    const { id, ...updates } = args;

    return await this.contentTypeService.updateOne(id, updates as any);
  }

  @McpPermission('content', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_search',
    description: 'Search CMS content records.',
    parameters: z.object({
      query: z.string().optional(),
      contentTypeId: uuidSchema.optional(),
      status: z.boolean().optional(),
      ...paginationSchema,
    }),
  })
  async searchContent(
    args: {
      query?: string;
      contentTypeId?: string;
      status?: boolean;
    } & PaginationArgs,
  ) {
    if (args.query) {
      return {
        items: await this.contentService.textSearch(args.query, {
          status: args.status,
          contentTypeId: args.contentTypeId,
          limit: args.limit,
        }),
        limit: args.limit,
        skip: 0,
      };
    }

    const where = {
      ...(args.contentTypeId
        ? { contentType: { id: args.contentTypeId } }
        : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    } as any;

    return await this.listWithCount(
      this.contentService,
      this.findOptions<ContentOrmEntity>(args, where),
    );
  }

  @McpPermission('content', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_get',
    description: 'Read one CMS content record.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getContent(args: { id: string }) {
    const content = await this.contentService.findOneAndPopulate(args.id);
    if (!content) {
      throw new NotFoundException(`Content ${args.id} not found`);
    }

    return content;
  }

  @McpPermission('content', Action.CREATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_create',
    description: 'Create a CMS content record.',
    parameters: z.object({
      contentType: uuidSchema,
      title: z.string().min(1),
      status: z.boolean().optional(),
      properties: jsonObjectSchema.optional(),
    }),
  })
  async createContent(args: {
    contentType: string;
    title: string;
    status?: boolean;
    properties?: Record<string, unknown>;
  }) {
    return await this.contentService.create(args as any);
  }

  @McpPermission('content', Action.UPDATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_content_update',
    description: 'Update a CMS content record.',
    parameters: z.object({
      id: uuidSchema,
      contentType: uuidSchema.optional(),
      title: z.string().min(1).optional(),
      status: z.boolean().optional(),
      properties: jsonObjectSchema.optional(),
    }),
  })
  async updateContent(args: { id: string } & Record<string, unknown>) {
    const { id, ...updates } = args;

    return await this.contentService.updateOne(id, updates as any);
  }

  @McpPermission('content', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_rag_content_search',
    description: 'Search indexed CMS content through Hexabot RAG retrieval.',
    parameters: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
      contentTypeId: uuidSchema.optional(),
      includeInactive: z.boolean().optional(),
    }),
  })
  async searchRagContent(args: {
    query: string;
    limit: number;
    contentTypeId?: string;
    includeInactive?: boolean;
  }) {
    return {
      items: await this.contentService.retrieve(args.query, {
        limit: args.limit,
        contentTypeId: args.contentTypeId,
        includeInactive: args.includeInactive,
      }),
    };
  }
}

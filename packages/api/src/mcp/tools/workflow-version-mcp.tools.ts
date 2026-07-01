/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { validateWorkflow } from '@hexabot-ai/agentic';
import {
  Action,
  type WorkflowVersion,
  type WorkflowVersionFull,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tool, ToolGuards } from '@rekog/mcp-nest';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { WorkflowVersionOrmEntity } from '@/workflow/entities/workflow-version.entity';
import { WorkflowVersionService } from '@/workflow/services/workflow-version.service';
import { WorkflowVersionAction } from '@/workflow/types';

import { McpPermission } from '../decorators/mcp-permission.decorator';
import { McpPermissionGuard } from '../guards/mcp-permission.guard';
import { HexabotMcpRequest } from '../types';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import {
  PaginationArgs,
  paginationSchema,
  uuidSchema,
} from './hexabot-mcp.schemas';
import { resolveRelationId } from './hexabot-mcp.utils';
import { HexabotWorkflowMcpHelper } from './workflow-mcp.helper';

@Injectable()
export class HexabotWorkflowVersionMcpTools extends HexabotMcpToolBase {
  constructor(
    private readonly workflowVersionService: WorkflowVersionService,
    private readonly actionService: ActionService,
    private readonly runtimeBindingsService: RuntimeBindingsService,
    private readonly workflowHelper: HexabotWorkflowMcpHelper,
  ) {
    super();
  }

  @McpPermission('workflowversion', Action.CREATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_yaml_commit',
    description:
      'Validate and commit workflow definition YAML as a new version.',
    parameters: z.object({
      workflowId: uuidSchema,
      definitionYml: z.string().min(1),
      message: z.string().optional(),
      parentVersion: uuidSchema.nullable().optional(),
      action: z
        .enum(WorkflowVersionAction)
        .default(WorkflowVersionAction.update),
    }),
  })
  async commitWorkflowYaml(
    args: {
      workflowId: string;
      definitionYml: string;
      message?: string;
      parentVersion?: string | null;
      action: WorkflowVersionAction;
    },
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const actorId = this.getActorId(request);
    const version = await this.workflowHelper.commitWorkflowDefinition({
      ...args,
      createdBy: actorId,
    });

    return this.workflowHelper.summarizeWorkflowVersion(version, {
      includeDefinitionYmlByteLength: true,
    });
  }

  @McpPermission('workflow', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_yaml_validate',
    description:
      'Validate workflow definition YAML without creating a workflow version.',
    parameters: z.object({
      definitionYml: z.string().min(1),
      validateActions: z.boolean().default(true),
    }),
  })
  async validateWorkflowYaml(args: {
    definitionYml: string;
    validateActions?: boolean;
  }) {
    const validateActions = args.validateActions ?? true;
    const validation = validateWorkflow(args.definitionYml, {
      bindingKinds: this.runtimeBindingsService.getRegistry(),
      ...(validateActions
        ? { actions: this.getWorkflowValidationActions() }
        : {}),
    });

    if (!validation.success) {
      return { valid: false, errors: validation.errors };
    }

    return { valid: true, errors: [], definition: validation.data };
  }

  @McpPermission('workflowversion', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_version_search',
    description:
      'List compact workflow definition version metadata for a workflow, excluding YAML bodies.',
    parameters: z.object({
      workflowId: uuidSchema,
      ...paginationSchema,
      sortBy: z.string().default('version'),
      sortDirection: z.enum(['ASC', 'DESC']).default('DESC'),
    }),
  })
  async searchWorkflowVersions(args: { workflowId: string } & PaginationArgs) {
    const where = { workflow: { id: args.workflowId } } as any;
    const result = await this.listWithCount(
      this.workflowVersionService,
      this.findOptions<WorkflowVersionOrmEntity>(args, where),
    );

    return {
      ...result,
      items: result.items.map((version) =>
        this.workflowHelper.summarizeWorkflowVersion(
          version as WorkflowVersion,
          { includeDefinitionYmlByteLength: true },
        ),
      ),
    };
  }

  @McpPermission('workflowversion', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_version_get',
    description:
      'Read compact workflow definition version metadata, excluding the YAML body.',
    parameters: z.object({
      id: uuidSchema,
      workflowId: uuidSchema.optional(),
    }),
  })
  async getWorkflowVersion(args: { id: string; workflowId?: string }) {
    const version = await this.workflowVersionService.findOneAndPopulate({
      where: {
        id: args.id,
        ...(args.workflowId ? { workflow: { id: args.workflowId } } : {}),
      } as any,
    });

    if (!version) {
      throw new NotFoundException(`Workflow version ${args.id} not found`);
    }

    return this.workflowHelper.summarizeWorkflowVersion(version, {
      includeDefinitionYmlByteLength: true,
    });
  }

  @McpPermission('workflowversion', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_yaml_get',
    description:
      'Read workflow definition YAML by workflowId/current version or versionId, with checksum, byte length, and UTF-8 byte offset/limit chunking.',
    parameters: z.object({
      workflowId: uuidSchema.optional(),
      versionId: uuidSchema.optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(64000).default(16000),
    }),
  })
  async getWorkflowYaml(args: {
    workflowId?: string;
    versionId?: string;
    offset?: number;
    limit?: number;
  }) {
    const version = await this.requireWorkflowVersionForYaml(args);
    const definitionYml = version.definitionYml;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 16000;
    const { chunk, chunkByteLength, endOffset, totalByteLength } =
      this.sliceUtf8Chunk(definitionYml, offset, limit);
    const workflowId = resolveRelationId(version.workflow);

    return {
      workflowId,
      versionId: version.id,
      version: version.version,
      checksum: version.checksum,
      definitionYmlByteLength: totalByteLength,
      definitionYmlLength: definitionYml.length,
      chunk: {
        offset,
        limit,
        unit: 'utf8Bytes',
        endOffset,
        length: chunk.length,
        byteLength: chunkByteLength,
        hasMore: endOffset < totalByteLength,
        nextOffset: endOffset < totalByteLength ? endOffset : null,
      },
      definitionYml: chunk,
    };
  }

  @McpPermission('workflowversion', Action.UPDATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_version_update',
    description:
      'Update workflow version metadata such as the version message.',
    parameters: z.object({
      id: uuidSchema,
      message: z.string().nullable().optional(),
    }),
  })
  async updateWorkflowVersion(args: { id: string; message?: string | null }) {
    const version = await this.workflowVersionService.updateOne(args.id, {
      message: args.message ?? undefined,
    });

    return this.workflowHelper.summarizeWorkflowVersion(version, {
      includeDefinitionYmlByteLength: true,
    });
  }

  @McpPermission('workflowversion', Action.CREATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_version_restore',
    description:
      'Restore a workflow to a previous YAML version by creating a new restore snapshot.',
    parameters: z.object({
      workflowId: uuidSchema,
      versionId: uuidSchema,
      message: z.string().optional(),
    }),
  })
  async restoreWorkflowVersion(
    args: { workflowId: string; versionId: string; message?: string },
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const version = await this.workflowHelper.restoreWorkflowVersionSnapshot(
      args,
      this.getActorId(request),
    );

    return this.workflowHelper.summarizeWorkflowVersion(version, {
      includeDefinitionYmlByteLength: true,
    });
  }

  @McpPermission('workflowversion', Action.CREATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_rollback',
    description:
      'Rollback a workflow to a previous YAML version by creating a new current restore snapshot.',
    parameters: z.object({
      workflowId: uuidSchema,
      versionId: uuidSchema,
      message: z.string().optional(),
    }),
  })
  async rollbackWorkflowVersion(
    args: { workflowId: string; versionId: string; message?: string },
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const version = await this.workflowHelper.restoreWorkflowVersionSnapshot(
      args,
      this.getActorId(request),
    );

    return this.workflowHelper.summarizeWorkflowVersion(version, {
      includeDefinitionYmlByteLength: true,
    });
  }

  private getWorkflowValidationActions() {
    return Object.fromEntries(
      Object.entries(this.actionService.getRegistry()).map(
        ([actionName, action]) => [
          actionName,
          { supportedBindings: action.supportedBindings ?? [] },
        ],
      ),
    );
  }

  private async requireWorkflowVersionForYaml(args: {
    workflowId?: string;
    versionId?: string;
  }): Promise<WorkflowVersion | WorkflowVersionFull> {
    if (!args.workflowId && !args.versionId) {
      throw new BadRequestException(
        'workflowId or versionId is required to read workflow YAML',
      );
    }

    if (args.versionId) {
      const version = await this.workflowVersionService.findOneAndPopulate({
        where: {
          id: args.versionId,
          ...(args.workflowId ? { workflow: { id: args.workflowId } } : {}),
        } as any,
      });

      if (!version) {
        throw new NotFoundException(
          `Workflow version ${args.versionId} not found`,
        );
      }

      return version;
    }

    const workflowId = args.workflowId;
    if (!workflowId) {
      throw new BadRequestException(
        'workflowId is required when versionId is not provided',
      );
    }
    const workflow = await this.workflowHelper.requireWorkflow(workflowId);
    const currentVersionId = resolveRelationId(workflow.currentVersion);
    if (!currentVersionId) {
      throw new NotFoundException(
        `Workflow ${workflowId} has no current version`,
      );
    }

    const version = await this.workflowVersionService.findOneAndPopulate({
      where: {
        id: currentVersionId,
        workflow: { id: workflowId },
      } as any,
    });

    if (!version) {
      throw new NotFoundException(
        `Workflow version ${currentVersionId} not found`,
      );
    }

    return version;
  }

  private sliceUtf8Chunk(
    value: string,
    offset: number,
    limit: number,
  ): {
    chunk: string;
    chunkByteLength: number;
    endOffset: number;
    totalByteLength: number;
  } {
    const totalByteLength = Buffer.byteLength(value, 'utf8');
    if (offset > totalByteLength) {
      throw new BadRequestException(
        `Offset ${offset} exceeds workflow YAML byte length ${totalByteLength}`,
      );
    }

    const startIndex = this.findUtf8IndexForOffset(value, offset);
    let endIndex = value.length;
    let byteOffset = offset;

    for (let index = startIndex; index < value.length; ) {
      const char = this.readCodePoint(value, index);
      const nextByteOffset = byteOffset + Buffer.byteLength(char, 'utf8');

      if (nextByteOffset > offset + limit) {
        if (index === startIndex) {
          throw new BadRequestException(
            `Limit ${limit} is too small to include the next UTF-8 character at offset ${offset}`,
          );
        }
        endIndex = index;
        break;
      }

      byteOffset = nextByteOffset;
      index += char.length;
    }

    const chunk = value.slice(startIndex, endIndex);
    const chunkByteLength = Buffer.byteLength(chunk, 'utf8');

    return {
      chunk,
      chunkByteLength,
      endOffset: offset + chunkByteLength,
      totalByteLength,
    };
  }

  private findUtf8IndexForOffset(value: string, offset: number): number {
    if (offset === 0) {
      return 0;
    }

    let byteOffset = 0;
    for (let index = 0; index < value.length; ) {
      const char = this.readCodePoint(value, index);
      const nextByteOffset = byteOffset + Buffer.byteLength(char, 'utf8');

      if (offset === nextByteOffset) {
        return index + char.length;
      }

      if (offset < nextByteOffset) {
        throw new BadRequestException(
          `Offset ${offset} is not aligned to a UTF-8 character boundary`,
        );
      }

      byteOffset = nextByteOffset;
      index += char.length;
    }

    if (offset === byteOffset) {
      return value.length;
    }

    throw new BadRequestException(
      `Offset ${offset} exceeds workflow YAML byte length ${byteOffset}`,
    );
  }

  private readCodePoint(value: string, index: number): string {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      return '';
    }

    return String.fromCodePoint(codePoint);
  }
}

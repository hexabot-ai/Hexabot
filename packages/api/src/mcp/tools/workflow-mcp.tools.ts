/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, type WorkflowFull } from '@hexabot-ai/types';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';

import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { WorkflowService } from '@/workflow/services/workflow.service';
import {
  DEFAULT_WORKFLOW_TYPE,
  DirectionType,
  WorkflowType,
  WorkflowVersionAction,
} from '@/workflow/types';

import { McpPermission } from '../decorators/mcp-permission.decorator';
import { HexabotMcpRequest } from '../types';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import {
  PaginationArgs,
  paginationSchema,
  uuidSchema,
  workflowPayloadSchema,
} from './hexabot-mcp.schemas';
import { HexabotWorkflowMcpHelper } from './workflow-mcp.helper';

@Injectable()
export class HexabotWorkflowMcpTools extends HexabotMcpToolBase {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowHelper: HexabotWorkflowMcpHelper,
  ) {
    super();
  }

  @McpPermission('workflow', Action.READ)
  @Tool({
    name: 'hexabot_workflow_search',
    description: 'Search Hexabot workflows by metadata.',
    parameters: z.object({
      query: z.string().optional(),
      type: z.enum(WorkflowType).optional(),
      createdById: uuidSchema.optional(),
      ...paginationSchema,
    }),
  })
  async searchWorkflows(
    args: {
      query?: string;
      type?: WorkflowType;
      createdById?: string;
    } & PaginationArgs,
  ) {
    const where = this.buildWorkflowWhere(args);
    const options = this.findOptions<WorkflowOrmEntity>(args, where);
    const result = await this.listWithCount(this.workflowService, options);

    return {
      ...result,
      items: result.items.map((workflow) =>
        this.workflowHelper.summarizeWorkflow(workflow as WorkflowFull),
      ),
    };
  }

  @McpPermission('workflow', Action.READ)
  @Tool({
    name: 'hexabot_workflow_get',
    description:
      'Read a Hexabot workflow with compact version metadata, excluding YAML definition bodies. inputSchema is the JSON Schema of the input a run takes: it follows from the workflow type and, for a manual workflow, from inputs.schema in the current definition.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getWorkflow(args: { id: string }) {
    const workflow = await this.workflowHelper.requireWorkflow(args.id);

    return this.workflowHelper.summarizeWorkflow(workflow);
  }

  @McpPermission('workflow', Action.READ)
  @Tool({
    name: 'hexabot_workflow_version_status',
    description:
      'Check the current and published version pointers for one workflow.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getWorkflowVersionStatus(args: { id: string }) {
    const workflow = await this.workflowHelper.requireWorkflow(args.id);

    return this.workflowHelper.buildWorkflowVersionStatus(workflow);
  }

  @McpPermission('workflow', Action.CREATE)
  @Tool({
    name: 'hexabot_workflow_create',
    description:
      'Create a Hexabot workflow. Optionally commit an initial workflow definition YAML; if it is refused, no workflow is created, so the call can be retried with a fixed definition. A manual workflow declares the input of its runs in the definition, under inputs.schema, as a JSON Schema of type object (properties, required, default, ...); without it, a run takes any object. Conversational and scheduled workflows take the input of their trigger and cannot declare inputs.',
    parameters: z.object({
      ...workflowPayloadSchema,
      name: z.string().min(1),
      definitionYml: z.string().optional(),
      versionMessage: z.string().optional(),
    }),
  })
  async createWorkflow(
    args: {
      name: string;
      description?: string;
      type?: WorkflowType;
      schedule?: string | null;
      inputSchema?: Record<string, unknown>;
      builtin?: boolean;
      x?: number;
      y?: number;
      zoom?: number;
      direction?: DirectionType;
      definitionYml?: string;
      versionMessage?: string;
    },
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const actorId = this.getActorId(request);
    this.workflowHelper.assertNoInputSchemaParameter(args);
    const {
      definitionYml,
      versionMessage,
      inputSchema: _inputSchema,
      ...workflowPayload
    } = args;
    if (definitionYml) {
      this.workflowHelper.assertDefinitionCommittable(
        definitionYml,
        workflowPayload.type ?? DEFAULT_WORKFLOW_TYPE,
      );
    }
    const workflow = await this.workflowService.create({
      ...workflowPayload,
      createdBy: actorId,
    });

    if (definitionYml) {
      await this.workflowHelper.commitWorkflowDefinition({
        workflowId: workflow.id,
        definitionYml,
        message: versionMessage,
        action: WorkflowVersionAction.update,
        createdBy: actorId,
      });
    }

    return this.workflowHelper.summarizeWorkflow(
      await this.workflowHelper.requireWorkflow(workflow.id),
    );
  }

  @McpPermission('workflow', Action.UPDATE)
  @Tool({
    name: 'hexabot_workflow_update',
    description:
      'Update workflow metadata. Optionally commit a new workflow definition YAML version; if it is refused, nothing is changed. To change the input of a manual workflow, commit a definition with another inputs.schema (a JSON Schema of type object).',
    parameters: z.object({
      id: uuidSchema,
      ...workflowPayloadSchema,
      definitionYml: z.string().optional(),
      versionMessage: z.string().optional(),
    }),
  })
  async updateWorkflow(
    args: {
      id: string;
      definitionYml?: string;
      versionMessage?: string;
      inputSchema?: unknown;
    } & Record<string, unknown>,
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const actorId = this.getActorId(request);
    this.workflowHelper.assertNoInputSchemaParameter(args);
    const {
      id,
      definitionYml,
      versionMessage,
      inputSchema: _inputSchema,
      ...updates
    } = args;
    const workflow = await this.workflowHelper.requireWorkflow(id);
    if (definitionYml) {
      this.workflowHelper.assertDefinitionCommittable(
        definitionYml,
        workflow.type,
      );
    }

    if (Object.keys(updates).length > 0) {
      await this.workflowService.updateOne(id, updates as any);
    }

    if (definitionYml) {
      await this.workflowHelper.commitWorkflowDefinition({
        workflowId: id,
        definitionYml,
        message: versionMessage,
        action: WorkflowVersionAction.update,
        createdBy: actorId,
      });
    }

    return this.workflowHelper.summarizeWorkflow(
      await this.workflowHelper.requireWorkflow(id),
    );
  }

  @McpPermission('workflow', Action.UPDATE)
  @Tool({
    name: 'hexabot_workflow_publish',
    description: 'Publish the current workflow version.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async publishWorkflow(args: { id: string }) {
    const workflow = await this.workflowService.findOne(args.id);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${args.id} not found`);
    }
    if (!workflow.currentVersion) {
      throw new BadRequestException(
        'Workflow must have a current version to be published',
      );
    }

    await this.workflowService.updateOne(args.id, {
      publishedVersion: workflow.currentVersion,
    });

    return this.workflowHelper.summarizeWorkflow(
      await this.workflowHelper.requireWorkflow(args.id),
    );
  }

  @McpPermission('workflow', Action.UPDATE)
  @Tool({
    name: 'hexabot_workflow_unpublish',
    description: 'Clear the published workflow version.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async unpublishWorkflow(args: { id: string }) {
    await this.workflowHelper.requireWorkflow(args.id);
    await this.workflowService.updateOne(args.id, { publishedVersion: null });

    return this.workflowHelper.summarizeWorkflow(
      await this.workflowHelper.requireWorkflow(args.id),
    );
  }

  private buildWorkflowWhere(args: {
    query?: string;
    type?: WorkflowType;
    createdById?: string;
  }) {
    const base = {
      ...(args.type ? { type: args.type } : {}),
      ...(args.createdById ? { createdBy: { id: args.createdById } } : {}),
    };

    return args.query
      ? [
          { ...base, name: this.contains(args.query) },
          { ...base, description: this.contains(args.query) },
        ]
      : base;
  }
}

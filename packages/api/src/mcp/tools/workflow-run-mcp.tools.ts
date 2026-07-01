/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  type StepExecutionRecord,
  type WorkflowRunStatus,
} from '@hexabot-ai/agentic';
import { Action, type WorkflowRunFull } from '@hexabot-ai/types';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tool, ToolGuards } from '@rekog/mcp-nest';
import { z } from 'zod';

import { WorkflowRunOrmEntity } from '@/workflow/entities/workflow-run.entity';
import {
  ManualEventWrapper,
  ScheduledEventWrapper,
} from '@/workflow/lib/trigger-event-wrapper';
import { AgenticService } from '@/workflow/services/agentic.service';
import { WorkflowRunService } from '@/workflow/services/workflow-run.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { WorkflowType } from '@/workflow/types';

import { McpPermission } from '../decorators/mcp-permission.decorator';
import { McpPermissionGuard } from '../guards/mcp-permission.guard';
import { HexabotMcpRequest } from '../types';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import {
  jsonObjectSchema,
  PaginationArgs,
  paginationSchema,
  uuidSchema,
} from './hexabot-mcp.schemas';
import { omitKeysDeep, resolveRelationId } from './hexabot-mcp.utils';

const WORKFLOW_DEFINITION_RESPONSE_KEYS = ['definitionYml'] as const;

@Injectable()
export class HexabotWorkflowRunMcpTools extends HexabotMcpToolBase {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly agenticService: AgenticService,
  ) {
    super();
  }

  @McpPermission('workflowrun', Action.CREATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_run',
    description:
      'Run a manual or scheduled workflow and return the run summary.',
    parameters: z.object({
      workflowId: uuidSchema,
      input: jsonObjectSchema.default({}),
    }),
  })
  async runWorkflow(
    args: { workflowId: string; input: Record<string, unknown> },
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const actor = this.getActor(request);
    const workflow = await this.workflowService.findOne(args.workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${args.workflowId} not found`);
    }

    if (
      workflow.type !== WorkflowType.manual &&
      workflow.type !== WorkflowType.scheduled
    ) {
      throw new BadRequestException(
        'Workflow must be manual or scheduled to run manually',
      );
    }

    const event =
      workflow.type === WorkflowType.scheduled
        ? new ScheduledEventWrapper({
            schedule: workflow.schedule ?? null,
            triggeredAt: new Date(),
          })
        : new ManualEventWrapper(
            this.workflowService.validateManualInput(
              args.input ?? {},
              workflow.inputSchema,
            ),
            actor.id,
          );
    event.setInitiator(actor);
    event.setWorkflowId(workflow.id);

    const run = await this.agenticService.handleEvent(event);

    return { accepted: true, run };
  }

  @McpPermission('workflowrun', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_run_search',
    description: 'Search workflow runs by workflow and status.',
    parameters: z.object({
      workflowId: uuidSchema.optional(),
      status: z.string().optional(),
      ...paginationSchema,
    }),
  })
  async searchWorkflowRuns(
    args: { workflowId?: string; status?: string } & PaginationArgs,
  ) {
    const where = {
      ...(args.workflowId ? { workflow: { id: args.workflowId } } : {}),
      ...(args.status ? { status: args.status } : {}),
    } as any;
    const result = await this.listWithCount(
      this.workflowRunService,
      this.findOptions<WorkflowRunOrmEntity>(args, where),
    );

    return this.sanitizeWorkflowRunResponse(result);
  }

  @McpPermission('workflowrun', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_run_get',
    description: 'Read one workflow run with populated workflow metadata.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getWorkflowRun(args: { id: string }) {
    const run = await this.workflowRunService.findOneAndPopulate(args.id);
    if (!run) {
      throw new NotFoundException(`Workflow run ${args.id} not found`);
    }

    return this.withoutWorkflowDefinition(run);
  }

  @McpPermission('workflowrun', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_run_debug',
    description:
      'Inspect one workflow run for debugging with execution state, workflow YAML, and related parent/child runs.',
    parameters: z.object({
      id: uuidSchema,
      includeWorkflowDefinition: z.boolean().default(true),
      includeRelatedRuns: z.boolean().default(true),
      childRunsLimit: z.number().int().min(1).max(50).default(10),
    }),
  })
  async debugWorkflowRun(args: {
    id: string;
    includeWorkflowDefinition?: boolean;
    includeRelatedRuns?: boolean;
    childRunsLimit?: number;
  }) {
    const run = await this.workflowRunService.findOneAndPopulate(args.id);
    if (!run) {
      throw new NotFoundException(`Workflow run ${args.id} not found`);
    }

    const includeRelatedRuns = args.includeRelatedRuns ?? true;
    const childRunsLimit = args.childRunsLimit ?? 10;
    const parentRunId = resolveRelationId(run.parentRun);
    const childWhere = { parentRun: { id: run.id } } as any;
    const [parentRun, childRuns, childRunTotal] = includeRelatedRuns
      ? await Promise.all([
          parentRunId
            ? this.workflowRunService.findOneAndPopulate(parentRunId)
            : Promise.resolve(null),
          this.workflowRunService.findAndPopulate({
            where: childWhere,
            order: { createdAt: 'ASC' },
            take: childRunsLimit,
          }),
          this.workflowRunService.count({ where: childWhere }),
        ])
      : ([null, [], 0] as const);
    const includeWorkflowDefinition = args.includeWorkflowDefinition ?? true;
    const response: Record<string, unknown> = {
      run: this.withoutWorkflowDefinition(run),
      relatedRuns: {
        parent: this.withoutWorkflowDefinition(parentRun),
        children: this.withoutWorkflowDefinition(childRuns),
        childRunTotal,
        childRunsLimit: includeRelatedRuns ? childRunsLimit : 0,
      },
      summary: this.buildWorkflowRunDebugSummary(run, childRunTotal),
    };

    if (includeWorkflowDefinition) {
      response.workflowDefinitionYml =
        run.workflowVersion?.definitionYml ?? null;
    }

    return response;
  }

  private buildWorkflowRunDebugSummary(
    run: WorkflowRunFull,
    childRunTotal: number,
  ) {
    const stepEntries = Object.entries(run.stepLog ?? {}) as [
      string,
      StepExecutionRecord,
    ][];
    const stepStatusCounts = stepEntries.reduce<Record<string, number>>(
      (counts, [, step]) => ({
        ...counts,
        [step.status]: (counts[step.status] ?? 0) + 1,
      }),
      {},
    );
    const failedSteps = stepEntries
      .filter(
        ([, step]) =>
          step.status === EWorkflowRunStatus.FAILED || Boolean(step.error),
      )
      .map(([stepId, step]) => ({
        id: step.id ?? stepId,
        name: step.name ?? stepId,
        action: step.action ?? null,
        status: step.status,
        error: step.error ?? null,
        reason: step.reason ?? null,
      }));

    return {
      id: run.id,
      status: run.status as WorkflowRunStatus,
      workflow: {
        id: run.workflow.id,
        name: run.workflow.name,
        type: run.workflow.type,
      },
      workflowVersion: run.workflowVersion
        ? {
            id: run.workflowVersion.id,
            version: run.workflowVersion.version,
            checksum: run.workflowVersion.checksum,
          }
        : null,
      error: run.error ?? null,
      duration: run.duration ?? null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      suspendedAt: run.suspendedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      failedAt: run.failedAt ?? null,
      suspension:
        run.status === EWorkflowRunStatus.SUSPENDED
          ? {
              step: run.suspendedStep ?? null,
              reason: run.suspensionReason ?? null,
              stepExecId: run.suspensionStepExecId ?? null,
              index: run.suspensionIndex ?? null,
              key: run.suspensionKey ?? null,
            }
          : null,
      stepStatusCounts,
      failedSteps,
      childRunTotal,
    };
  }

  private sanitizeWorkflowRunResponse<T extends { items: unknown[] }>(
    response: T,
  ): T {
    return {
      ...response,
      items: this.withoutWorkflowDefinition(response.items),
    };
  }

  private withoutWorkflowDefinition<T>(value: T): T {
    return omitKeysDeep(value, WORKFLOW_DEFINITION_RESPONSE_KEYS);
  }
}

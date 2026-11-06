/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  type StepExecutionRecord,
  type WaitInfo,
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
import {
  getOpenWaits,
  isOperatorWait,
} from '@/workflow/lib/workflow-run-waits';
import { WebhookTriggerService } from '@/workflow/services/webhook-trigger.service';
import { WorkflowRunService } from '@/workflow/services/workflow-run.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { CLAIMED_WORKFLOW_RUN_STATUSES, WorkflowType } from '@/workflow/types';

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
import {
  omitKeysDeep,
  resolveRelationId,
  toUserRef,
} from './hexabot-mcp.utils';

const WORKFLOW_DEFINITION_RESPONSE_KEYS = ['definitionYml'] as const;
/**
 * How long `hexabot_workflow_run` waits for the run by default: under the
 * 60 s request timeout of MCP SDK clients, and of a proxy in front of the API.
 */
const DEFAULT_RUN_WAIT_TIMEOUT_SECONDS = 30;
const MAX_RUN_WAIT_TIMEOUT_SECONDS = 300;

@Injectable()
export class HexabotWorkflowRunMcpTools extends HexabotMcpToolBase {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly webhookTriggerService: WebhookTriggerService,
  ) {
    super();
  }

  @McpPermission('workflowrun', Action.CREATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_workflow_run',
    description: `Run a manual or scheduled workflow and return the run summary. Waits until the run finishes, fails or suspends, for at most waitTimeoutSeconds (default ${DEFAULT_RUN_WAIT_TIMEOUT_SECONDS}). A run still going then, or with wait=false, is returned at once with inProgress=true and keeps running server-side: poll hexabot_workflow_run_get with run.id until its status is no longer idle or running. Do not call this tool again to get the result: that starts another run.`,
    parameters: z.object({
      workflowId: uuidSchema,
      input: jsonObjectSchema.default({}),
      wait: z.boolean().default(true),
      waitTimeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_RUN_WAIT_TIMEOUT_SECONDS)
        .default(DEFAULT_RUN_WAIT_TIMEOUT_SECONDS),
    }),
  })
  async runWorkflow(
    args: {
      workflowId: string;
      input: Record<string, unknown>;
      wait?: boolean;
      waitTimeoutSeconds?: number;
    },
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const actor = this.getActor(request);
    const workflow = await this.workflowService.findOneAndPopulate(
      args.workflowId,
    );
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
    // Throws, and the tool reports the error, when a suspended run of the
    // workflow refuses the input or another request resumed it first.
    const run = await this.webhookTriggerService.dispatchTriggerEvent(
      workflow,
      event,
      actor.id,
      {
        wait: args.wait ?? true,
        waitTimeoutMs:
          (args.waitTimeoutSeconds ?? DEFAULT_RUN_WAIT_TIMEOUT_SECONDS) * 1000,
      },
    );

    return {
      accepted: true,
      inProgress: CLAIMED_WORKFLOW_RUN_STATUSES.includes(run.status),
      run: this.withoutWorkflowDefinition(this.withOpenWaits(run)),
    };
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
    name: 'hexabot_workflow_run_pending',
    description:
      'List suspended workflow runs waiting on an admin (await_approval or suspend_workflow), with their open admin waits.',
    parameters: z.object({
      workflowId: uuidSchema.optional(),
      ...paginationSchema,
    }),
  })
  async listPendingWorkflowRuns(
    args: { workflowId?: string } & PaginationArgs,
  ) {
    const where = args.workflowId ? { workflow: { id: args.workflowId } } : {};
    const result = await this.listWithCount(
      this.workflowRunService,
      this.workflowRunService.withAwaitingOperatorScope(
        this.findOptions<WorkflowRunOrmEntity>(args, where),
      ),
    );

    return {
      ...result,
      items: this.withoutWorkflowDefinition(
        (result.items as WorkflowRunFull[]).map((run) =>
          this.withOpenWaits(run, isOperatorWait),
        ),
      ),
    };
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

    return this.withoutWorkflowDefinition(
      this.withTriggeredByRef(this.withoutCheckpoint(run)),
    );
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
      run: this.withoutWorkflowDefinition(this.withTriggeredByRef(run)),
      relatedRuns: {
        parent: this.withoutWorkflowDefinition(
          this.withTriggeredByRef(this.withoutCheckpoint(parentRun)),
        ),
        children: this.withoutWorkflowDefinition(
          childRuns.map((childRun) =>
            this.withTriggeredByRef(this.withoutCheckpoint(childRun)),
          ),
        ),
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
              waits: getOpenWaits(run).map((wait) => ({
                waitId: wait.waitId,
                step: wait.step?.id ?? null,
                reason: wait.reason ?? null,
                suspendKey: wait.suspendKey,
              })),
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
      items: this.withoutWorkflowDefinition(
        response.items.map((item) =>
          this.withTriggeredByRef(this.withoutCheckpoint(item)),
        ),
      ),
    };
  }

  /**
   * Replace the resume checkpoint of a run with a summary of its open waits,
   * the only part of it that its output and step log do not already hold.
   *
   * @param filter - Keeps only the waits it accepts; all of them by default.
   */
  private withOpenWaits(
    run: WorkflowRunFull,
    filter: (wait: WaitInfo) => boolean = () => true,
  ) {
    return {
      ...this.withTriggeredByRef(this.withoutCheckpoint(run)),
      openWaits: getOpenWaits(run)
        .filter(filter)
        .map(({ waitId, reason, step, data }) => ({
          waitId,
          reason: reason ?? null,
          step,
          data: data ?? null,
        })),
    };
  }

  /**
   * Drop the resume checkpoint from a run: it is large, and only the run the
   * debug tool inspects needs it. Only the run's own key is removed, never
   * nested user data that happens to use the same name.
   */
  private withoutCheckpoint<T>(run: T): T {
    if (!run || typeof run !== 'object' || !('checkpoint' in run)) {
      return run;
    }

    const { checkpoint: _checkpoint, ...rest } = run as Record<string, unknown>;

    return rest as T;
  }

  /**
   * Reduce the user or subscriber that triggered a run to its id and name
   * (`toUserRef`): the populated relation is their whole record.
   */
  private withTriggeredByRef<T>(run: T): T {
    if (!run || typeof run !== 'object' || !('triggeredBy' in run)) {
      return run;
    }

    return {
      ...run,
      triggeredBy: toUserRef(run.triggeredBy as WorkflowRunFull['triggeredBy']),
    } as T;
  }

  private withoutWorkflowDefinition<T>(value: T): T {
    return omitKeysDeep(value, WORKFLOW_DEFINITION_RESPONSE_KEYS);
  }
}

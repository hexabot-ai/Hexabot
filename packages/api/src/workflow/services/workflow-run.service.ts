/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus, WorkflowSnapshot } from '@hexabot-ai/agentic';
import { WorkflowRun, WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import { WorkflowRunRepository } from '../repositories/workflow-run.repository';

type StateUpdate = {
  snapshot?: WorkflowSnapshot | null;
  context?: Record<string, unknown> | null;
};

const ACTIVE_WORKFLOW_RUN_STATUSES = [
  EWorkflowRunStatus.IDLE,
  EWorkflowRunStatus.RUNNING,
  EWorkflowRunStatus.SUSPENDED,
];

@Injectable()
export class WorkflowRunService extends BaseOrmService<WorkflowRunOrmEntity> {
  /**
   * Creates the service with the underlying repository injected.
   *
   * @param repository - ORM repository used to persist workflow run entities.
   */
  constructor(readonly repository: WorkflowRunRepository) {
    super(repository);
  }

  /**
   * Mark a run as running and persist optional execution state.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - State changes such as snapshot, context, or resume data.
   * @returns Updated workflow run marked as `running`.
   */
  async markRunning(
    runId: string,
    payload: StateUpdate & { lastResumeData?: unknown },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'running',
      ...payload,
    });
  }

  /**
   * Mark a run as suspended with the corresponding reason and state.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Suspension metadata (step, reason, data) plus optional state updates.
   * @returns Updated workflow run marked as `suspended`.
   */
  async markSuspended(
    runId: string,
    payload: {
      stepId?: string | null;
      reason?: string | null;
      data?: unknown;
      stepExecId?: string | null;
      suspendIndex?: number | null;
      suspendKey?: string | null;
      awaitResults?: Record<string, unknown> | null;
      lastResumeData?: unknown;
    } & StateUpdate,
  ): Promise<WorkflowRun> {
    const {
      stepId,
      reason,
      data,
      stepExecId,
      suspendIndex,
      suspendKey,
      awaitResults,
      lastResumeData,
      ...state
    } = payload;

    return await this.updateOne(runId, {
      status: 'suspended',
      suspendedStep: stepId ?? null,
      suspensionReason: reason ?? null,
      suspensionData: data,
      suspensionStepExecId: stepExecId ?? null,
      suspensionIndex: suspendIndex ?? null,
      suspensionKey: suspendKey ?? null,
      suspensionAwaitResults: awaitResults ?? null,
      lastResumeData,
      suspendedAt: new Date(),
      ...state,
    });
  }

  /**
   * Mark a run as finished and store final state/output.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Final state changes and optional output payload.
   * @returns Updated workflow run marked as `finished`.
   */
  async markFinished(
    runId: string,
    payload: StateUpdate & { output?: Record<string, unknown> | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'finished',
      finishedAt: new Date(),
      ...payload,
    });
  }

  /**
   * Mark a run as failed and persist the failure reason and state.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Optional error message and state changes.
   * @returns Updated workflow run marked as `failed`.
   */
  async markFailed(
    runId: string,
    payload: StateUpdate & { error?: string | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'failed',
      failedAt: new Date(),
      ...payload,
    });
  }

  /**
   * Find the suspended run that should receive the next event.
   *
   * For call-and-return stacks, the parent can be suspended while the child is
   * either running or suspended for the same initiator/thread. The next external
   * event must resume the deepest suspended leaf first; once that child
   * completes, AgenticService resumes its parent internally with the child
   * result.
   *
   * @param triggeredById - Identifier of the subscriber whose suspended run should be fetched.
   * @param threadId - Optional thread id for conversational continuity.
   * @param workflowId - Optional workflow id; a parent match still resolves to its child leaf.
   * @returns The suspended leaf run populated with relations, or `null` when none exists.
   */
  async findSuspendedRunByInitiator(
    triggeredById: string,
    threadId?: string,
    workflowId?: string,
  ): Promise<WorkflowRunFull | null> {
    const runs = await this.findAndPopulate({
      where: {
        triggeredBy: { id: triggeredById },
        ...(threadId ? { thread: { id: threadId } } : {}),
        status: In(ACTIVE_WORKFLOW_RUN_STATUSES),
      },
      order: { suspendedAt: 'DESC', createdAt: 'DESC' },
    });

    if (runs.length === 0) {
      return null;
    }

    const runsById = new Map(runs.map((run) => [run.id, run]));
    const parentRunIds = new Set(
      runs
        .map((run) => this.resolveRunId(run.parentRun))
        .filter((value): value is string => typeof value === 'string'),
    );
    // Leaves are active runs that are not the parent of another unfinished
    // candidate. Only suspended leaves can consume external events; running or
    // idle leaves are still in flight and block their suspended ancestors.
    const leaves = runs.filter((run) => !parentRunIds.has(run.id));
    const candidates = (leaves.length > 0 ? leaves : runs)
      .filter((run) => run.status === EWorkflowRunStatus.SUSPENDED)
      .filter((run) =>
        workflowId
          ? this.isRunInWorkflowStack(run, workflowId, runsById)
          : true,
      );

    return this.pickDeepestSuspendedRun(candidates, runsById);
  }

  private resolveRunId(
    run: string | { id?: string | null } | null | undefined,
  ): string | null {
    if (typeof run === 'string') {
      return run;
    }

    return run?.id ?? null;
  }

  private isRunInWorkflowStack(
    run: WorkflowRunFull,
    workflowId: string,
    runsById: Map<string, WorkflowRunFull>,
  ): boolean {
    let current: WorkflowRunFull | undefined = run;
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.workflow.id === workflowId) {
        return true;
      }
      const parentRunId = this.resolveRunId(current.parentRun);
      current = parentRunId ? runsById.get(parentRunId) : undefined;
    }

    return false;
  }

  private pickDeepestSuspendedRun(
    runs: WorkflowRunFull[],
    runsById: Map<string, WorkflowRunFull>,
  ): WorkflowRunFull | null {
    if (runs.length === 0) {
      return null;
    }

    const getDepth = (run: WorkflowRunFull): number => {
      let depth = 0;
      let current: WorkflowRunFull | undefined = run;
      const visited = new Set<string>();

      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        depth += 1;
        const parentRunId = this.resolveRunId(current.parentRun);
        current = parentRunId ? runsById.get(parentRunId) : undefined;
      }

      return depth;
    };
    const getTime = (value?: Date | string | null): number => {
      if (!value) {
        return 0;
      }

      const date = value instanceof Date ? value : new Date(value);
      const timestamp = date.getTime();

      return Number.isNaN(timestamp) ? 0 : timestamp;
    };

    return [...runs].sort((a, b) => {
      const depthDiff = getDepth(b) - getDepth(a);
      if (depthDiff !== 0) {
        return depthDiff;
      }

      return (
        getTime(b.suspendedAt) - getTime(a.suspendedAt) ||
        getTime(b.createdAt) - getTime(a.createdAt)
      );
    })[0];
  }

  /**
   * Mark all active runs linked to a thread as failed.
   * Called when a thread is closed to abort any in-flight workflow execution.
   *
   * @param threadId - The ID of the closed thread.
   */
  async abortActiveRunsForThread(threadId: string): Promise<void> {
    const activeRuns = await this.find({
      where: {
        thread: { id: threadId },
        status: In(ACTIVE_WORKFLOW_RUN_STATUSES),
      },
    });

    await Promise.all(
      activeRuns.map((run) =>
        this.markFailed(run.id, { error: 'Thread was closed' }),
      ),
    );
  }
}

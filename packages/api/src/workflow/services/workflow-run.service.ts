/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  type StepExecutionRecord,
  type WorkflowCheckpoint,
  type WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import { WorkflowRun, WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import { WorkflowRunRepository } from '../repositories/workflow-run.repository';

/** Run state persisted when a runner pass ends. */
type RunStateUpdate = {
  snapshot?: WorkflowSnapshot | null;
  context?: Record<string, unknown> | null;
  stepLog?: Record<string, StepExecutionRecord> | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
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
   * Mark a run as running and persist the context it runs with.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Hydrated context state of the run.
   * @returns Updated workflow run marked as `running`.
   */
  async markRunning(
    runId: string,
    payload: { context?: Record<string, unknown> | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'running',
      ...payload,
    });
  }

  /**
   * Claim a suspended run before resuming it. Only one caller wins a given
   * suspension; see {@link WorkflowRunRepository.claimSuspended}.
   *
   * @param runId - Identifier of the run to claim.
   * @param suspendedAt - Suspension timestamp of the run as it was loaded.
   * @returns `true` when the run was claimed and is now `running`.
   */
  async claimSuspended(
    runId: string,
    suspendedAt: Date | null,
  ): Promise<boolean> {
    return await this.repository.claimSuspended(runId, suspendedAt);
  }

  /**
   * Put a claimed run back to `suspended` after its resume payload was
   * refused. The checkpoint and `suspendedAt` are left unchanged, so the run
   * stays on the same suspension.
   *
   * @param runId - Identifier of the run to release.
   * @param payload - Context state the run had before it was claimed.
   * @returns Updated workflow run marked as `suspended`.
   */
  async releaseClaim(
    runId: string,
    payload: { context?: Record<string, unknown> | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'suspended',
      ...payload,
    });
  }

  /**
   * Mark a run as suspended and persist its checkpoint.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Checkpoint to resume from, and the run state.
   * @returns Updated workflow run marked as `suspended`.
   */
  async markSuspended(
    runId: string,
    payload: { checkpoint: WorkflowCheckpoint } & RunStateUpdate,
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'suspended',
      suspendedAt: new Date(),
      ...payload,
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
    payload: RunStateUpdate,
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'finished',
      checkpoint: null,
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
    payload: RunStateUpdate & { error?: string | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'failed',
      checkpoint: null,
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

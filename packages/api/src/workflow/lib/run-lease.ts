/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  type WorkflowCheckpoint,
} from '@hexabot-ai/agentic';

import type { WorkflowRunRepository } from '../repositories/workflow-run.repository';
import type { RunSettlement, RunStateUpdate } from '../types';

import { hasOperatorWait } from './workflow-run-waits';

/**
 * The claim this process holds on a run, from the moment it claimed the run
 * until it gives the claim back. `WorkflowRunService` hands leases out and
 * `WorkflowRunRecoveryService` renews them, so a held run is not recovered,
 * however long the work on it waits. Writes through a lease apply only while
 * the run is still held under it.
 *
 * A lease ends once it settles the run, or once its holder ends it without
 * writing: the claim then lapses after `WORKFLOW_RUN_CLAIM_TTL` and recovery
 * takes the run over. Whoever claims a run ends its lease, however the work
 * on it ends; a lease that never ends is renewed until the process stops.
 */
export class RunLease {
  /**
   * @param runId - Identifier of the claimed run.
   * @param claimId - Token of the claim, stored on the run while it is held.
   * @param repository - Writes of claimed runs.
   * @param onEnd - Stops renewing the claim.
   */
  constructor(
    readonly runId: string,
    readonly claimId: string,
    private readonly repository: Pick<
      WorkflowRunRepository,
      'updateClaimed' | 'settle'
    >,
    private readonly onEnd: (lease: RunLease) => void,
  ) {}

  /**
   * Write the run and keep holding it.
   *
   * @returns `false` when the run is not held under this lease anymore.
   */
  async update(values: RunSettlement): Promise<boolean> {
    return await this.repository.updateClaimed(
      this.runId,
      this.claimId,
      values,
    );
  }

  /**
   * Write how the work on the run ended and give the claim back. The lease
   * ends, whether the write applies or not.
   *
   * @returns `false` when the run is not held under this lease anymore: it
   * was taken over (its thread was closed) or recovered meanwhile, and
   * nothing was written.
   */
  async settle(values: RunSettlement): Promise<boolean> {
    try {
      return await this.repository.settle(this.runId, values, this.claimId);
    } finally {
      this.end();
    }
  }

  /**
   * Stop renewing the claim without writing the run. Ending a lease again
   * does nothing.
   */
  end(): void {
    this.onEnd(this);
  }
}

/**
 * Values a claimed run starts running with.
 */
export const runningValues = (payload: {
  context?: Record<string, unknown> | null;
}): RunSettlement => ({
  status: EWorkflowRunStatus.RUNNING,
  ...payload,
});

/**
 * Values a run suspends with. `suspendedAt` versions the suspension, and
 * `awaitingOperator` is set iff the checkpoint holds an open operator wait.
 */
export const suspendedValues = (
  payload: { checkpoint: WorkflowCheckpoint } & RunStateUpdate,
): RunSettlement => ({
  status: EWorkflowRunStatus.SUSPENDED,
  suspendedAt: new Date(),
  awaitingOperator: hasOperatorWait(payload.checkpoint.waits),
  ...payload,
});

/**
 * Values a run finishes with; its checkpoint is cleared.
 */
export const finishedValues = (payload: RunStateUpdate): RunSettlement => ({
  status: EWorkflowRunStatus.FINISHED,
  checkpoint: null,
  awaitingOperator: false,
  finishedAt: new Date(),
  ...payload,
});

/**
 * Values a run fails with; its checkpoint is cleared.
 */
export const failedValues = (
  payload: RunStateUpdate & { error?: string | null },
): RunSettlement => ({
  status: EWorkflowRunStatus.FAILED,
  checkpoint: null,
  awaitingOperator: false,
  failedAt: new Date(),
  ...payload,
});

/**
 * Values that put a claimed run back on the suspension it was claimed from,
 * e.g. after its resume payload was refused. A claim writes only the status,
 * so the checkpoint, context and `suspendedAt` are as they were.
 */
export const putBackValues = (): RunSettlement => ({
  status: EWorkflowRunStatus.SUSPENDED,
});

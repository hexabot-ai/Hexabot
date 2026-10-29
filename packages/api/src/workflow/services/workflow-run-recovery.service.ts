/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus, WaitInfo } from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppInstance } from '@/app.instance';
import { config } from '@/config';
import { LoggerService } from '@/logger/logger.service';
import { stringifyError } from '@/utils/helpers/misc';

import { getChildRunId, resolveRunId } from '../lib/workflow-call-stack';
import { getOpenWaits } from '../lib/workflow-run-waits';
import { ACTIVE_WORKFLOW_RUN_STATUSES, ExpiredClaim } from '../types';

import { AgenticService } from './agentic.service';
import { WorkflowCallStackService } from './workflow-call-stack.service';
import { WorkflowRunService } from './workflow-run.service';

/**
 * Interruptions in a row after which a run is failed instead of being put
 * back on its wait, so that a pass which kills its process does not take
 * every node down in turn.
 */
const MAX_INTERRUPTIONS = 3;
const INTERRUPTED_ERROR =
  'Workflow run was interrupted: the process running it stopped';

/**
 * Keeps the claims on the runs this process is running alive, and recovers
 * the runs whose claim lapsed because the process running them stopped
 * (deploy, crash, out of memory) or could not renew it for a whole TTL.
 *
 * A run whose resume died is put back on the wait it was claimed from: an
 * approval is pending again, and the reply or decision has to be sent
 * again. A run that died before it ever suspended is failed. Every node
 * recovers runs; the claim token makes each recovery happen once, and makes
 * a pass whose run was recovered drop its outcome.
 */
@Injectable()
export class WorkflowRunRecoveryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private renewTimer?: NodeJS.Timeout;

  private sweepTimer?: NodeJS.Timeout;

  private renewing = false;

  private sweeping = false;

  /**
   * Since when the queries of this node have all succeeded, or `null` after
   * one failed. Runs are only recovered after a whole TTL of them: after a
   * database outage, the other nodes first get the time to renew the claims
   * of the runs they are still running.
   */
  private healthySince: number | null = null;

  constructor(
    private readonly workflowRunService: WorkflowRunService,
    private readonly agenticService: AgenticService,
    private readonly callStack: WorkflowCallStackService,
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Start renewing and sweeping, in the API only (not in tests or CLI
   * commands).
   */
  onApplicationBootstrap(): void {
    if (!AppInstance.isReady()) {
      return;
    }

    const ttl = config.workflow.runClaimTtl;
    this.renewTimer = setInterval(
      () => void this.renewClaims(),
      Math.floor(ttl / 4),
    );
    this.sweepTimer = setInterval(() => void this.sweep(), Math.floor(ttl / 2));
    this.renewTimer.unref();
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.renewTimer);
    clearInterval(this.sweepTimer);
  }

  /**
   * Renew the claims held by the passes running in this process.
   */
  async renewClaims(): Promise<void> {
    if (this.renewing) {
      return;
    }

    this.renewing = true;
    try {
      await this.workflowRunService.renewHeldClaims();
      this.markHealthy();
    } catch (error) {
      this.markUnhealthy(
        'Unable to renew the claims on running workflow runs',
        error,
      );
    } finally {
      this.renewing = false;
    }
  }

  /**
   * Recover the runs whose claim lapsed, once the queries of this node have
   * succeeded for a whole TTL.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) {
      return;
    }

    this.sweeping = true;
    try {
      const now = new Date();
      let expired: ExpiredClaim[];
      try {
        expired = await this.workflowRunService.findExpiredClaims(now);
        this.markHealthy();
      } catch (error) {
        this.markUnhealthy(
          'Unable to look for workflow runs to recover',
          error,
        );

        return;
      }

      if (
        this.healthySince === null ||
        now.getTime() - this.healthySince < config.workflow.runClaimTtl
      ) {
        return;
      }

      await this.recover(expired, now);
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Recover the runs whose claim lapsed before `now`, right away: unlike
   * {@link sweep}, it does not wait for this node to be healthy.
   *
   * @param now - Claims lapsed before this time are recovered.
   * @returns The number of runs recovered.
   */
  async recoverExpiredRuns(now: Date = new Date()): Promise<number> {
    return await this.recover(
      await this.workflowRunService.findExpiredClaims(now),
      now,
    );
  }

  private async recover(expired: ExpiredClaim[], now: Date): Promise<number> {
    let recovered = 0;
    for (const claim of expired) {
      // A pass of this process holds it: it only could not renew it yet.
      if (this.workflowRunService.holdsClaim(claim.claimId)) {
        continue;
      }

      try {
        if (await this.recoverRun(claim, now)) {
          recovered += 1;
        }
      } catch (error) {
        this.logger.error('Unable to recover a workflow run', error, {
          runId: claim.id,
        });
      }
    }

    return recovered;
  }

  /**
   * Recover one run whose claim lapsed.
   *
   * @returns `false` when another node recovered it first, or its claim was
   * renewed meanwhile.
   */
  private async recoverRun(claim: ExpiredClaim, now: Date): Promise<boolean> {
    if (!claim.hasCheckpoint) {
      return await this.failInterruptedRun(claim, now);
    }

    if (!(await this.workflowRunService.putBackExpired(claim, now))) {
      return false;
    }

    const run = await this.workflowRunService.findOneAndPopulate(claim.id);
    if (!run) {
      return true;
    }

    const interruptions = claim.recoveryCount + 1;
    const waits = getOpenWaits(run);
    this.logger.warn(
      'Put a workflow run back on its wait: the process resuming it stopped',
      {
        runId: run.id,
        waitIds: waits.map((wait) => wait.waitId),
        interruptions,
      },
    );
    this.eventEmitter.emit('hook:workflow:suspended', {
      runId: run.id,
      waits,
    });

    if (interruptions >= MAX_INTERRUPTIONS) {
      await this.cancel(
        run,
        `Workflow run was interrupted ${interruptions} times in a row: the process resuming it stopped`,
      );

      return true;
    }

    if (await this.hasEndedParent(run)) {
      await this.cancel(
        run,
        'Workflow run was interrupted and its caller has ended',
      );

      return true;
    }

    await this.cancelOrphanChildren(run, waits);
    await this.callStack.reconcile([run.id]);

    return true;
  }

  /**
   * Fail a run whose process stopped before it ever suspended, and send a
   * waiting parent the failed result of its call.
   */
  private async failInterruptedRun(
    claim: ExpiredClaim,
    now: Date,
  ): Promise<boolean> {
    if (
      !(await this.workflowRunService.failExpired(
        claim,
        now,
        INTERRUPTED_ERROR,
      ))
    ) {
      return false;
    }

    const run = await this.workflowRunService.findOneAndPopulate(claim.id);
    if (!run) {
      return true;
    }

    this.logger.warn(
      'Failed a workflow run: the process running it stopped before it suspended',
      { runId: run.id },
    );
    // A run that never started has no context to broadcast the event with.
    const { initiatorId, workflowId } = run.context ?? {};
    if (typeof initiatorId === 'string' && typeof workflowId === 'string') {
      this.eventEmitter.emit('hook:workflow:failure', {
        runId: run.id,
        error: new Error(INTERRUPTED_ERROR),
      });
    }

    await this.workflowRunService.cancelSuspendedDescendants(
      run.id,
      `Parent workflow run ${run.id} was interrupted`,
    );

    await this.callStack.reconcile([resolveRunId(run.parentRun)]);

    return true;
  }

  /**
   * Cancel a run put back on its wait, as an admin would: its waiting steps
   * are cancelled, along with its suspended descendants, and a waiting
   * parent receives the failed result.
   */
  private async cancel(run: WorkflowRunFull, message: string): Promise<void> {
    const outcome = await this.agenticService.cancelRun({ run, message });
    this.logger.warn('Cancelled an interrupted workflow run', {
      runId: run.id,
      reason: message,
      status: outcome.status,
    });
  }

  /**
   * Tell whether a run was called by a run that has ended meanwhile, and so
   * can never take its result.
   */
  private async hasEndedParent(run: WorkflowRunFull): Promise<boolean> {
    const parentRunId = resolveRunId(run.parentRun);
    if (!parentRunId) {
      return false;
    }

    const parentRun = await this.workflowRunService.findOne(parentRunId);

    return (
      !parentRun || !ACTIVE_WORKFLOW_RUN_STATUSES.includes(parentRun.status)
    );
  }

  /**
   * Cancel the suspended runs a run called that none of its open waits
   * refers to: the pass that died called them after the checkpoint the run
   * is back on, so their result can never be delivered, and they would
   * otherwise receive the next events of the conversation.
   *
   * @param run - Run put back on its wait.
   * @param waits - Open waits of the run.
   */
  private async cancelOrphanChildren(
    run: WorkflowRunFull,
    waits: WaitInfo[],
  ): Promise<void> {
    const waitedOn = new Set(
      waits
        .map((wait) => getChildRunId(wait))
        .filter((id): id is string => !!id),
    );
    const children = await this.workflowRunService.findAndPopulate({
      where: {
        parentRun: { id: run.id },
        status: EWorkflowRunStatus.SUSPENDED,
      },
    });
    const message = `Calling workflow run ${run.id} was interrupted`;

    for (const child of children) {
      if (waitedOn.has(child.id)) {
        continue;
      }

      if (await this.workflowRunService.cancelSuspended(child, message)) {
        await this.workflowRunService.cancelSuspendedDescendants(
          child.id,
          message,
        );
      }
    }
  }

  private markHealthy(): void {
    this.healthySince ??= Date.now();
  }

  private markUnhealthy(message: string, error: unknown): void {
    this.healthySince = null;
    this.logger.warn(message, { error: stringifyError(error) });
  }
}

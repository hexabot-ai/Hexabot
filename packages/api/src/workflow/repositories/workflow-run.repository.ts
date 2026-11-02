/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from '@hexabot-ai/agentic';
import { WorkflowRun } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryDeepPartialEntity, Repository, UpdateResult } from 'typeorm';

import { BaseOrmRepository, EHook } from '@/utils/generics/base-orm.repository';
import { InferCreateDto, InferUpdateDto } from '@/utils/types/dto.types';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import {
  CLAIMED_WORKFLOW_RUN_STATUSES,
  ExpiredClaim,
  HeldClaim,
  RunClaim,
  RunSettlement,
  WORKFLOW_RUN_CLAIM_RENEW_BATCH_SIZE,
} from '../types';

@Injectable()
export class WorkflowRunRepository extends BaseOrmRepository<WorkflowRunOrmEntity> {
  /**
   * Creates the repository with the TypeORM backing repository.
   *
   * @param repository - TypeORM repository bound to the workflow run entity.
   */
  constructor(
    @InjectRepository(WorkflowRunOrmEntity)
    repository: Repository<WorkflowRunOrmEntity>,
  ) {
    super(repository, [
      'workflow',
      'workflowVersion',
      'triggeredBy',
      'thread',
      'parentRun',
    ]);
  }

  /**
   * Create an `idle` run already held under a claim, so that no run is ever
   * active without one, even if the process stops right after the insert.
   *
   * @param payload - Run to create.
   * @param claim - Claim the run is created under.
   * @returns The created run.
   */
  async createClaimed(
    payload: InferCreateDto<WorkflowRunOrmEntity>,
    claim: RunClaim,
  ): Promise<WorkflowRun> {
    // The claim columns are internal, so the DTO does not declare them; the
    // entity mapping passes them through.
    return await this.create({
      ...payload,
      status: EWorkflowRunStatus.IDLE,
      claimId: claim.claimId,
      claimExpiresAt: claim.expiresAt,
    } as InferCreateDto<WorkflowRunOrmEntity>);
  }

  /**
   * Atomically move a suspended run to `running` under a claim, so only one
   * resume of a given suspension proceeds.
   *
   * The claim targets the suspension that was loaded, not only the status:
   * `suspendedAt` changes on every suspension, so a handler holding a stale
   * checkpoint cannot claim a run that another handler resumed and suspended
   * again in the meantime. Nothing else is written, so a run put back on its
   * wait after its holder stopped is exactly as it was before the claim.
   *
   * @param runId - Identifier of the run to claim.
   * @param suspendedAt - Suspension timestamp of the loaded run.
   * @param claim - Claim the run is held under from now on.
   * @returns `true` when this call claimed the run.
   */
  async claimSuspended(
    runId: string,
    suspendedAt: Date | null,
    claim: RunClaim,
  ): Promise<boolean> {
    const values = {
      status: EWorkflowRunStatus.RUNNING,
      claimId: claim.claimId,
      claimExpiresAt: claim.expiresAt,
    };
    const query = this.updateQuery(values)
      .where('id = :runId', { runId })
      .andWhere('status = :status', { status: EWorkflowRunStatus.SUSPENDED });
    const result = await (
      suspendedAt
        ? query.andWhere('suspended_at = :suspendedAt', { suspendedAt })
        : query.andWhere('suspended_at IS NULL')
    ).execute();

    return await this.afterWrite(runId, values, result);
  }

  /**
   * Write a claimed run and keep it claimed, as long as it is still held
   * under that claim.
   *
   * @param runId - Identifier of the run.
   * @param claimId - Token of the claim the caller holds.
   * @param values - Values to write.
   * @returns `false` when the run is not held under that claim anymore.
   */
  async updateClaimed(
    runId: string,
    claimId: string,
    values: RunSettlement,
  ): Promise<boolean> {
    const result = await this.updateClaimedQuery(runId, values)
      .andWhere('claim_id = :claimId', { claimId })
      .execute();

    return await this.afterWrite(runId, values, result);
  }

  /**
   * Write the end of a pass and release its claim, as long as the run is
   * still held under that claim.
   *
   * The token fences off a pass whose run was settled meanwhile: taken over
   * because its thread was closed, or recovered because its claim lapsed.
   *
   * @param runId - Identifier of the run.
   * @param values - State the pass ends with.
   * @param claimId - Token of the claim the pass ran under, or `null` to
   * take an active run over whoever holds it (closing its thread does).
   * @returns `false` when the run is not active, or not held under that
   * claim anymore.
   */
  async settle(
    runId: string,
    values: RunSettlement,
    claimId: string | null,
  ): Promise<boolean> {
    const written = {
      ...values,
      claimId: null,
      claimExpiresAt: null,
      recoveryCount: 0,
    };
    const query = this.updateClaimedQuery(runId, written);
    const result = await (
      claimId === null
        ? query
        : query.andWhere('claim_id = :claimId', { claimId })
    ).execute();

    return await this.afterWrite(runId, written, result);
  }

  /**
   * Push back the lapse of the claims this process holds. A claim that
   * lapsed but was not recovered yet is renewed as well.
   *
   * @param claims - Claims held by this process.
   * @param expiresAt - When the claims lapse from now on.
   * @returns The number of claims renewed.
   */
  async renewClaims(claims: HeldClaim[], expiresAt: Date): Promise<number> {
    let renewed = 0;
    for (
      let start = 0;
      start < claims.length;
      start += WORKFLOW_RUN_CLAIM_RENEW_BATCH_SIZE
    ) {
      const batch = claims.slice(
        start,
        start + WORKFLOW_RUN_CLAIM_RENEW_BATCH_SIZE,
      );
      // Renewals are bookkeeping: they neither touch `updatedAt` nor reach
      // the entity subscribers (the audit log would record each one).
      const result = await this.repository
        .createQueryBuilder()
        .update(WorkflowRunOrmEntity)
        .set({ claimExpiresAt: expiresAt })
        .where('id IN (:...runIds)', {
          runIds: batch.map(({ runId }) => runId),
        })
        .andWhere('claim_id IN (:...claimIds)', {
          claimIds: batch.map(({ claimId }) => claimId),
        })
        .callListeners(false)
        .execute();
      renewed += result.affected ?? 0;
    }

    return renewed;
  }

  /**
   * Find the active runs whose claim lapsed before `now`, oldest first.
   * The claim columns are read raw: the run schemas strip them.
   *
   * @param now - Claims lapsed before this time are returned.
   * @param limit - Maximum number of runs returned.
   */
  async findExpiredClaims(now: Date, limit = 100): Promise<ExpiredClaim[]> {
    const rows = await this.repository
      .createQueryBuilder('run')
      .select('run.id', 'id')
      .addSelect('run.claimId', 'claimId')
      .addSelect(
        'CASE WHEN run.checkpoint IS NULL THEN 0 ELSE 1 END',
        'hasCheckpoint',
      )
      .addSelect('run.recoveryCount', 'recoveryCount')
      .where('run.status IN (:...statuses)', {
        statuses: CLAIMED_WORKFLOW_RUN_STATUSES,
      })
      .andWhere('run.claimExpiresAt < :now', { now })
      .orderBy('run.claimExpiresAt', 'ASC')
      .limit(limit)
      .getRawMany<{
        id: string;
        claimId: string | null;
        hasCheckpoint: number | string;
        recoveryCount: number | string | null;
      }>();

    return rows.flatMap(({ id, claimId, hasCheckpoint, recoveryCount }) =>
      claimId
        ? [
            {
              id,
              claimId,
              hasCheckpoint: Number(hasCheckpoint) === 1,
              recoveryCount: Number(recoveryCount ?? 0),
            },
          ]
        : [],
    );
  }

  /**
   * Settle a run whose claim lapsed and release the claim, as long as it is
   * still held under that claim and the claim is still lapsed: a renewal
   * that lands first keeps the run with its holder.
   *
   * @param runId - Identifier of the run.
   * @param claimId - Token of the lapsed claim.
   * @param now - Time the claim was found lapsed at.
   * @param values - State the run is recovered to.
   * @returns `false` when the run was settled or renewed meanwhile.
   */
  async recoverExpired(
    runId: string,
    claimId: string,
    now: Date,
    values: RunSettlement,
  ): Promise<boolean> {
    const written = { ...values, claimId: null, claimExpiresAt: null };
    const result = await this.updateClaimedQuery(runId, written, now)
      .andWhere('claim_id = :claimId', { claimId })
      .andWhere('claim_expires_at < :now', { now })
      .execute();

    return await this.afterWrite(runId, written, result);
  }

  /**
   * Start an update of runs. `updatedAt` is set explicitly: it is a plain
   * column, which the query builder leaves alone. `undefined` values are
   * left out, so they leave their column as it is.
   */
  private updateQuery(
    values: Partial<WorkflowRunOrmEntity>,
    now: Date = new Date(),
  ) {
    const defined = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined),
    );

    // The query builder types JSON values as nested partial entities, which
    // `unknown` values do not satisfy.
    return this.repository
      .createQueryBuilder()
      .update(WorkflowRunOrmEntity)
      .set({
        ...defined,
        updatedAt: now,
      } as QueryDeepPartialEntity<WorkflowRunOrmEntity>);
  }

  /**
   * Start an update of a run held under a claim (`idle` or `running`).
   * Callers narrow it to the claim they hold.
   */
  private updateClaimedQuery(
    runId: string,
    values: Partial<WorkflowRunOrmEntity>,
    now?: Date,
  ) {
    return this.updateQuery(values, now)
      .where('id = :runId', { runId })
      .andWhere('status IN (:...statuses)', {
        statuses: CLAIMED_WORKFLOW_RUN_STATUSES,
      });
  }

  /**
   * Tell whether an update wrote its run, and if so emit `postUpdate` for
   * it, as `updateOne` does: the run lists of the admin UI follow that event.
   */
  private async afterWrite(
    runId: string,
    values: Partial<WorkflowRunOrmEntity>,
    result: UpdateResult,
  ): Promise<boolean> {
    if (result.affected !== 1) {
      return false;
    }

    const entity = await this.repository.findOne({ where: { id: runId } });
    if (entity) {
      await this.emitEvent<EHook.postUpdate>({
        action: EHook.postUpdate,
        entity,
        databaseEntity: entity,
        payload: values as InferUpdateDto<WorkflowRunOrmEntity>,
      });
    }

    return true;
  }
}

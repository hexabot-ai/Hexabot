/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from '@hexabot-ai/agentic';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseOrmRepository } from '@/utils/generics/base-orm.repository';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';

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
   * Atomically move a suspended run to `running`, so only one resume of a
   * given suspension proceeds.
   *
   * The claim targets the suspension that was loaded, not only the status:
   * `suspendedAt` changes on every suspension, so a handler holding a stale
   * checkpoint cannot claim a run that another handler resumed and suspended
   * again in the meantime.
   *
   * @param runId - Identifier of the run to claim.
   * @param suspendedAt - Suspension timestamp of the loaded run.
   * @returns `true` when this call claimed the run.
   */
  async claimSuspended(
    runId: string,
    suspendedAt: Date | null,
  ): Promise<boolean> {
    const query = this.repository
      .createQueryBuilder()
      .update(WorkflowRunOrmEntity)
      .set({ status: EWorkflowRunStatus.RUNNING, updatedAt: new Date() })
      .where('id = :runId', { runId })
      .andWhere('status = :status', { status: EWorkflowRunStatus.SUSPENDED });
    const result = await (
      suspendedAt
        ? query.andWhere('suspended_at = :suspendedAt', { suspendedAt })
        : query.andWhere('suspended_at IS NULL')
    ).execute();

    return result.affected === 1;
  }
}

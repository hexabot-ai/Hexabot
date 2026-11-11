/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MemoryRecordFull, MemoryDefinition } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { FindOptionsWhere, IsNull, MoreThan } from 'typeorm';

import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { MemoryRecordOrmEntity } from '../entities/memory-record.entity';
import { MemoryRecordRepository } from '../repositories/memory-record.repository';
import { MemoryScope, MemoryStoreIdentifier, MemoryValue } from '../types';

@Injectable()
export class MemoryRecordService extends BaseOrmService<MemoryRecordOrmEntity> {
  constructor(readonly repository: MemoryRecordRepository) {
    super(repository);
  }

  /**
   * Load active memory records for the owner and optional workflow/run scope.
   *
   * Records are filtered to entries without expiration or with a future expiry,
   * and ordered by most recently updated then created.
   *
   * @param identifiers - Owner and optional workflow/run identifiers.
   * @returns Active memory records across global/workflow/run scopes.
   * @throws Error when ownerId is missing.
   */
  async findActiveByScope({
    ownerId,
    workflowId,
    threadId,
    runId,
  }: MemoryStoreIdentifier): Promise<MemoryRecordFull[]> {
    if (!ownerId) {
      throw new Error('An owner id is required to build memory store.');
    }

    const where: FindOptionsWhere<MemoryRecordOrmEntity>[] = [
      {
        owner: { id: ownerId },
        definition: { scope: MemoryScope.global },
      },
    ];

    if (workflowId) {
      where.push({
        owner: { id: ownerId },
        workflow: { id: workflowId },
        definition: { scope: MemoryScope.workflow },
      });
    }

    if (threadId) {
      where.push({
        owner: { id: ownerId },
        thread: { id: threadId },
        definition: { scope: MemoryScope.thread },
      });
    }

    if (runId) {
      where.push({
        owner: { id: ownerId },
        run: { id: runId },
        definition: { scope: MemoryScope.run },
      });
    }

    const now = new Date();
    const scopedWhere = where.flatMap((scope) => [
      { ...scope, expiresAt: IsNull() },
      { ...scope, expiresAt: MoreThan(now) },
    ]);

    return this.findAndPopulate({
      where: scopedWhere,
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Create or update a scoped memory record for the given definition and owner.
   *
   * Existing records are updated in place with refreshed TTL/expiry metadata;
   * otherwise a new record is created for the requested scope.
   *
   * @param params - Memory definition, identifiers, and value to persist.
   * @returns Resolves once the record is persisted.
   */
  async upsertScopedRecord({
    definition,
    ownerId,
    workflowId,
    threadId,
    runId,
    value,
  }: {
    definition: Pick<MemoryDefinition, 'id' | 'scope' | 'ttlSeconds'>;
    ownerId: string;
    workflowId?: string | null;
    threadId?: string | null;
    runId?: string | null;
    value: MemoryValue;
  }): Promise<void> {
    const ttlSeconds = definition.ttlSeconds ?? null;
    const expiresAt =
      ttlSeconds && ttlSeconds > 0
        ? new Date(Date.now() + ttlSeconds * 1000)
        : null;
    const where: FindOptionsWhere<MemoryRecordOrmEntity> = {
      definition: { id: definition.id },
      owner: { id: ownerId },
    };

    if (definition.scope === MemoryScope.workflow) {
      where.workflow = { id: workflowId! };
    }

    if (definition.scope === MemoryScope.thread) {
      where.thread = { id: threadId! };
    }

    if (definition.scope === MemoryScope.run) {
      where.run = { id: runId! };
    }

    const existing = await this.findOne({
      where,
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });

    if (existing) {
      await this.updateOne(existing.id, {
        value,
        ttlSeconds,
        expiresAt,
      });

      return;
    }

    // A run record also keeps the workflow and thread of its run.
    const isRun = definition.scope === MemoryScope.run;
    const storesWorkflow = isRun || definition.scope === MemoryScope.workflow;
    const storesThread = isRun || definition.scope === MemoryScope.thread;

    await this.create({
      definition: definition.id,
      owner: ownerId,
      workflow: storesWorkflow ? (workflowId ?? null) : null,
      thread: storesThread ? (threadId ?? null) : null,
      run: isRun ? (runId ?? null) : null,
      value,
      ttlSeconds,
      expiresAt,
    });
  }
}

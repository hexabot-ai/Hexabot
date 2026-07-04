/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseOrmRepository, EHook } from '@/utils/generics/base-orm.repository';
import { InferCreateDto } from '@/utils/types/dto.types';

import { WorkflowVersionOrmEntity } from '../entities/workflow-version.entity';

@Injectable()
export class WorkflowVersionRepository extends BaseOrmRepository<WorkflowVersionOrmEntity> {
  constructor(
    @InjectRepository(WorkflowVersionOrmEntity)
    repository: Repository<WorkflowVersionOrmEntity>,
  ) {
    super(repository, ['workflow', 'createdBy', 'parentVersion']);
  }

  /**
   * Broadcast the postCreate mutation event for a version persisted outside
   * create(), e.g. the blank version 0 inserted by the workflow entity
   * lifecycle hook. Raw EntityManager writes bypass repository-level events,
   * so callers owning such writes must emit them after commit.
   *
   * @param id - Identifier of the already-persisted version.
   */
  async emitPostCreateById(id: string): Promise<void> {
    const version = await this.repository.findOne({ where: { id } });

    if (!version) {
      return;
    }

    await this.emitEvent<EHook.postCreate>({
      action: EHook.postCreate,
      entity: version,
      payload:
        version.toPlainCls() as unknown as InferCreateDto<WorkflowVersionOrmEntity>,
    });
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ApiTokenType } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseOrmRepository } from '@/utils/generics/base-orm.repository';

import { ApiTokenOrmEntity } from '../entities/api-token.entity';

@Injectable()
export class ApiTokenRepository extends BaseOrmRepository<ApiTokenOrmEntity> {
  constructor(
    @InjectRepository(ApiTokenOrmEntity)
    repository: Repository<ApiTokenOrmEntity>,
  ) {
    super(repository, ['owner']);
  }

  async findOneByHash(
    tokenHash: string,
    tokenType: ApiTokenType,
  ): Promise<ApiTokenOrmEntity | null> {
    return await this.repository.findOne({
      where: { tokenHash, tokenType },
      relations: ['owner', 'owner.roles'],
    });
  }

  async touchLastUsedAt(id: string, lastUsedAt = new Date()): Promise<void> {
    await this.repository.update(id, { lastUsedAt });
  }
}

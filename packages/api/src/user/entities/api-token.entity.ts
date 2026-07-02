/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ApiTokenScope,
  ApiTokenType,
  apiTokenFullSchema,
  apiTokenSchema,
} from '@hexabot-ai/types';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  RelationId,
} from 'typeorm';

import { DatetimeColumn, EnumColumn, JsonColumn } from '@/database';
import { BaseOrmEntity } from '@/database/entities/base.entity';
import { AsRelation } from '@/utils/decorators/relation-ref.decorator';

import { ApiTokenDto } from '../dto/api-token.dto';

import { UserOrmEntity } from './user.entity';

@Entity({ name: 'personal_access_tokens' })
@Index(['tokenHash'], { unique: true })
@Index(['owner'])
@Index(['tokenType'])
export class ApiTokenOrmEntity extends BaseOrmEntity<ApiTokenDto> {
  plainCls = apiTokenSchema;

  fullCls = apiTokenFullSchema;

  @Column()
  name!: string;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'token_prefix', length: 32 })
  tokenPrefix!: string;

  @EnumColumn({
    name: 'token_type',
    enum: ApiTokenType,
    default: ApiTokenType.API,
  })
  tokenType!: ApiTokenType;

  @JsonColumn()
  scopes!: ApiTokenScope[];

  @ManyToOne(() => UserOrmEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'owner_id' })
  @AsRelation()
  owner!: UserOrmEntity;

  @RelationId((token: ApiTokenOrmEntity) => token.owner)
  private readonly ownerId!: string;

  @DatetimeColumn({ name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  @DatetimeColumn({ name: 'last_used_at', nullable: true })
  lastUsedAt!: Date | null;

  @DatetimeColumn({ name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;
}

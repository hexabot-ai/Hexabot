/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { threadSchema, threadFullSchema } from '@hexabot-ai/types';
import { Column, Entity, JoinColumn, ManyToOne, RelationId } from 'typeorm';

import { AuditLabel } from '@/audit/decorators/audit-label.decorator';
import { SourceOrmEntity } from '@/channel/entities/source.entity';
import { DatetimeColumn } from '@/database/decorators/datetime-column.decorator';
import { EnumColumn } from '@/database/decorators/enum-column.decorator';
import { BaseOrmEntity } from '@/database/entities/base.entity';
import { AsRelation } from '@/utils/decorators/relation-ref.decorator';

import type { ThreadDto } from '../dto/thread.dto';

import { SubscriberOrmEntity } from './subscriber.entity';

export const THREAD_STATUSES = ['open', 'closed'] as const;

export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const THREAD_CLOSE_REASONS = ['manual', 'inactivity'] as const;

export type ThreadCloseReason = (typeof THREAD_CLOSE_REASONS)[number];

@Entity({ name: 'threads' })
export class ThreadOrmEntity extends BaseOrmEntity<ThreadDto> {
  plainCls = threadSchema;

  fullCls = threadFullSchema;

  @ManyToOne(() => SubscriberOrmEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'subscriber_id' })
  @AsRelation()
  subscriber!: SubscriberOrmEntity;

  @RelationId((thread: ThreadOrmEntity) => thread.subscriber)
  private readonly subscriberId!: string;

  @ManyToOne(() => SourceOrmEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'source_id' })
  @AsRelation()
  source!: SourceOrmEntity;

  @RelationId((thread: ThreadOrmEntity) => thread.source)
  private readonly sourceId!: string;

  @EnumColumn({ enum: THREAD_STATUSES, default: 'open' })
  status!: ThreadStatus;

  @DatetimeColumn({ name: 'last_message_at', nullable: true })
  lastMessageAt?: Date | null;

  @DatetimeColumn({ name: 'closed_at', nullable: true })
  closedAt?: Date | null;

  @EnumColumn({ enum: THREAD_CLOSE_REASONS, nullable: true })
  closeReason?: ThreadCloseReason | null;

  @AuditLabel()
  @Column({ name: 'title', type: 'varchar', length: 255, nullable: true })
  title?: string | null;
}

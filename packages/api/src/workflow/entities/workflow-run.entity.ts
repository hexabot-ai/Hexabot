/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  WORKFLOW_RUN_STATUSES,
  type StepExecutionRecord,
  type WorkflowCheckpoint,
  type WorkflowRunStatus,
  type WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import { workflowRunSchema, workflowRunFullSchema } from '@hexabot-ai/types';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  RelationId,
} from 'typeorm';

import { ThreadOrmEntity } from '@/chat/entities/thread.entity';
import { DatetimeColumn } from '@/database/decorators/datetime-column.decorator';
import { EnumColumn } from '@/database/decorators/enum-column.decorator';
import { JsonColumn } from '@/database/decorators/json-column.decorator';
import { BaseOrmEntity } from '@/database/entities/base.entity';
import { UserProfileDto } from '@/user/dto/user-profile.dto';
import { UserProfileOrmEntity } from '@/user/entities/user-profile.entity';
import { AsRelation } from '@/utils/decorators/relation-ref.decorator';

import { WorkflowRunDto } from '../dto/workflow-run.dto';

import { WorkflowVersionOrmEntity } from './workflow-version.entity';
import { WorkflowOrmEntity } from './workflow.entity';

@Entity({ name: 'workflow_runs' })
@Index(['parentRun'])
@Index('IDX_workflow_runs_awaiting_operator', ['awaitingOperator'])
export class WorkflowRunOrmEntity extends BaseOrmEntity<WorkflowRunDto> {
  plainCls = workflowRunSchema;

  fullCls = workflowRunFullSchema;

  /** Workflow definition executed by this run. */
  @ManyToOne(() => WorkflowOrmEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workflow_id' })
  @AsRelation()
  workflow!: WorkflowOrmEntity;

  /** Identifier of the linked workflow (for internal relations). */
  @RelationId((run: WorkflowRunOrmEntity) => run.workflow)
  private readonly workflowId!: string;

  /** Workflow definition version executed by this run. */
  @ManyToOne(() => WorkflowVersionOrmEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'workflow_version_id' })
  @AsRelation()
  workflowVersion?: WorkflowVersionOrmEntity | null;

  /** Identifier of the linked workflow version (for internal relations). */
  @RelationId((run: WorkflowRunOrmEntity) => run.workflowVersion)
  private readonly workflowVersionId?: string | null;

  /** User that triggered the run, if applicable. */
  @ManyToOne(() => UserProfileOrmEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'triggered_by_id' })
  @AsRelation()
  triggeredBy?: UserProfileOrmEntity<UserProfileDto> | null;

  /** Identifier of the triggering subscriber (for internal relations). */
  @RelationId((run: WorkflowRunOrmEntity) => run.triggeredBy)
  private readonly triggeredById?: string | null;

  /** Conversation thread linked to this run (for conversational workflows). */
  @ManyToOne(() => ThreadOrmEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'thread_id' })
  @AsRelation()
  thread?: ThreadOrmEntity | null;

  /** Identifier of the linked thread (for internal relations). */
  @RelationId((run: WorkflowRunOrmEntity) => run.thread)
  private readonly threadId?: string | null;

  /** Parent workflow run that is waiting for this run to return. */
  @ManyToOne(() => WorkflowRunOrmEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_run_id' })
  @AsRelation()
  parentRun?: WorkflowRunOrmEntity | null;

  /** Identifier of the parent run (for internal relations). */
  @RelationId((run: WorkflowRunOrmEntity) => run.parentRun)
  private readonly parentRunId?: string | null;

  /** Lifecycle status of the run (idle, running, suspended, finished, failed). */
  @EnumColumn({
    enum: WORKFLOW_RUN_STATUSES,
    default: EWorkflowRunStatus.IDLE,
  })
  status!: WorkflowRunStatus;

  /** Input payload provided at run start. */
  @JsonColumn({ nullable: true })
  input?: Record<string, unknown> | null;

  /** Output payload produced by the workflow. */
  @JsonColumn({ nullable: true })
  output?: Record<string, unknown> | null;

  /** Context state object shared across workflow steps. */
  @JsonColumn({ nullable: true })
  context?: Record<string, unknown> | null;

  /** Engine snapshot capturing the runner state. */
  @JsonColumn({ nullable: true })
  snapshot?: WorkflowSnapshot | null;

  /** Detailed execution log per step for UI/telemetry. */
  @JsonColumn({ name: 'step_log', nullable: true })
  stepLog?: Record<string, StepExecutionRecord> | null;

  /**
   * Checkpoint of the suspended run: the only state needed to resume it, in
   * any process. Cleared once the run finishes or fails.
   */
  @JsonColumn({ nullable: true })
  checkpoint?: WorkflowCheckpoint | null;

  /**
   * Whether the stored checkpoint holds an open wait only an admin resolves
   * (`await_approval`, `suspend_workflow`). Derived from the checkpoint by
   * `WorkflowRunService` whenever it is written; backs the pending list.
   */
  @Column({ name: 'awaiting_operator', default: false })
  awaitingOperator!: boolean;

  /** Error message when the run fails. */
  @Column({ name: 'error', type: 'text', nullable: true })
  error?: string | null;

  /** Timestamp when the run entered the suspended state. */
  @DatetimeColumn({ name: 'suspended_at', nullable: true })
  suspendedAt?: Date | null;

  /** Timestamp when the run successfully finished. */
  @DatetimeColumn({ name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  /** Timestamp when the run failed irrecoverably. */
  @DatetimeColumn({ name: 'failed_at', nullable: true })
  failedAt?: Date | null;

  /** Additional opaque metadata associated with the run. */
  @JsonColumn({ nullable: true })
  metadata?: Record<string, unknown> | null;
}

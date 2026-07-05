/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  Workflow as AgenticWorkflow,
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_TIMEOUT_MS,
} from '@hexabot-ai/agentic';
import { WebhookTriggerConfig, workflowSchema } from '@hexabot-ai/types';
import { CronJob } from 'cron';
import { JSONSchema7 as JsonSchema } from 'json-schema';
import {
  Column,
  Entity,
  Index,
  InsertEvent,
  JoinColumn,
  ManyToOne,
  RelationId,
} from 'typeorm';

import { AuditLabel } from '@/audit/decorators/audit-label.decorator';
import { EnumColumn } from '@/database/decorators/enum-column.decorator';
import { JsonColumn } from '@/database/decorators/json-column.decorator';
import {
  OnAfterInsert,
  OnBeforeInsert,
  OnBeforeRemove,
  OnBeforeUpdate,
} from '@/database/decorators/orm-event-hooks.decorator';
import { BaseOrmEntity } from '@/database/entities/base.entity';
import { UserOrmEntity } from '@/user/entities/user.entity';
import { AsRelation } from '@/utils';

import { WorkflowDto, workflowFullSchema } from '../dto/workflow.dto';
import {
  conversationalWorkflowInputJsonSchema,
  manualWorkflowDefaultInputJsonSchema,
  scheduledWorkflowInputJsonSchema,
} from '../schemas/workflow-input-schemas';
import { DirectionType, WorkflowType, WorkflowVersionAction } from '../types';

import { WorkflowVersionOrmEntity } from './workflow-version.entity';

@Entity({ name: 'workflows' })
@Index(['name'], { unique: true })
export class WorkflowOrmEntity extends BaseOrmEntity<WorkflowDto> {
  plainCls = workflowSchema;

  fullCls = workflowFullSchema;

  static readonly BLANK_DEFINITION_YML = AgenticWorkflow.stringifyDefinition({
    defaults: {
      settings: {
        timeout_ms: DEFAULT_TIMEOUT_MS,
        retries: { ...DEFAULT_RETRY_SETTINGS },
      },
    },
    defs: {},
    flow: [],
    outputs: {},
  });

  /** Human-readable workflow name, unique per version. */
  @AuditLabel()
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Optional description to explain the workflow's purpose. */
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Workflow trigger type (conversational, manual, scheduled). */
  @EnumColumn({
    enum: WorkflowType,
    default: WorkflowType.conversational,
  })
  type!: WorkflowType;

  /** Cron expression used when the workflow is scheduled. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  schedule?: string | null;

  /** JSON Schema describing the expected workflow input payload. */
  @JsonColumn({ name: 'input_schema' })
  inputSchema!: JsonSchema;

  /**
   * Optional webhook trigger configuration for manual workflows. When enabled,
   * exposes a public URL that authenticates incoming calls before running the
   * workflow. Stored as JSON; secrets are referenced by credential ID, never
   * inline. The JSON carries no foreign key, so referential integrity is
   * enforced at the guard: a dangling credential reference fails auth (401).
   */
  @JsonColumn({ name: 'webhook_trigger', nullable: true })
  webhookTrigger?: WebhookTriggerConfig | null;

  /** Indicates if the workflow is built-in and protected from deletion. */
  @Column({ default: false })
  builtin!: boolean;

  /** User who created the workflow definition. */
  @ManyToOne(() => UserOrmEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by_id' })
  @AsRelation()
  createdBy?: UserOrmEntity | null;

  /** Identifier of the creator (for lightweight DTO projection). */
  @RelationId((workflow: WorkflowOrmEntity) => workflow.createdBy)
  private readonly createdById?: string | null;

  /** Active workflow definition snapshot. */
  @ManyToOne(() => WorkflowVersionOrmEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'current_version_id' })
  @AsRelation()
  currentVersion?: WorkflowVersionOrmEntity | null;

  /** Identifier of the active version (for lightweight DTO projection). */
  @RelationId((workflow: WorkflowOrmEntity) => workflow.currentVersion)
  private readonly currentVersionId?: string | null;

  /** Published workflow definition snapshot (null means draft). */
  @ManyToOne(() => WorkflowVersionOrmEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'published_version_id' })
  @AsRelation()
  publishedVersion?: WorkflowVersionOrmEntity | null;

  /** Identifier of the published version (for lightweight DTO projection). */
  @RelationId((workflow: WorkflowOrmEntity) => workflow.publishedVersion)
  private readonly publishedVersionId?: string | null;

  @Column({
    type: 'decimal',
    default: 0,
  })
  x!: number;

  @Column({
    type: 'decimal',
    default: 0,
  })
  y!: number;

  @Column({
    type: 'decimal',
    default: 1,
  })
  zoom!: number;

  @EnumColumn({ enum: DirectionType, default: DirectionType.HORIZONTAL })
  direction!: DirectionType;

  @OnAfterInsert()
  protected async createBlankDefinitionVersion(
    event: InsertEvent<WorkflowOrmEntity>,
  ): Promise<void> {
    const currentVersionId =
      typeof this.currentVersion === 'string'
        ? this.currentVersion
        : this.currentVersion?.id;
    if (currentVersionId || this.currentVersionId) {
      return;
    }

    const createdById =
      typeof this.createdBy === 'string' ? this.createdBy : this.createdBy?.id;

    try {
      const version = event.manager.create(WorkflowVersionOrmEntity, {
        workflow: { id: this.id },
        version: 0,
        definitionYml: WorkflowOrmEntity.BLANK_DEFINITION_YML,
        action: WorkflowVersionAction.create,
        createdBy: createdById ? { id: createdById } : null,
        parentVersion: null,
        message: null,
      });
      await event.manager.save(WorkflowVersionOrmEntity, version);
    } catch (error: any) {
      const codes = [error?.code, error?.driverError?.code];
      if (!codes.includes('SQLITE_CONSTRAINT_UNIQUE')) {
        throw error;
      }
    }
  }

  @OnBeforeRemove()
  protected preventBuiltinRemoval(): void {
    if (this.builtin) {
      throw new Error('Cannot delete builtin workflow');
    }
  }

  /**
   * Keep workflow input schema aligned with workflow trigger type.
   *
   * Conversational and scheduled workflows are assigned fixed schemas.
   * Manual workflows preserve custom schemas, defaulting to an open object schema.
   * When a workflow switches from a fixed-schema type to manual without an explicit
   * custom schema, the previous fixed schema is replaced with the manual default.
   */
  @OnBeforeInsert()
  @OnBeforeUpdate()
  protected syncInputSchema(): void {
    if (!this.type) {
      return;
    }

    if (this.type === WorkflowType.conversational) {
      this.inputSchema = conversationalWorkflowInputJsonSchema;

      return;
    }

    if (this.type === WorkflowType.scheduled) {
      this.inputSchema = scheduledWorkflowInputJsonSchema;

      return;
    }

    if (
      !this.inputSchema ||
      typeof this.inputSchema !== 'object' ||
      Array.isArray(this.inputSchema) ||
      this.hasFixedInputSchema(this.inputSchema)
    ) {
      this.inputSchema = manualWorkflowDefaultInputJsonSchema;
    }
  }

  /**
   * Check whether the provided schema matches one of the fixed trigger schemas.
   */
  private hasFixedInputSchema(schema: JsonSchema): boolean {
    return (
      isDeepStrictEqual(schema, conversationalWorkflowInputJsonSchema) ||
      isDeepStrictEqual(schema, scheduledWorkflowInputJsonSchema)
    );
  }

  get runAfterMs() {
    if (this.type === 'scheduled' && this.schedule) {
      try {
        const job = new CronJob(this.schedule, () => {});
        const nextDate = job.nextDate();

        return nextDate.toMillis() - Date.now();
      } catch {
        return -1;
      }
    }

    return 0;
  }
}

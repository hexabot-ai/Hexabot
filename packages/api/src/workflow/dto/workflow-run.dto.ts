/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  WORKFLOW_RUN_STATUSES,
  type StepExecutionRecord,
  type WorkflowCheckpoint,
  type WorkflowRunStatus,
  type WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import { workflowRunFullSchema, workflowRunSchema } from '@hexabot-ai/types';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

import { IsUUIDv4 } from '@/utils/decorators/is-uuid.decorator';
import { TDto } from '@/utils/types/dto.types';

export class WorkflowRunCreateDto {
  @ApiProperty({ description: 'Workflow to execute', type: String })
  @IsNotEmpty()
  @IsUUIDv4({
    message: 'Workflow must be a valid UUID',
  })
  workflow!: string;

  @ApiPropertyOptional({
    description: 'User who triggered the run',
    type: String,
  })
  @IsOptional()
  @IsUUIDv4({
    message: 'Triggering user must be a valid UUID',
  })
  triggeredBy?: string | null;

  @ApiPropertyOptional({
    description: 'Conversation thread associated with the run',
    type: String,
  })
  @IsOptional()
  @IsUUIDv4({
    message: 'Thread must be a valid UUID',
  })
  thread?: string | null;

  @ApiPropertyOptional({
    description: 'Workflow version executed by the run',
    type: String,
  })
  @IsOptional()
  @IsUUIDv4({
    message: 'Workflow version must be a valid UUID',
  })
  workflowVersion?: string | null;

  @ApiPropertyOptional({
    description: 'Parent workflow run waiting for this run',
    type: String,
  })
  @IsOptional()
  @IsUUIDv4({
    message: 'Parent workflow run must be a valid UUID',
  })
  parentRun?: string | null;

  @ApiPropertyOptional({
    description: 'Lifecycle status of the run',
    enum: WORKFLOW_RUN_STATUSES,
  })
  @IsOptional()
  @IsIn(WORKFLOW_RUN_STATUSES)
  status?: WorkflowRunStatus;

  @ApiPropertyOptional({ description: 'Input payload', type: Object })
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Context snapshot', type: Object })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Workflow output', type: Object })
  @IsOptional()
  @IsObject()
  output?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Runner snapshot', type: Object })
  @IsOptional()
  @IsObject()
  snapshot?: WorkflowSnapshot | null;

  @ApiPropertyOptional({ description: 'Step execution log', type: Object })
  @IsOptional()
  @IsObject()
  stepLog?: Record<string, StepExecutionRecord> | null;

  @ApiPropertyOptional({
    description: 'Checkpoint of the suspended run, needed to resume it',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  checkpoint?: WorkflowCheckpoint | null;

  @ApiPropertyOptional({
    description: 'Whether the run waits on an admin decision',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  awaitingOperator?: boolean;

  @ApiPropertyOptional({ description: 'Error message if failed', type: String })
  @IsOptional()
  @IsString()
  error?: string | null;

  @ApiPropertyOptional({ description: 'Suspension timestamp', type: Date })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  suspendedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Completion timestamp', type: Date })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  finishedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Failure timestamp', type: Date })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  failedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Opaque metadata', type: Object })
  @IsOptional()
  metadata?: Record<string, unknown> | null;
}

export class WorkflowRunUpdateDto extends PartialType(WorkflowRunCreateDto) {}

export type WorkflowRunDto = TDto<
  {
    plain: typeof workflowRunSchema;
    full: typeof workflowRunFullSchema;
  },
  {
    create: WorkflowRunCreateDto;
    update: WorkflowRunUpdateDto;
  }
>;

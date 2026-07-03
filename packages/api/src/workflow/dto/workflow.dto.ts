/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  createWorkflowFullSchema as createTypesWorkflowFullSchema,
  WebhookTriggerConfig,
  webhookTriggerSchema,
  workflowSchema,
} from '@hexabot-ai/types';
import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { JSONSchema7 as JsonSchema } from 'json-schema';
import { z } from 'zod';

import { Validate } from '@/utils';
import { IsUUIDv4 } from '@/utils/decorators/is-uuid.decorator';
import { TDto } from '@/utils/types/dto.types';

import { parseWorkflowDefinition } from '../lib/workflow-definition';
import { NestCronSchema } from '../schemas/workflow-schemas';
import { DirectionType, WorkflowType } from '../types';

export const workflowFullSchema = createTypesWorkflowFullSchema({
  parseDefinition: parseWorkflowDefinition,
});

const WorkflowInputSchemaValidator = z.looseObject({});

export class WorkflowCreateDto {
  @ApiProperty({ description: 'Workflow name', type: String })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Workflow description', type: String })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Workflow trigger type',
    enumName: 'WorkflowType',
    enum: WorkflowType,
    default: WorkflowType.conversational,
  })
  @IsOptional()
  @IsEnum(WorkflowType)
  type?: WorkflowType;

  @ApiPropertyOptional({
    description: 'Cron expression used when the workflow is scheduled',
    type: String,
  })
  @ValidateIf((payload) => payload.schedule !== undefined)
  @IsOptional()
  @IsString()
  @Validate(NestCronSchema)
  schedule?: string | null;

  @ApiPropertyOptional({
    description:
      'JSON Schema for workflow input. Editable only for manual workflows.',
    type: Object,
  })
  @IsOptional()
  @Validate(WorkflowInputSchemaValidator)
  inputSchema?: JsonSchema;

  @ApiPropertyOptional({
    description:
      'Webhook trigger configuration (manual workflows only). Enables a public ' +
      'trigger URL and defines how incoming calls authenticate.',
    type: Object,
  })
  @IsOptional()
  @Validate(webhookTriggerSchema)
  webhookTrigger?: WebhookTriggerConfig | null;

  @ApiPropertyOptional({
    description: 'Indicates if the workflow is built-in',
    type: Boolean,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  builtin?: boolean;

  @ApiPropertyOptional({
    description: 'Workflow x offset',
    type: Number,
  })
  @IsNumber()
  @IsOptional()
  x?: number;

  @ApiPropertyOptional({
    description: 'Workflow y offset',
    type: Number,
  })
  @IsNumber()
  @IsOptional()
  y?: number;

  @ApiPropertyOptional({
    description: 'Workflow zoom',
    type: Number,
  })
  @IsNumber({ maxDecimalPlaces: 20 })
  @IsOptional()
  zoom?: number;

  @ApiPropertyOptional({
    description: 'Workflow direction',
    type: Number,
  })
  @IsEnum(DirectionType)
  @IsOptional()
  direction?: DirectionType;

  @ApiProperty({ description: 'Workflow creator', type: String })
  @IsOptional()
  @IsUUIDv4({
    message: 'createdBy must be a valid UUID',
  })
  createdBy!: string;
}

export class WorkflowUpdateDto extends PartialType(
  OmitType(WorkflowCreateDto, ['type'] as const),
) {
  @ApiProperty({ description: 'Current version', type: String })
  @IsOptional()
  @IsUUIDv4({
    message: 'Current version must be a valid UUID',
  })
  currentVersion?: string | null;

  @ApiPropertyOptional({ description: 'Published version', type: String })
  @IsOptional()
  @IsUUIDv4({
    message: 'Published version must be a valid UUID',
  })
  publishedVersion?: string | null;
}

export type WorkflowDto = TDto<
  {
    plain: typeof workflowSchema;
    full: typeof workflowFullSchema;
  },
  {
    create: WorkflowCreateDto;
    update: WorkflowUpdateDto;
  }
>;

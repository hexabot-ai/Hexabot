/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { OPERATOR_TEXT_MAX_LENGTH } from '../schemas/operator-wait-schemas';

/** Longest wait id accepted in a request. */
const WAIT_ID_MAX_LENGTH = 512;

export class WorkflowRunWaitTargetDto {
  @ApiPropertyOptional({
    description:
      'Open wait to resolve, from `checkpoint.waits`. Optional when the run has exactly one wait of this kind.',
    type: String,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(WAIT_ID_MAX_LENGTH)
  waitId?: string;
}

export class WorkflowRunDecisionDto extends WorkflowRunWaitTargetDto {
  @ApiPropertyOptional({
    description: 'Optional comment passed on to the workflow',
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(OPERATOR_TEXT_MAX_LENGTH)
  comment?: string;
}

export class WorkflowRunResumeDto extends WorkflowRunWaitTargetDto {
  @ApiPropertyOptional({
    description:
      "JSON object passed on to the workflow; checked against the step's payload schema. Defaults to {}.",
    type: Object,
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class WorkflowRunCancelDto {
  @ApiPropertyOptional({
    description: 'Optional reason stored on the failed run',
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(OPERATOR_TEXT_MAX_LENGTH)
  reason?: string;
}

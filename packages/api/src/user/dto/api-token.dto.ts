/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Action,
  type ApiTokenScope,
  ApiTokenType,
  apiTokenFullSchema,
  apiTokenSchema,
  modelIdentities,
  type TModel,
} from '@hexabot-ai/types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { TDto } from '@/utils/types/dto.types';

export class ApiTokenScopeDto {
  @ApiProperty({
    description: 'Model identity covered by this scope',
    enum: modelIdentities,
  })
  @IsIn(modelIdentities)
  model!: TModel;

  @ApiProperty({
    description: 'Allowed action on the model',
    enum: Action,
  })
  @IsEnum(Action)
  action!: Action;
}

export class ApiTokenCreateDto {
  @ApiProperty({
    description: 'Human-readable API token name',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional token expiry date',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiProperty({
    description: 'Token model/action scopes',
    type: [ApiTokenScopeDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApiTokenScopeDto)
  scopes!: ApiTokenScopeDto[];
}

/**
 * Shape persisted to `personal_access_tokens`. This is deliberately distinct
 * from {@link ApiTokenCreateDto} (the HTTP payload): the service derives the
 * hash, prefix and owner server-side and writes them alongside the
 * caller-supplied fields, so the repository create/update payloads are typed
 * against this internal shape rather than the request DTO.
 */
export type ApiTokenPersistenceDto = {
  name: string;
  owner: string;
  tokenHash: string;
  tokenPrefix: string;
  tokenType: ApiTokenType;
  scopes: ApiTokenScope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type ApiTokenDto = TDto<
  {
    plain: typeof apiTokenSchema;
    full: typeof apiTokenFullSchema;
  },
  {
    create: ApiTokenPersistenceDto;
    update: Partial<ApiTokenPersistenceDto>;
  }
>;

export { ApiTokenType };

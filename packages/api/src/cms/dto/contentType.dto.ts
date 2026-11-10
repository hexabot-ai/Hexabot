/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  CONTENT_FIELD_TYPES,
  contentTypeFullSchema,
  contentTypeJsonSchema,
  contentTypeSchema,
} from '@hexabot-ai/types';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { JSONSchema7 as JsonSchema } from 'json-schema';

import { Validate } from '@/utils/decorators/validate.decorator';
import { TDto } from '@/utils/types/dto.types';

export class ContentTypeCreateDto {
  @ApiProperty({ description: 'Content type name', type: String })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: `JSON Schema describing the content structure. Each field of \`properties\` is { type, title?, description? }, where \`type\` is one of: ${CONTENT_FIELD_TYPES.join(', ')}`,
    type: Object,
  })
  @Validate(contentTypeJsonSchema)
  schema!: JsonSchema;
}

export class ContentTypeUpdateDto extends PartialType(ContentTypeCreateDto) {}

export type ContentTypeDto = TDto<
  {
    plain: typeof contentTypeSchema;
    full: typeof contentTypeFullSchema;
  },
  {
    create: ContentTypeCreateDto;
    update: ContentTypeUpdateDto;
  }
>;

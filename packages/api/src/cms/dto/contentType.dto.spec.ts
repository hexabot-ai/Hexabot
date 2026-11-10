/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DEFAULT_CONTENT_TYPE_SCHEMA } from '@hexabot-ai/types';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ContentTypeCreateDto } from './contentType.dto';

const validateSchema = (field: Record<string, unknown>) =>
  validate(
    plainToInstance(ContentTypeCreateDto, {
      name: 'Article',
      schema: {
        ...DEFAULT_CONTENT_TYPE_SCHEMA,
        properties: { ...DEFAULT_CONTENT_TYPE_SCHEMA.properties, link: field },
      },
    }),
  );

describe('ContentTypeCreateDto', () => {
  it('accepts Hexabot field types', async () => {
    expect(await validateSchema({ type: 'uri', title: 'Link' })).toEqual([]);
  });

  it('refuses JSON Schema formats with a hint at the field type', async () => {
    const [error] = await validateSchema({ type: 'string', format: 'uri' });

    expect(error?.property).toBe('schema');
    expect(Object.values(error?.constraints ?? {}).join()).toContain(
      'schema.properties.link: Unsupported key(s) "format"',
    );
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { toDraft07JsonSchema } from '@/utils/helpers/zod';

import { WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA } from './settings.schema';

describe('WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA', () => {
  it('normalizes missing and blank avatar URLs to an empty string', () => {
    expect(WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({})).toMatchObject({
      avatar_url: '',
    });
    expect(
      WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({ avatar_url: undefined }),
    ).toMatchObject({
      avatar_url: '',
    });
    expect(
      WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({ avatar_url: '' }),
    ).toMatchObject({
      avatar_url: '',
    });
    expect(
      WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({ avatar_url: '   ' }),
    ).toMatchObject({
      avatar_url: '',
    });
  });

  it('preserves valid avatar URLs and rejects invalid non-empty values', () => {
    expect(
      WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({
        avatar_url: 'https://example.com/avatar.png',
      }),
    ).toMatchObject({
      avatar_url: 'https://example.com/avatar.png',
    });

    expect(() =>
      WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({ avatar_url: 'not-a-url' }),
    ).toThrow();
  });

  it('keeps avatar_url as an optional URI string in generated JSON schema', () => {
    const jsonSchema = toDraft07JsonSchema(WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA);
    const avatarUrlSchema = jsonSchema.properties?.avatar_url;

    expect(avatarUrlSchema).toMatchObject({
      default: '',
      type: 'string',
      format: 'uri',
    });
    expect(jsonSchema.required ?? []).not.toContain('avatar_url');
  });
});

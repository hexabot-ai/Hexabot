/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { toDraft07JsonSchema } from '@/utils/helpers/zod';

import { CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA } from './settings.schema';

describe('CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA', () => {
  it('does not include pre-chat subscription settings in defaults', () => {
    const settings = CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({});

    expect(settings).not.toHaveProperty('greeting_message');
    expect(settings).not.toHaveProperty('start_button');
  });

  it('does not expose pre-chat subscription settings in generated JSON schema', () => {
    const jsonSchema = toDraft07JsonSchema(
      CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA,
    );

    expect(jsonSchema.properties ?? {}).not.toHaveProperty('greeting_message');
    expect(jsonSchema.properties ?? {}).not.toHaveProperty('start_button');
  });
});

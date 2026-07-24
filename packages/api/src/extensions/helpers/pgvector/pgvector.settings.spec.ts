/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { vercelAiSdkProviders } from '../../actions/ai/provider.constants';

import { pgvectorSettingsSchema } from './pgvector.settings';

describe('pgvectorSettingsSchema', () => {
  it('exposes the AI provider list and credential selector metadata', () => {
    const schema = pgvectorSettingsSchema.toJSONSchema({
      target: 'draft-07',
    }) as {
      properties?: Record<
        string,
        {
          enum?: string[];
          'ui:widget'?: string;
          'ui:options'?: Record<string, unknown>;
        }
      >;
    };

    expect(schema.properties?.embedding_provider?.enum).toEqual([
      ...vercelAiSdkProviders,
    ]);
    expect(schema.properties?.embedding_api_key).toMatchObject({
      'ui:widget': 'AutoCompleteWidget',
      'ui:options': {
        entity: 'Credential',
        valueKey: 'id',
        labelKey: 'name',
        enableEntityAddButton: true,
      },
    });
    expect(schema.properties?.embedding_base_url).toMatchObject({
      'ui:options': {
        showWhen: {
          field: 'embedding_provider',
          in: ['gateway', 'litellm'],
        },
      },
    });
  });
});

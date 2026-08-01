/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import type { I18nService } from '@/i18n/services/i18n.service';
import { globalSettingsSchema } from '@/setting/default.settings';

import { toDraft07JsonSchema } from './zod';

describe('toDraft07JsonSchema', () => {
  it('returns draft-07 JSON schema without localization by default', () => {
    const schema = z.strictObject({
      field: z.string().default('hello').meta({
        title: 'Field title',
        description: 'Field description',
      }),
    });
    const result = toDraft07JsonSchema(schema) as {
      $schema?: string;
      properties?: Record<
        string,
        { title?: string; description?: string; default?: string }
      >;
    };

    expect(result.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(result.properties?.field?.title).toBe('Field title');
    expect(result.properties?.field?.description).toBe('Field description');
    expect(result.properties?.field?.default).toBe('hello');
  });

  it('localizes title and description metadata when requested', () => {
    const i18n = {
      t: jest.fn((key: string, options?: { ns?: string; lang?: string }) => {
        return `${options?.lang}:${options?.ns}:${key}`;
      }),
    } as unknown as Pick<I18nService, 't'>;
    const schema = z.strictObject({
      field: z.string().default('hello').meta({
        title: 'Field title',
        description: 'Field description',
        'ui:widget': 'TextAreaWidget',
      }),
    });
    const result = toDraft07JsonSchema(schema, {
      localize: {
        i18n,
        ns: 'example_namespace',
        lang: 'fr',
      },
    }) as {
      properties?: Record<
        string,
        {
          title?: string;
          description?: string;
          default?: string;
          'ui:widget'?: string;
        }
      >;
    };

    expect(result.properties?.field?.title).toBe(
      'fr:example_namespace:Field title',
    );
    expect(result.properties?.field?.description).toBe(
      'fr:example_namespace:Field description',
    );
    expect(result.properties?.field?.['ui:widget']).toBe('TextAreaWidget');
    expect(result.properties?.field?.default).toBe('hello');
    expect(i18n.t).toHaveBeenCalledWith('Field title', {
      ns: 'example_namespace',
      lang: 'fr',
      defaultValue: 'Field title',
    });
    expect(i18n.t).toHaveBeenCalledWith('Field description', {
      ns: 'example_namespace',
      lang: 'fr',
      defaultValue: 'Field description',
    });
  });

  it('requires the storage helper without generating a default value', () => {
    const result = toDraft07JsonSchema(globalSettingsSchema);
    const storageHelper = result.properties?.default_storage_helper;

    expect(result.required).toContain('default_storage_helper');
    expect(storageHelper).not.toHaveProperty('default');
    expect(
      globalSettingsSchema.safeParse({ default_storage_helper: '' }).success,
    ).toBe(false);
  });
});

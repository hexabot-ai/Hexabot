/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import { RuntimeSettingRegistryMap } from '@/setting/services/runtime-settings.service';

import {
  buildSettingSeedsFromRegistry,
  buildSettingSeedsFromSchema,
} from './runtime-settings.seed';

describe('runtime-settings.seed', () => {
  it('adds subgroup marker when provided to schema seed builder', () => {
    const schema = z.strictObject({
      enabled: z.boolean().default(true),
    });

    expect(
      buildSettingSeedsFromSchema('ollama', schema, { subgroup: 'helper' }),
    ).toEqual([
      {
        group: 'ollama',
        subgroup: 'helper',
        label: 'enabled',
        value: true,
      },
    ]);
  });

  it('seeds defaulted settings while leaving required settings for user setup', () => {
    const schema = z.strictObject({
      defaulted: z.string().default('automatic'),
      required: z.string(),
    });

    expect(buildSettingSeedsFromSchema('settings', schema)).toEqual([
      {
        group: 'settings',
        label: 'defaulted',
        value: 'automatic',
      },
    ]);
  });

  it('adds subgroup marker for helper extension groups from runtime registry', () => {
    const registry: RuntimeSettingRegistryMap = {
      ollama: {
        schema: z.strictObject({
          base_url: z.string().default('http://localhost:11434'),
        }),
        scope: 'extension',
        extensionType: 'helper',
        extensionName: 'ollama',
      },
      ai_generate_text: {
        schema: z.strictObject({
          model: z.string().default('gpt-4.1-mini'),
        }),
        scope: 'extension',
        extensionType: 'action',
        extensionName: 'ai_generate_text',
      },
      global_settings: {
        schema: z.strictObject({
          license_key: z.string().default(''),
        }),
        scope: 'global',
      },
    };
    const seeds = buildSettingSeedsFromRegistry(registry);
    const ollamaSeed = seeds.find(
      (seed) => seed.group === 'ollama' && seed.label === 'base_url',
    );
    const actionSeed = seeds.find(
      (seed) => seed.group === 'ai_generate_text' && seed.label === 'model',
    );
    const globalSeed = seeds.find(
      (seed) =>
        seed.group === 'global_settings' && seed.label === 'license_key',
    );

    expect(ollamaSeed).toEqual({
      group: 'ollama',
      subgroup: 'helper',
      label: 'base_url',
      value: 'http://localhost:11434',
    });
    expect(actionSeed).toEqual({
      group: 'ai_generate_text',
      label: 'model',
      value: 'gpt-4.1-mini',
    });
    expect(globalSeed).toEqual({
      group: 'global_settings',
      label: 'license_key',
      value: '',
    });
  });
});

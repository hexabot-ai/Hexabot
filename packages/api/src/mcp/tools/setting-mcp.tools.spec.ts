/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { NotFoundException } from '@nestjs/common';

import { HexabotSettingMcpTools } from './setting-mcp.tools';

const schemas = {
  global_settings: {
    scope: 'global',
    schema: {
      type: 'object',
      properties: {
        license_key: { type: 'string', 'ui:widget': 'password' },
        default_rag_helper: { type: 'string', default: 'fulltext-search' },
      },
    },
  },
  contact: {
    scope: 'global',
    schema: {
      type: 'object',
      properties: { company_name: { type: 'string' } },
    },
  },
};
const licenseKey = {
  id: 'license-key-id',
  group: 'global_settings',
  label: 'license_key',
  value: 'secret-license',
};
const ragHelper = {
  id: 'rag-helper-id',
  group: 'global_settings',
  label: 'default_rag_helper',
  value: 'fulltext-search',
};
const buildTools = (settingService: Record<string, unknown>) =>
  new HexabotSettingMcpTools({
    getAllSchemaDefinitions: jest.fn().mockReturnValue(schemas),
    ...settingService,
  } as any);

describe('HexabotSettingMcpTools', () => {
  it('lists the settings of a group without the values of secret settings', async () => {
    const settingService = {
      find: jest.fn().mockResolvedValue([ragHelper, licenseKey]),
    };
    const tools = buildTools(settingService);
    const result = await tools.searchSettings({ group: 'global_settings' });

    expect(result).toEqual({
      items: [
        ragHelper,
        {
          id: 'license-key-id',
          group: 'global_settings',
          label: 'license_key',
          secret: true,
          hasValue: true,
        },
      ],
      total: 2,
    });
    expect(JSON.stringify(result)).not.toContain('secret-license');
    expect(settingService.find).toHaveBeenCalledWith({
      where: { group: 'global_settings' },
      order: { group: 'ASC', label: 'ASC' },
    });
  });

  it('withholds the values of settings no registered schema declares', async () => {
    // A removed action extension leaves its settings behind; a group's schema
    // may also stop declaring a setting it used to have.
    const orphanToken = {
      id: 'orphan-token-id',
      group: 'removed_action',
      label: 'api_token',
      value: 'orphan-secret',
    };
    const legacyKey = {
      id: 'legacy-key-id',
      group: 'global_settings',
      label: 'legacy_key',
      value: 'legacy-secret',
    };
    const tools = buildTools({
      find: jest.fn().mockResolvedValue([ragHelper, orphanToken, legacyKey]),
    });
    const result = await tools.searchSettings({});

    expect(result.items).toEqual([
      ragHelper,
      {
        id: 'orphan-token-id',
        group: 'removed_action',
        label: 'api_token',
        secret: true,
        hasValue: true,
      },
      {
        id: 'legacy-key-id',
        group: 'global_settings',
        label: 'legacy_key',
        secret: true,
        hasValue: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('orphan-secret');
    expect(JSON.stringify(result)).not.toContain('legacy-secret');
  });

  it('reads the schema of a setting group', async () => {
    const tools = buildTools({});

    await expect(
      tools.getSettingSchema({ group: 'global_settings' }),
    ).resolves.toEqual({
      group: 'global_settings',
      ...schemas.global_settings,
    });
    await expect(tools.getSettingSchema({ group: 'pgvector' })).rejects.toThrow(
      'Setting group "pgvector" is not registered. Registered groups: contact, global_settings',
    );
  });

  it('sets a setting addressed by group and label', async () => {
    const settingService = {
      findOne: jest.fn().mockResolvedValue(ragHelper),
      updateOne: jest
        .fn()
        .mockResolvedValue({ ...ragHelper, value: 'pgvector' }),
    };
    const tools = buildTools(settingService);

    await expect(
      tools.updateSetting({
        group: 'global_settings',
        label: 'default_rag_helper',
        value: 'pgvector',
      }),
    ).resolves.toEqual({ ...ragHelper, value: 'pgvector' });
    expect(settingService.findOne).toHaveBeenCalledWith({
      where: { group: 'global_settings', label: 'default_rag_helper' },
    });
    expect(settingService.updateOne).toHaveBeenCalledWith('rag-helper-id', {
      value: 'pgvector',
    });
  });

  it('sets a secret setting without returning its value', async () => {
    const settingService = {
      findOne: jest.fn().mockResolvedValue({ ...licenseKey, value: '' }),
      updateOne: jest.fn().mockResolvedValue(licenseKey),
    };
    const tools = buildTools(settingService);
    const result = await tools.updateSetting({
      group: 'global_settings',
      label: 'license_key',
      value: 'secret-license',
    });

    expect(result).toEqual(
      expect.objectContaining({ secret: true, hasValue: true }),
    );
    expect(result).not.toHaveProperty('value');
  });

  it('refuses a setting that does not exist', async () => {
    const settingService = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn(),
    };
    const tools = buildTools(settingService);

    await expect(
      tools.updateSetting({ group: 'pgvector', label: 'url', value: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(settingService.updateOne).not.toHaveBeenCalled();
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Cache } from 'cache-manager';

import { SettingRepository } from '../repositories/setting.repository';

import { SettingSeeder } from './setting.seed';

describe('SettingSeeder', () => {
  it('seeds missing labels without overwriting an existing group', async () => {
    const repository = {
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      createMany: jest.fn(),
    };
    const cache = { del: jest.fn() };
    const seeder = new SettingSeeder(
      repository as unknown as SettingRepository,
      cache as unknown as Cache,
    );
    const existing = {
      group: 'global_settings',
      label: 'license_key',
      value: 'preserve-me',
    };
    const additive = {
      group: 'global_settings',
      label: 'default_rag_helper',
      value: 'fulltext-search',
    };

    await seeder.seed([existing, additive]);

    expect(repository.count).toHaveBeenNthCalledWith(1, {
      where: {
        group: existing.group,
        label: existing.label,
      },
    });
    expect(repository.count).toHaveBeenNthCalledWith(2, {
      where: {
        group: additive.group,
        label: additive.label,
      },
    });
    expect(repository.createMany).toHaveBeenCalledWith([additive]);
    expect(cache.del).toHaveBeenCalledWith('settings');
  });
});

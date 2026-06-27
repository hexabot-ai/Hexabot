/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Setting } from '@hexabot-ai/types';

import LocalStorageHelper from '@/extensions/helpers/local-storage/index.helper';
import { HelperService } from '@/helper/helper.service';
import { SettingService } from '@/setting/services/setting.service';
import { installSettingFixturesTypeOrm } from '@/utils/test/fixtures/setting';
import { buildTestingMocks } from '@/utils/test/utils';

import { CleanupService } from './cleanup.service';

describe('CleanupService', () => {
  let initialSettings: Setting[];
  let helperService: HelperService;
  let cleanupService: CleanupService;
  let settingService: SettingService;

  const sortSettings = (settings: Setting[]) =>
    [...settings].sort((a, b) => {
      const groupCompare = a.group.localeCompare(b.group);
      if (groupCompare !== 0) {
        return groupCompare;
      }

      return a.label.localeCompare(b.label);
    });

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [CleanupService],
      typeorm: {
        fixtures: installSettingFixturesTypeOrm,
      },
    });

    [cleanupService, settingService, helperService] = await testing.getMocks([
      CleanupService,
      SettingService,
      HelperService,
    ]);

    initialSettings = await settingService.findAll();

    helperService.register(new LocalStorageHelper());
  });
  afterEach(async () => {
    jest.clearAllMocks();
    if (settingService) {
      await settingService.clearCache();
    }
  });

  describe('delete', () => {
    it('should delete unregistered helper settings using subgroup markers', async () => {
      const registeredHelpers = cleanupService.getHelperGroups();

      expect(registeredHelpers).toContain('local-storage');

      await cleanupService.pruneExtensionSettings();
      const cleanSettings = await settingService.findAll();
      const filteredSettings = initialSettings.filter(({ group, subgroup }) => {
        if (subgroup === 'helper') {
          return registeredHelpers.includes(group as string);
        }

        return true;
      });

      expect(sortSettings(cleanSettings)).toEqualPayload(
        sortSettings(filteredSettings),
      );
    });
  });
});

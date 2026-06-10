/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Setting } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';
import { z } from 'zod';

import {
  installSettingFixturesTypeOrm,
  settingFixtures,
} from '@/utils/test/fixtures/setting';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';

import {
  CONTACT_SETTINGS_GROUP,
  contactSettingsSchema,
} from '../default.settings';
import { SettingRepository } from '../repositories/setting.repository';

import { RuntimeSettingsService } from './runtime-settings.service';
import { SettingService } from './setting.service';

describe('SettingService', () => {
  let settingService: SettingService;
  let settingRepository: SettingRepository;
  let runtimeSettingsService: RuntimeSettingsService;
  let module: TestingModule;
  const createdIds: string[] = [];
  const makeSetting = (overrides: Partial<Setting>): Setting => {
    return {
      id: '',
      group: 'group',
      label: 'label',
      value: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      subgroup: null,
      ...overrides,
    };
  };

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [SettingService, I18nServiceProvider],
      typeorm: {
        fixtures: installSettingFixturesTypeOrm,
      },
    });
    module = testingModule;
    [settingService, settingRepository, runtimeSettingsService] =
      await getMocks([
        SettingService,
        SettingRepository,
        RuntimeSettingsService,
      ]);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  beforeEach(() => {
    runtimeSettingsService.reset();
    runtimeSettingsService.register({
      group: CONTACT_SETTINGS_GROUP,
      schema: contactSettingsSchema,
      scope: 'global',
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of createdIds) {
      await settingRepository.deleteOne(id);
    }
    createdIds.length = 0;
    runtimeSettingsService.reset();
    await settingService.clearCache();
  });

  describe('load', () => {
    it('Should return loaded settings', async () => {
      jest.spyOn(settingRepository, 'findAll');
      const result = await settingService.load();

      expect(settingRepository.findAll).toHaveBeenCalled();
      expect(result).toEqualPayload(
        settingService.group(
          settingFixtures.map((fixture) => makeSetting(fixture)),
        ),
        ['id', 'createdAt', 'updatedAt'],
      );
    });
  });

  describe('buildTree', () => {
    it('should return an empty object when settings are empty', () => {
      expect(settingService.buildTree([])).toEqual({});
    });

    it('should categorize settings by group and map labels to values', () => {
      const settings = [
        { group: 'group1', label: 'setting1', value: 'value1' },
        { group: 'group1', label: 'setting2', value: 'value2' },
        { group: 'group2', label: 'setting1', value: 'value3' },
      ].map((s) => makeSetting(s));
      expect(settingService.buildTree(settings)).toEqualPayload({
        group1: { setting1: 'value1', setting2: 'value2' },
        group2: { setting1: 'value3' },
      });
    });

    it('should handle undefined group as "undefinedGroup"', () => {
      const settings = [
        makeSetting({ label: 'setting1', value: 'value1', group: '' }),
      ];
      expect(settingService.buildTree(settings)).toEqualPayload({
        undefinedGroup: { setting1: 'value1' },
      });
    });
  });

  describe('group', () => {
    it('should return an empty object when settings are empty', () => {
      expect(settingService.group([])).toEqual({});
    });

    it('should group settings by their group property', () => {
      const settings = [
        { group: 'group1', label: 'setting1', value: 'value1' },
        { group: 'group1', label: 'setting2', value: 'value2' },
        { group: 'group2', label: 'setting1', value: 'value3' },
      ].map((s) => makeSetting(s));
      expect(settingService.group(settings)).toEqualPayload({
        group1: [
          makeSetting({
            group: 'group1',
            label: 'setting1',
            value: 'value1',
          }),
          makeSetting({
            group: 'group1',
            label: 'setting2',
            value: 'value2',
          }),
        ],
        group2: [
          makeSetting({
            group: 'group2',
            label: 'setting1',
            value: 'value3',
          }),
        ],
      });
    });
  });

  describe('getAllowedOrigins', () => {
    it('should return a set of unique origins from allowed_domains settings', async () => {
      const mockSettings = [
        makeSetting({
          label: 'allowed_domains',
          value: 'https://example.com,https://test.com',
        }),
        makeSetting({
          label: 'allowed_domains',
          value: ' https://example.com, https://another.com ',
        }),
      ];

      jest.spyOn(settingService, 'find').mockResolvedValue(mockSettings);

      const result = await settingService.getAllowedOrigins();

      expect(settingService.find).toHaveBeenCalledWith({
        where: { label: 'allowed_domains' },
      });
      expect(result).toEqual([
        '*',
        'https://example.com',
        'https://test.com',
        'https://another.com',
      ]);
    });

    it('should return the config allowed cors only if no settings are found', async () => {
      jest.spyOn(settingService, 'find').mockResolvedValue([]);

      const result = await settingService.getAllowedOrigins();

      expect(settingService.find).toHaveBeenCalledWith({
        where: { label: 'allowed_domains' },
      });
      expect(result).toEqual(['*']);
    });

    it('should handle settings with empty values', async () => {
      const mockSettings = [
        makeSetting({ label: 'allowed_domains', value: '' }),
        makeSetting({
          label: 'allowed_domains',
          value: 'https://example.com',
        }),
      ];

      jest.spyOn(settingService, 'find').mockResolvedValue(mockSettings);

      const result = await settingService.getAllowedOrigins();

      expect(settingService.find).toHaveBeenCalledWith({
        where: { label: 'allowed_domains' },
      });
      expect(result).toEqual(['*', 'https://example.com']);
    });
  });

  describe('emitSettingEvents', () => {
    it('should emit hook:${group}:${label} event with setting payload when entity exists', async () => {
      const eventEmitter = settingRepository.getEventEmitter();
      expect(eventEmitter).toBeDefined();

      const emitSpy = jest.spyOn(eventEmitter!, 'emit');
      const setting = makeSetting({
        group: 'global_settings',
        label: 'locale',
        value: 'en',
      });
      const event = {
        entity: {
          toPlainCls: () => setting,
        },
      } as any;

      await settingService.emitSettingEvents(event);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(
        'hook:global_settings:locale',
        setting,
      );
    });

    it('should not emit any event when entity is missing', async () => {
      const eventEmitter = settingRepository.getEventEmitter();
      expect(eventEmitter).toBeDefined();

      const emitSpy = jest.spyOn(eventEmitter!, 'emit');

      await settingService.emitSettingEvents({} as any);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('updateOne', () => {
    it('accepts valid values for registered settings schema', async () => {
      const setting = (await settingService.findOne({
        where: { label: 'contact_email_recipient' },
      })) as Setting;
      const result = await settingService.updateOne(setting.id, {
        value: 'security@example.com',
      });

      expect(result.value).toBe('security@example.com');
    });

    it('coerces numeric string values before persisting', async () => {
      const group = 'coercion_settings';
      const schema = z.strictObject({
        threshold: z.number().int().default(3).meta({
          title: 'Threshold',
        }),
      });
      runtimeSettingsService.register({
        group,
        schema,
        scope: 'extension',
      });
      const setting = await settingRepository.create({
        group,
        label: 'threshold',
        value: 3,
      });
      createdIds.push(setting.id);

      const updated = await settingService.updateOne(setting.id, {
        value: '42' as unknown as number,
      });

      expect(updated.value).toBe(42);
    });

    it('coerces boolean string values before persisting', async () => {
      const group = 'feature_flags';
      const schema = z.strictObject({
        enabled: z.boolean().default(false).meta({ title: 'Enabled' }),
      });
      runtimeSettingsService.register({
        group,
        schema,
        scope: 'extension',
      });
      const setting = await settingRepository.create({
        group,
        label: 'enabled',
        value: false,
      });
      createdIds.push(setting.id);

      const updated = await settingService.updateOne(setting.id, {
        value: 'true' as unknown as boolean,
      });

      expect(updated.value).toBe(true);
    });

    it('rejects invalid values against runtime schema', async () => {
      const group = 'limits';
      const schema = z.strictObject({
        retries: z.number().int().min(0).default(1).meta({ title: 'Retries' }),
      });
      runtimeSettingsService.register({
        group,
        schema,
        scope: 'extension',
      });
      const setting = await settingRepository.create({
        group,
        label: 'retries',
        value: 1,
      });
      createdIds.push(setting.id);

      await expect(
        settingService.updateOne(setting.id, {
          value: 'invalid' as unknown as number,
        }),
      ).rejects.toThrow('Invalid value provided for setting "limits.retries".');
    });
  });
});

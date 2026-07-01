/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Setting } from '@hexabot-ai/types';
import { I18nContext } from 'nestjs-i18n';

import { I18nService } from '@/i18n/services/i18n.service';
import {
  installSettingFixturesTypeOrm,
  settingFixtures,
} from '@/utils/test/fixtures/setting';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import { buildTestingMocks } from '@/utils/test/utils';

import {
  CONTACT_SETTINGS_GROUP,
  contactSettingsSchema,
} from '../default.settings';
import { RuntimeSettingsService } from '../services/runtime-settings.service';
import { SettingService } from '../services/setting.service';

import { SettingController } from './setting.controller';

const expectedSettings = settingFixtures.map((setting) => ({
  ...setting,
  subgroup: setting.subgroup || null,
}));

describe('SettingController', () => {
  let settingController: SettingController;
  let settingService: SettingService;
  let runtimeSettingsService: RuntimeSettingsService;
  let i18nService: I18nService<unknown>;

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [SettingController],
      providers: [I18nServiceProvider],
      typeorm: {
        fixtures: installSettingFixturesTypeOrm,
      },
    });
    [settingController, settingService, runtimeSettingsService, i18nService] =
      await getMocks([
        SettingController,
        SettingService,
        RuntimeSettingsService,
        I18nService,
      ]);
  });
  beforeEach(() => {
    runtimeSettingsService.reset();
    runtimeSettingsService.register({
      group: CONTACT_SETTINGS_GROUP,
      schema: contactSettingsSchema,
      scope: 'global',
    });
  });

  afterEach(jest.clearAllMocks);

  describe('findSchemas', () => {
    beforeEach(() => {
      (i18nService.t as jest.Mock).mockImplementation(
        (key: string, options?: { defaultValue?: string }) => {
          return options?.defaultValue ?? key;
        },
      );
    });

    it('returns runtime settings schema definitions', () => {
      const getAllSchemaDefinitionsSpy = jest.spyOn(
        settingService,
        'getAllSchemaDefinitions',
      );
      const result = settingController.findSchemas();

      expect(getAllSchemaDefinitionsSpy).toHaveBeenCalled();
      expect(result.contact).toBeDefined();
      expect(result.contact.scope).toBe('global');
      expect(result.contact.schema.$schema).toBe(
        'http://json-schema.org/draft-07/schema#',
      );
      expect((result.contact.schema as { title?: string }).title).toBe(
        'Contact',
      );
    });

    it('localizes settings schema metadata using the request language', () => {
      (i18nService.t as jest.Mock).mockImplementation(
        (
          key: string,
          options?: { ns?: string; lang?: string; defaultValue?: string },
        ) => {
          if (options?.lang === 'fr' && options?.ns === 'contact') {
            if (key === 'Contact') {
              return 'FR Contact';
            }
            if (key === 'Contact recipient email') {
              return 'FR Contact recipient email';
            }
            if (
              key === 'Email address that receives contact form submissions.'
            ) {
              return 'FR Contact recipient help';
            }
          }

          return options?.defaultValue ?? key;
        },
      );
      const currentSpy = jest
        .spyOn(I18nContext, 'current')
        .mockReturnValue({ lang: 'fr' } as unknown as I18nContext<unknown>);
      const result = settingController.findSchemas();
      const schema = result.contact.schema as
        | {
            properties?: Record<
              string,
              { title?: string; description?: string; default?: string }
            >;
          }
        | undefined;

      expect(schema?.properties?.contact_email_recipient?.title).toBe(
        'FR Contact recipient email',
      );
      expect(schema?.properties?.contact_email_recipient?.description).toBe(
        'FR Contact recipient help',
      );
      expect(schema?.properties?.contact_email_recipient?.default).toBe(
        'admin@example.com',
      );
      expect((result.contact.schema as { title?: string }).title).toBe(
        'FR Contact',
      );

      currentSpy.mockRestore();
    });

    it('falls back to original schema metadata when translation is missing', () => {
      const currentSpy = jest
        .spyOn(I18nContext, 'current')
        .mockReturnValue({ lang: 'fr' } as unknown as I18nContext<unknown>);
      const result = settingController.findSchemas();
      const schema = result.contact.schema as
        | {
            properties?: Record<
              string,
              { title?: string; description?: string }
            >;
          }
        | undefined;

      expect(schema?.properties?.company_name?.title).toBe('Company name');
      expect(schema?.properties?.company_name?.description).toBe(
        'Company name displayed to end users.',
      );
      expect((result.contact.schema as { title?: string }).title).toBe(
        'Contact',
      );

      currentSpy.mockRestore();
    });
  });

  describe('find', () => {
    it('Should return an array of ordered Settings by group ', async () => {
      jest.spyOn(settingService, 'find');
      const options = {
        where: {},
      };
      const result = await settingController.findPage(options);

      expect(settingService.find).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload(expectedSettings, [
        'id',
        'createdAt',
        'updatedAt',
      ]);
    });
  });

  describe('updateOne', () => {
    it('Should update and return a specific Setting', async () => {
      jest.spyOn(settingService, 'updateOne');
      const payload = {
        value: 'updated setting value',
      };
      const { id } = (await settingService.findOne({
        where: { label: 'contact_email_recipient' },
      })) as Setting;
      const result = await settingController.updateOne(id, payload);

      expect(settingService.updateOne).toHaveBeenCalledWith(id, payload);
      expect(result).toEqualPayload(
        {
          ...expectedSettings.find(
            (settingFixture) =>
              settingFixture.label === 'contact_email_recipient',
          ),
          value: payload.value,
        },
        ['id', 'createdAt', 'updatedAt'],
      );
    });

    it('Should validate value against runtime schema before update', async () => {
      const setting = (await settingService.findOne({
        where: { label: 'contact_email_recipient' },
      })) as Setting;

      await expect(
        settingController.updateOne(setting.id, { value: 123 as any }),
      ).rejects.toThrow(
        'Invalid value provided for setting "contact.contact_email_recipient".',
      );
    });
  });
});

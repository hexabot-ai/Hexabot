/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import { I18nService } from '@/i18n/services/i18n.service';

import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';

describe('ChannelController', () => {
  it('returns channel visibility with localized settings metadata', () => {
    const webSettingsSchema = z.strictObject({
      enabled: z.boolean().default(true),
    });
    const consoleSettingsSchema = z.strictObject({});
    const channelService = {
      getAll: jest.fn().mockReturnValue([
        {
          getName: jest.fn().mockReturnValue('web'),
          getVisibility: jest.fn().mockReturnValue('public'),
          getSourceSettingsSchema: jest.fn().mockReturnValue(webSettingsSchema),
        },
        {
          getName: jest.fn().mockReturnValue('console'),
          getVisibility: jest.fn().mockReturnValue('system'),
          getSourceSettingsSchema: jest
            .fn()
            .mockReturnValue(consoleSettingsSchema),
        },
      ]),
    };
    const i18nService = {
      getJsonSchemaLocalizationOptions: jest.fn().mockReturnValue(undefined),
    };
    const controller = new ChannelController(
      channelService as unknown as ChannelService,
      i18nService as unknown as I18nService,
    );
    const channels = controller.getChannels();

    expect(channels).toEqual([
      expect.objectContaining({
        name: 'web',
        visibility: 'public',
        settingsSchema: expect.objectContaining({
          type: 'object',
        }),
      }),
      expect.objectContaining({
        name: 'console',
        visibility: 'system',
        settingsSchema: expect.objectContaining({
          type: 'object',
        }),
      }),
    ]);
    expect(i18nService.getJsonSchemaLocalizationOptions).toHaveBeenCalledWith(
      'web',
      undefined,
    );
  });
});

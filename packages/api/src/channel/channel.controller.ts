/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ChannelMetadata } from '@hexabot-ai/types';
import { Controller, Get } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';

import { I18nService } from '@/i18n/services/i18n.service';
import { toDraft07JsonSchema } from '@/utils/helpers/zod';

import { ChannelService } from './channel.service';

@Controller('channel')
export class ChannelController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly i18nService: I18nService,
  ) {}

  /**
   * Retrieves the list of channels.
   *
   * @returns An array of objects where each object represents a channel with a `name` property.
   */
  @Get()
  getChannels(): ChannelMetadata[] {
    const lang = I18nContext.current()?.lang;

    return this.channelService.getAll().map((handler) => {
      const channelName = handler.getName();

      return {
        name: channelName,
        visibility: handler.getVisibility(),
        settingsSchema: toDraft07JsonSchema(
          handler.getSourceSettingsSchema(),
          this.i18nService.getJsonSchemaLocalizationOptions(channelName, lang),
        ) as Record<string, unknown>,
      };
    });
  }
}

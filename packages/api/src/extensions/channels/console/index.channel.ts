/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';

import BaseWebChannelHandler from '../web/base-web-channel';

import {
  CONSOLE_CHANNEL_NAME,
  CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA,
} from './settings.schema';

@Injectable()
export default class ConsoleChannelHandler extends BaseWebChannelHandler<
  typeof CONSOLE_CHANNEL_NAME
> {
  constructor() {
    super(
      CONSOLE_CHANNEL_NAME,
      CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA,
      'system',
    );
  }
}

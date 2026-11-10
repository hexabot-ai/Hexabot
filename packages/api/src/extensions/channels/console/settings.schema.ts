/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA } from '../web/settings.schema';

export const CONSOLE_CHANNEL_NAME = 'console' as const;

// The web widget settings that apply to the admin chat console.
export const CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA =
  WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA.pick({
    allowed_domains: true,
    input_disabled: true,
    persistent_menu: true,
    show_emoji: true,
    show_file: true,
    show_location: true,
    allowed_upload_types: true,
    thread_inactivity_hours: true,
  }).meta({
    title: 'Admin Chat Console',
  });

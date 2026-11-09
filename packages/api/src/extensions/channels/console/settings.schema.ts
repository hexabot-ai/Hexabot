/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import { config } from '@/config';

import { WEB_ALLOWED_UPLOAD_TYPES } from '../web/settings.schema';

export const CONSOLE_CHANNEL_NAME = 'console' as const;

export const CONSOLE_CHANNEL_SOURCE_SETTINGS_SCHEMA = z
  .strictObject({
    allowed_domains: z
      .string()
      .default(config.security.cors.allowOrigins.join(','))
      .meta({
        title: 'Allowed domains',
        description: 'Comma-separated list of allowed CORS origins.',
      }),
    input_disabled: z.boolean().default(false).meta({
      title: 'Disable input',
      description: 'Disable the user input field in the chat widget.',
    }),
    persistent_menu: z.boolean().default(true).meta({
      title: 'Persistent menu',
      description: 'Keep the menu visible in the chat interface.',
    }),
    show_emoji: z.boolean().default(true).meta({
      title: 'Show emoji',
      description: 'Enable emoji picker in the chat interface.',
    }),
    show_file: z.boolean().default(true).meta({
      title: 'Show file upload',
      description: 'Enable file upload action in the chat interface.',
    }),
    show_location: z.boolean().default(true).meta({
      title: 'Show location',
      description: 'Enable location sharing action in the chat interface.',
    }),
    allowed_upload_types: z.string().default(WEB_ALLOWED_UPLOAD_TYPES).meta({
      title: 'Allowed upload types',
      description: 'Comma-separated MIME types accepted by the upload input.',
      'ui:widget': 'textarea',
    }),
    thread_inactivity_hours: z.int().nonnegative().default(24).meta({
      title: 'Thread inactivity (hours)',
      description:
        'Automatically start a new thread when the last message is older than this threshold.',
    }),
  })
  .meta({
    title: 'Admin Chat Console',
  });

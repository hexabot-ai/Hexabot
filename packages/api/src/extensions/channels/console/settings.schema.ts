/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import { config } from '@/config';

export const CONSOLE_CHANNEL_NAME = 'console' as const;

const CONSOLE_ALLOWED_UPLOAD_TYPES =
  'audio/mpeg,audio/x-ms-wma,audio/vnd.rn-realaudio,audio/x-wav,image/gif,image/jpeg,image/png,image/tiff,image/vnd.microsoft.icon,image/vnd.djvu,image/svg+xml,text/css,text/csv,text/html,text/plain,text/xml,video/mpeg,video/mp4,video/quicktime,video/x-ms-wmv,video/x-msvideo,video/x-flv,video/web,application/msword,application/vnd.ms-powerpoint,application/pdf,application/vnd.ms-excel,application/vnd.oasis.opendocument.presentation,application/vnd.oasis.opendocument.tex,application/vnd.oasis.opendocument.spreadsheet,application/vnd.oasis.opendocument.graphics,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
    allowed_upload_types: z
      .string()
      .default(CONSOLE_ALLOWED_UPLOAD_TYPES)
      .meta({
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

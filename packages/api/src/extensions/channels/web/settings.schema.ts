/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import { config } from '@/config';

export const WEB_CHANNEL_NAME = 'web' as const;

const WEB_ALLOWED_UPLOAD_TYPES =
  'audio/mpeg,audio/x-ms-wma,audio/vnd.rn-realaudio,audio/x-wav,image/gif,image/jpeg,image/png,image/tiff,image/vnd.microsoft.icon,image/vnd.djvu,image/svg+xml,text/css,text/csv,text/html,text/plain,text/xml,video/mpeg,video/mp4,video/quicktime,video/x-ms-wmv,video/x-msvideo,video/x-flv,video/web,application/msword,application/vnd.ms-powerpoint,application/pdf,application/vnd.ms-excel,application/vnd.oasis.opendocument.presentation,application/vnd.oasis.opendocument.tex,application/vnd.oasis.opendocument.spreadsheet,application/vnd.oasis.opendocument.graphics,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const WEB_CHANNEL_SOURCE_SETTINGS_SCHEMA = z
  .strictObject({
    allowed_domains: z
      .string()
      .default(config.security.cors.allowOrigins.join(','))
      .meta({
        title: 'Allowed domains',
        description: 'Comma-separated list of allowed CORS origins.',
      }),
    start_button: z.boolean().default(true).meta({
      title: 'Show start button',
      description: 'Display the start button before chat begins.',
    }),
    input_disabled: z.boolean().default(false).meta({
      title: 'Disable input',
      description: 'Disable the user input field in the chat widget.',
    }),
    persistent_menu: z.boolean().default(true).meta({
      title: 'Persistent menu',
      description: 'Keep the menu visible in the chat interface.',
    }),
    greeting_message: z
      .string()
      .default('Welcome! Ready to start chatting with our chatbot?')
      .meta({
        title: 'Greeting message',
        description: 'Greeting shown to users when the conversation starts.',
        'ui:widget': 'textarea',
      }),
    window_title: z.string().default('Widget Title').meta({
      title: 'Window title',
      description: 'Title displayed in the web widget header.',
    }),
    avatar_url: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default('')
      .optional()
      .meta({
        title: 'Avatar URL',
        description: 'URL of the chatbot avatar image.',
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
    title: 'Web Channel',
  });

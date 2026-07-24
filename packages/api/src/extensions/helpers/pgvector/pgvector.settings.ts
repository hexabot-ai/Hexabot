/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import { createSettingGroup } from '@/setting/create-setting-group';

import { vercelAiSdkProviders } from '../../actions/ai/provider.constants';

export const PGVECTOR_RAG_HELPER_NAME = 'pgvector' as const;

export const pgvectorSettingsSchema = z
  .strictObject({
    embedding_provider: z.enum(vercelAiSdkProviders).default('openai').meta({
      title: 'Provider',
      description:
        'Vercel AI SDK provider used to generate embeddings. The matching provider package must be installed.',
    }),
    embedding_model: z.string().min(1).default('text-embedding-3-small').meta({
      title: 'Embedding model',
      description: 'Provider model identifier used for indexing and retrieval.',
    }),
    embedding_api_key: z
      .string()
      .default('')
      .meta({
        title: 'Credential',
        description: 'Credential containing the provider API key.',
        'ui:widget': 'AutoCompleteWidget',
        'ui:options': {
          entity: 'Credential',
          valueKey: 'id',
          labelKey: 'name',
          enableEntityAddButton: true,
        },
      }),
    embedding_base_url: z
      .string()
      .refine((value) => value === '' || z.url().safeParse(value).success, {
        error: 'Must be a valid URL or empty.',
      })
      .default('')
      .meta({
        title: 'Embedding base URL',
        description:
          'Optional base URL for providers that support a custom endpoint.',
        'ui:options': {
          showWhen: {
            field: 'embedding_provider',
            in: ['gateway', 'litellm'],
          },
        },
      }),
    embedding_dimensions: z
      .number()
      .int()
      .min(1)
      .max(16000)
      .default(1536)
      .meta({
        title: 'Embedding dimensions',
        description:
          "Requested embedding size for providers that support dimension reduction (e.g. OpenAI). Other providers ignore it and use the model's native dimension.",
        'ui:options': {
          step: 1,
        },
      }),
    chunk_size: z
      .number()
      .int()
      .min(100)
      .max(20000)
      .default(2000)
      .meta({
        title: 'Chunk size',
        description: 'Maximum chunk size in characters.',
        'ui:options': {
          step: 100,
        },
      }),
    chunk_overlap: z
      .number()
      .int()
      .min(0)
      .max(1999)
      .default(200)
      .meta({
        title: 'Chunk overlap',
        description: 'Number of source characters repeated between chunks.',
        'ui:options': {
          step: 10,
        },
      }),
    index_only_active_content: z.boolean().default(true).meta({
      title: 'Index only active content',
      description:
        'Embed only active content. When enabled, inactive (unpublished) entries are never sent to the embedding provider and are kept out of the index.',
    }),
  })
  .superRefine((settings, context) => {
    if (settings.chunk_overlap >= settings.chunk_size) {
      context.addIssue({
        code: 'custom',
        message: 'Chunk overlap must be smaller than chunk size.',
        path: ['chunk_overlap'],
      });
    }
  })
  .meta({
    title: 'pgvector RAG',
  });

declare global {
  interface RuntimeSettingRegistry {
    [PGVECTOR_RAG_HELPER_NAME]: typeof pgvectorSettingsSchema;
  }
}

export const PgvectorSettingsGroup = createSettingGroup({
  group: PGVECTOR_RAG_HELPER_NAME,
  schema: pgvectorSettingsSchema,
  scope: 'extension',
  extensionType: 'helper',
  extensionName: PGVECTOR_RAG_HELPER_NAME,
});

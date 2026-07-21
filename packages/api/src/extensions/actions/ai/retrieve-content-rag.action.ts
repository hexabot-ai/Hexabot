/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { createAction } from '@/actions/create-action';
import {
  RagEmbeddingNotConfiguredError,
  RagMode,
  RagQueryOptions,
} from '@/cms';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import { workflowResourceRef } from '@/workflow/resource-refs';

const contentRagModeSchema = z.enum(['embedding', 'lexical']);
const retrieveRagContentInputSchema = z.strictObject({
  query: z.string().trim().min(1).meta({
    title: 'Query',
    description: 'Query used to retrieve CMS content through RAG.',
  }),
});
const retrieveRagContentSettingsSchema = z.strictObject({
  mode: contentRagModeSchema.optional().meta({
    title: 'Mode',
    description: 'Retrieval mode used to search indexed content.',
  }),
  limit: z.int().min(1).optional().meta({
    title: 'Limit',
    description: 'Maximum number of content hits to return.',
  }),
  content_type_id: z
    .string()
    .optional()
    .meta({
      title: 'Content Type',
      description: 'Optional content type filter for retrieval.',
      'ui:widget': 'AutoCompleteWidget',
      'ui:options': {
        entity: 'ContentType',
        valueKey: 'id',
        labelKey: 'name',
      },
      ...workflowResourceRef('contentType'),
    }),
  include_inactive: z.boolean().default(false).meta({
    title: 'Include inactive',
    description:
      'When enabled, retrieval can include inactive content in results.',
  }),
});
const contentRagHitSchema = z.strictObject({
  contentId: z.string(),
  title: z.string(),
  text: z.string(),
  score: z.number().optional(),
  contentTypeId: z.string().optional(),
  source: contentRagModeSchema,
});
const retrieveRagContentOutputSchema = z.strictObject({
  hits: z.array(contentRagHitSchema),
  text: z.string(),
  warning: z.string().optional().meta({
    title: 'Warning',
    description:
      'Warning explaining why retrieval was skipped (e.g. RAG disabled or embedding not configured).',
  }),
});

type RetrieveRagContentInput = z.infer<typeof retrieveRagContentInputSchema>;
type RetrieveRagContentSettings = z.infer<
  typeof retrieveRagContentSettingsSchema
>;
type RetrieveRagContentOutput = z.infer<typeof retrieveRagContentOutputSchema>;

export const RetrieveRagContentAction = createAction<
  RetrieveRagContentInput,
  RetrieveRagContentOutput,
  WorkflowRuntimeContext,
  RetrieveRagContentSettings
>({
  name: 'retrieve_rag_content',
  description:
    'Retrieves RAG content from knowledge base using lexical or embedding mode for AI tool usage.',
  group: 'ai',
  color: '#b65bfd',
  icon: 'Search',
  inputSchema: retrieveRagContentInputSchema,
  outputSchema: retrieveRagContentOutputSchema,
  settingsSchema: retrieveRagContentSettingsSchema,
  async execute({ input, context, settings }) {
    const { content, contentType, logger } = context.services;

    if (!content || !contentType) {
      throw new Error(
        'Content RAG services are missing from the workflow context.',
      );
    }

    if (!(await content.isRagEnabled())) {
      const warning =
        'RAG is disabled. Enable it in Settings > RAG (rag_settings.enabled) to retrieve content.';
      logger?.warn(`retrieve_rag_content: ${warning}`);

      return { hits: [], text: '', warning };
    }

    const contentTypeId = settings.content_type_id?.trim();
    if (contentTypeId) {
      const foundContentType = await contentType.findOne(contentTypeId);
      if (!foundContentType) {
        throw new Error(`Content type with id "${contentTypeId}" not found`);
      }
    }

    const options: RagQueryOptions = {
      ...(settings.mode ? { mode: settings.mode as RagMode } : {}),
      ...(settings.limit ? { limit: settings.limit } : {}),
      ...(contentTypeId ? { contentTypeId } : {}),
      includeInactive: settings.include_inactive ?? false,
    };

    try {
      const hits = await content.retrieve(input.query, options);

      return { hits, text: hits.map(({ text }) => text).join('\n\n') };
    } catch (error) {
      if (error instanceof RagEmbeddingNotConfiguredError) {
        const warning = `RAG embedding retrieval is not configured: ${error.message} You can also switch this action to lexical mode.`;
        logger?.warn(`retrieve_rag_content: ${warning}`);

        return { hits: [], text: '', warning };
      }

      throw error;
    }
  },
});

export default RetrieveRagContentAction;

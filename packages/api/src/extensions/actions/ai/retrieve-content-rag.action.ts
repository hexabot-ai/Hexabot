/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { createAction } from '@/actions/create-action';
import {
  RagHelperConfigurationError,
  RagHelperUnavailableError,
  RagHit,
  RagRetrieveOptions,
  removeQueryTerms,
} from '@/cms';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import { workflowResourceRef } from '@/workflow/resource-refs';

const legacyRagModeSchema = z.enum(['embedding', 'lexical']);
const retrieveRagContentInputSchema = z.strictObject({
  query: z.string().trim().min(1).meta({
    title: 'Query',
    description: 'Query used to retrieve CMS content through RAG.',
  }),
});
const retrieveRagContentSettingsSchema = z.strictObject({
  mode: legacyRagModeSchema.optional().meta({
    title: 'Legacy RAG mode',
    description:
      'Deprecated compatibility field. The configured default RAG helper is always used.',
    'ui:widget': 'hidden',
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
  include_properties: z.array(z.string().trim().min(1)).optional().meta({
    title: 'Include properties',
    description:
      'Content property keys (e.g. url) to attach to each hit and prepend to its text.',
  }),
  excluded_terms: z.array(z.string().trim().min(1)).optional().meta({
    title: 'Excluded terms',
    description:
      'Words or phrases removed from the query before retrieval, such as a brand name that every page repeats. Matching ignores case and only matches whole words.',
  }),
  preserved_phrases: z.array(z.string().trim().min(1)).optional().meta({
    title: 'Preserved phrases',
    description:
      'Phrases kept in the query even when they contain an excluded term, such as a product name that includes the brand.',
  }),
});
const contentRagHitSchema = z.strictObject({
  contentId: z.string(),
  title: z.string(),
  text: z.string(),
  score: z.number().optional(),
  contentTypeId: z.string().optional(),
  source: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
const retrieveRagContentOutputSchema = z.strictObject({
  hits: z.array(contentRagHitSchema),
  text: z.string(),
  warning: z.string().optional().meta({
    title: 'Warning',
    description: 'Warning explaining why retrieval returned no results.',
  }),
  query_used: z.string().optional().meta({
    title: 'Query used',
    description:
      'Query sent to the RAG helper once the excluded terms are removed. Set when excluded terms are configured.',
  }),
  removed_terms: z.array(z.string()).optional().meta({
    title: 'Removed terms',
    description:
      'Excluded terms that were removed from the query. Set when excluded terms are configured.',
  }),
});

type RetrieveRagContentInput = z.infer<typeof retrieveRagContentInputSchema>;
type RetrieveRagContentSettings = z.infer<
  typeof retrieveRagContentSettingsSchema
>;
type RetrieveRagContentOutput = z.infer<typeof retrieveRagContentOutputSchema>;

/**
 * Formats a hit for the joined `text` output: its attached properties as
 * `key: value` lines, then its text. Lines the text already holds are skipped,
 * since helpers that return the whole content text already list them.
 */
const formatHitText = ({ text, properties }: RagHit): string => {
  const lines = Object.entries(properties ?? {})
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    )
    .filter((line) => !text.includes(line));

  return [...lines, text].join('\n');
};

export const RetrieveRagContentAction = createAction<
  RetrieveRagContentInput,
  RetrieveRagContentOutput,
  WorkflowRuntimeContext,
  RetrieveRagContentSettings
>({
  name: 'retrieve_rag_content',
  description:
    'Retrieves relevant knowledge base content using the configured RAG helper for AI tool usage.',
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

    const contentTypeId = settings.content_type_id?.trim();
    if (contentTypeId) {
      const foundContentType = await contentType.findOne(contentTypeId);
      if (!foundContentType) {
        throw new Error(`Content type with id "${contentTypeId}" not found`);
      }
    }

    const excludedTerms = settings.excluded_terms ?? [];
    const { query, removedTerms } = removeQueryTerms(input.query, {
      excludedTerms,
      preservedPhrases: settings.preserved_phrases,
    });
    // Reported only when configured, so a tool result stays unchanged otherwise.
    const filtering = excludedTerms.length
      ? { query_used: query, removed_terms: removedTerms }
      : {};
    const properties = settings.include_properties ?? [];
    const options: RagRetrieveOptions = {
      ...(settings.limit ? { limit: settings.limit } : {}),
      ...(contentTypeId ? { contentTypeId } : {}),
      includeInactive: settings.include_inactive ?? false,
      ...(properties.length ? { properties } : {}),
    };
    try {
      const hits = await content.retrieve(query, options);

      return { hits, text: hits.map(formatHitText).join('\n\n'), ...filtering };
    } catch (error) {
      if (
        error instanceof RagHelperConfigurationError ||
        error instanceof RagHelperUnavailableError
      ) {
        const warning = error.message;
        logger?.warn(`retrieve_rag_content: ${warning}`);

        return { hits: [], text: '', warning, ...filtering };
      }

      throw error;
    }
  },
});

export default RetrieveRagContentAction;

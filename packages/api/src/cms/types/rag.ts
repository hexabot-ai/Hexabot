/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

/**
 * Fallback number of hits a RAG helper returns when a caller does not pass an
 * explicit `limit`. Callers that need a different count set it per request — the
 * `retrieve_rag_content` workflow action and the CMS MCP tool both expose their
 * own `limit` — so this is only the default for the unconfigured case.
 */
export const DEFAULT_RAG_TOP_K = 3;

export interface RagQueryOptions {
  limit?: number;
  contentTypeId?: string;
  includeInactive?: boolean;
}

/**
 * Options accepted by `ContentService.retrieve`. Only the `RagQueryOptions`
 * part reaches the RAG helper; the rest is applied to the hits it returns.
 */
export interface RagRetrieveOptions extends RagQueryOptions {
  /** Content property keys to attach to each hit (e.g. `url`). */
  properties?: string[];
}

export interface RagHit {
  contentId: string;
  title: string;
  text: string;
  score?: number;
  contentTypeId?: string;
  /** Name of the RAG helper that produced this hit. */
  source: string;
  /**
   * Selected content properties, attached by `ContentService.retrieve` when
   * requested. Helpers do not set it.
   */
  properties?: Record<string, unknown>;
}

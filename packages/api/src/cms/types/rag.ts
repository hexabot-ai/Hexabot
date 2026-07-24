/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export interface RagQueryOptions {
  limit?: number;
  contentTypeId?: string;
  includeInactive?: boolean;
}

export interface RagHit {
  contentId: string;
  title: string;
  text: string;
  score?: number;
  contentTypeId?: string;
  /** Name of the RAG helper that produced this hit. */
  source: string;
}

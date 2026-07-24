/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ContentFull } from '@hexabot-ai/types';

import type { RagHit, RagQueryOptions } from '@/cms/types/rag';

import { HelperName, HelperType } from '../types';

import BaseHelper from './base-helper';

/**
 * Base class for Retrieval-Augmented Generation (RAG) helpers.
 *
 * The read contract (`retrieve`) is required — it is the only thing a
 * retrieval-only helper (e.g. the built-in DB-native full-text helper) needs
 * to implement, since its search corpus is the live database.
 *
 * The write hooks (`index`, `remove`, `reindex`) are optional. They are useful
 * for helpers that maintain an external index. CMS lifecycle forwarding is
 * deliberately best-effort: helpers that require durable consistency should
 * implement database change capture, an outbox, or an equivalent reconciliation
 * mechanism and use these hooks only to reduce indexing latency.
 */
export abstract class BaseRagHelper<
  N extends HelperName = HelperName,
> extends BaseHelper<N> {
  protected readonly type: HelperType = HelperType.RAG;

  constructor(name: N) {
    super(name);
  }

  /**
   * Retrieves the most relevant content for a query.
   *
   * @param query - The natural language query.
   * @param options - Optional retrieval filters (limit, content type, inactive).
   * @returns A ranked list of RAG hits.
   */
  abstract retrieve(
    query: string,
    options?: RagQueryOptions,
  ): Promise<RagHit[]>;

  /**
   * Optional best-effort notification to index a content item.
   */
  index?(content: ContentFull): Promise<void>;

  /**
   * Optional best-effort notification to remove a content item.
   */
  remove?(contentId: string): Promise<void>;

  /**
   * Optional: reconcile or rebuild the helper from the source database.
   */
  reindex?(): Promise<void>;
}

export default BaseRagHelper;

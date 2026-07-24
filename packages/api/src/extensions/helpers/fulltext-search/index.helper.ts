/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RagHit, RagQueryOptions } from '@/cms/types/rag';
import { BaseRagHelper } from '@/helper/lib/base-rag-helper';

import { FullTextSearchStore } from './fulltext-search.store';

export const FULLTEXT_SEARCH_RAG_HELPER_NAME = 'fulltext-search' as const;

/**
 * Built-in, always-on lexical RAG helper backed by the database's native
 * full-text search (Postgres `tsvector` + GIN, or SQLite FTS5). The `contents`
 * table is the search corpus, so there is no external index to synchronize and
 * therefore nothing that can drift — the helper implements only the read
 * contract (`retrieve`), plus a `reindex` used to rebuild the SQLite structures
 * on demand.
 */
@Injectable()
export default class FullTextSearchRagHelper extends BaseRagHelper<
  typeof FULLTEXT_SEARCH_RAG_HELPER_NAME
> {
  private readonly store: FullTextSearchStore;

  constructor(dataSource: DataSource) {
    super(FULLTEXT_SEARCH_RAG_HELPER_NAME);
    this.store = new FullTextSearchStore(dataSource);
  }

  public override isAvailable(): boolean {
    return ['postgres', 'better-sqlite3'].includes(this.store.databaseType);
  }

  /**
   * Retrieves the most relevant content for a query using native full-text
   * search. Defaults to active content only unless `includeInactive` is set,
   * and to `rag_settings.top_k` results unless a `limit` is provided.
   */
  async retrieve(
    query: string,
    options: RagQueryOptions = {},
  ): Promise<RagHit[]> {
    const trimmed = query?.trim();
    if (!trimmed) {
      return [];
    }

    const { rag_settings } = await this.settingService.getSettings();
    const limit = options.limit ?? rag_settings.top_k;
    const hits = await this.store.search(trimmed, {
      status: options.includeInactive ? undefined : true,
      contentTypeId: options.contentTypeId,
      limit,
    });

    return hits.map((hit) => ({
      ...hit,
      source: FULLTEXT_SEARCH_RAG_HELPER_NAME,
    }));
  }

  /**
   * Rebuilds the native full-text search structures from the database.
   */
  async reindex(): Promise<void> {
    await this.store.reindex();
  }
}

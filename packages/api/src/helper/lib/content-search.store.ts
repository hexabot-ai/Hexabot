/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource } from 'typeorm';

import { ContentOrmEntity } from '@/cms/entities/content.entity';
import { RagHit } from '@/cms/types/rag';

/** A single content search result before its producing helper is attached. */
export type ContentSearchHit = Omit<RagHit, 'source'>;

/** Common filters shared by the content search stores. */
export interface ContentSearchOptions {
  status?: boolean;
  contentTypeId?: string;
  limit?: number;
}

const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;

/** Quotes a single SQL identifier, escaping embedded double quotes. */
export const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;

/** Quotes a dotted table path (e.g. `schema.table`) segment by segment. */
export const quoteTablePath = (path: string): string =>
  path.split('.').map(quoteIdentifier).join('.');

/**
 * Shared persistence boundary for the content-backed RAG search stores.
 *
 * Centralizes the content entity metadata resolution, identifier quoting,
 * limit normalization, and row mapping that both the pgvector and full-text
 * stores would otherwise duplicate. Subclasses own their query construction.
 */
export abstract class ContentSearchStore {
  constructor(protected readonly dataSource: DataSource) {}

  protected get metadata() {
    return this.dataSource.getMetadata(ContentOrmEntity);
  }

  /** Fully-quoted path to the live content table. */
  protected get contentTable(): string {
    return quoteTablePath(this.metadata.tablePath);
  }

  protected columnName(propertyName: keyof ContentOrmEntity & string): string {
    const column = this.metadata.findColumnWithPropertyName(propertyName);
    if (!column) {
      throw new Error(
        `Unable to resolve database column for property "${propertyName}".`,
      );
    }

    return column.databaseName;
  }

  protected get contentTypeColumnName(): string {
    const relation = this.metadata.findRelationWithPropertyPath('contentType');
    const joinColumn = relation?.joinColumns?.[0];
    if (!joinColumn) {
      throw new Error('Unable to resolve the content type foreign key column.');
    }

    return joinColumn.databaseName;
  }

  protected normalizeLimit(limit?: number): number {
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      return Math.min(Math.floor(limit), MAX_SEARCH_LIMIT);
    }

    return DEFAULT_SEARCH_LIMIT;
  }

  /**
   * Maps raw query rows into hits, deriving each score with the provided
   * strategy (helpers rank on different, sometimes inverted, scales).
   */
  protected mapHits(
    rows: Array<Record<string, unknown>>,
    score: (row: Record<string, unknown>) => number | undefined,
  ): ContentSearchHit[] {
    return rows.map((row) => ({
      contentId: String(row.contentId),
      title: row.title == null ? '' : String(row.title),
      text: row.text == null ? '' : String(row.text),
      contentTypeId:
        row.contentTypeId == null ? undefined : String(row.contentTypeId),
      score: score(row),
    }));
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { RagHelperUnavailableError } from '@/cms/errors/rag.errors';
import {
  ContentSearchHit,
  ContentSearchOptions,
  ContentSearchStore,
  quoteIdentifier,
  quoteTablePath,
} from '@/helper/lib/content-search.store';

export type FullTextSearchHit = ContentSearchHit;

export type FullTextSearchOptions = ContentSearchOptions;

/**
 * Database-native lexical search owned by the full-text RAG helper.
 *
 * Schema provisioning belongs to migrations; this store only queries or
 * rebuilds already-provisioned native search structures.
 */
export class FullTextSearchStore extends ContentSearchStore {
  get databaseType(): string {
    return this.dataSource.options.type;
  }

  async search(
    query: string,
    options: FullTextSearchOptions = {},
  ): Promise<FullTextSearchHit[]> {
    if (this.databaseType === 'postgres') {
      return await this.postgresSearch(query, options);
    }
    if (this.databaseType === 'better-sqlite3') {
      return await this.sqliteSearch(query, options);
    }

    throw new RagHelperUnavailableError(
      `The fulltext-search RAG helper does not support database "${this.databaseType}".`,
    );
  }

  async reindex(): Promise<void> {
    if (this.databaseType === 'postgres') {
      await this.dataSource.query(
        `REINDEX INDEX ${quoteTablePath(
          this.metadata.schema
            ? `${this.metadata.schema}.${this.metadata.tableName}_fts_idx`
            : `${this.metadata.tableName}_fts_idx`,
        )}`,
      );

      return;
    }
    if (this.databaseType !== 'better-sqlite3') {
      throw new RagHelperUnavailableError(
        `The fulltext-search RAG helper does not support database "${this.databaseType}".`,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const table = this.contentTable;
      const ftsTable = quoteIdentifier(`${this.metadata.tableName}_fts`);
      const idColumn = quoteIdentifier(this.columnName('id'));
      const textColumn = quoteIdentifier(this.columnName('searchText'));

      await queryRunner.query(`DELETE FROM ${ftsTable}`);
      await queryRunner.query(
        `INSERT INTO ${ftsTable}(${idColumn}, ${textColumn}) ` +
          `SELECT ${idColumn}, ${textColumn} FROM ${table}`,
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async postgresSearch(
    query: string,
    options: FullTextSearchOptions,
  ): Promise<FullTextSearchHit[]> {
    const table = this.contentTable;
    const idColumn = quoteIdentifier(this.columnName('id'));
    const titleColumn = quoteIdentifier(this.columnName('title'));
    const textColumn = quoteIdentifier(this.columnName('searchText'));
    const statusColumn = quoteIdentifier(this.columnName('status'));
    const contentTypeColumn = quoteIdentifier(this.contentTypeColumnName);
    const vector = `to_tsvector('simple', coalesce(${textColumn}, ''))`;
    const params: unknown[] = [query];
    const conditions = [`${vector} @@ websearch_to_tsquery('simple', $1)`];

    if (typeof options.status === 'boolean') {
      params.push(options.status);
      conditions.push(`${statusColumn} = $${params.length}`);
    }
    if (options.contentTypeId) {
      params.push(options.contentTypeId);
      conditions.push(`${contentTypeColumn} = $${params.length}`);
    }

    const rows = await this.dataSource.query(
      `SELECT ${idColumn} AS "contentId", ${titleColumn} AS "title", ` +
        `${textColumn} AS "text", ${contentTypeColumn} AS "contentTypeId", ` +
        `ts_rank(${vector}, websearch_to_tsquery('simple', $1)) AS "score" ` +
        `FROM ${table} WHERE ${conditions.join(' AND ')} ` +
        `ORDER BY "score" DESC LIMIT ${this.normalizeLimit(options.limit)}`,
      params,
    );

    return this.mapHits(rows, (row) =>
      row.score == null ? undefined : Number(row.score),
    );
  }

  private async sqliteSearch(
    query: string,
    options: FullTextSearchOptions,
  ): Promise<FullTextSearchHit[]> {
    const match = this.toFts5Match(query);
    if (!match) {
      return [];
    }

    const tableName = this.metadata.tableName;
    const table = this.contentTable;
    const ftsTable = quoteIdentifier(`${tableName}_fts`);
    const idColumn = quoteIdentifier(this.columnName('id'));
    const titleColumn = quoteIdentifier(this.columnName('title'));
    const textColumn = quoteIdentifier(this.columnName('searchText'));
    const statusColumn = quoteIdentifier(this.columnName('status'));
    const contentTypeColumn = quoteIdentifier(this.contentTypeColumnName);
    const params: unknown[] = [match];
    const conditions = [`${ftsTable} MATCH ?`];

    if (typeof options.status === 'boolean') {
      params.push(options.status ? 1 : 0);
      conditions.push(`content.${statusColumn} = ?`);
    }
    if (options.contentTypeId) {
      params.push(options.contentTypeId);
      conditions.push(`content.${contentTypeColumn} = ?`);
    }

    const rows = await this.dataSource.query(
      `SELECT content.${idColumn} AS "contentId", ` +
        `content.${titleColumn} AS "title", ` +
        `content.${textColumn} AS "text", ` +
        `content.${contentTypeColumn} AS "contentTypeId", ` +
        `bm25(${ftsTable}) AS "score" ` +
        `FROM ${ftsTable} JOIN ${table} content ` +
        `ON content.${idColumn} = ${ftsTable}.${idColumn} ` +
        `WHERE ${conditions.join(' AND ')} ` +
        `ORDER BY "score" ASC LIMIT ${this.normalizeLimit(options.limit)}`,
      params,
    );

    return this.mapHits(rows, (row) =>
      row.score == null ? undefined : -Number(row.score),
    );
  }

  private toFts5Match(query: string): string {
    const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];

    return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' ');
  }
}

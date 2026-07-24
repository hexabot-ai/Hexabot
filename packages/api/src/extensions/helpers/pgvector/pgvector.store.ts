/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource, QueryRunner } from 'typeorm';

import { RagHelperUnavailableError } from '@/cms/errors/rag.errors';
import {
  ContentSearchHit,
  ContentSearchOptions,
  ContentSearchStore,
  quoteIdentifier,
} from '@/helper/lib/content-search.store';

import {
  isPgvectorProvisioned,
  PGVECTOR_CHUNKS_TABLE,
  PGVECTOR_DOCUMENTS_TABLE,
  PGVECTOR_JOBS_TABLE,
  provisionPgvectorInfrastructure,
} from './pgvector.provisioning';

export {
  PGVECTOR_CHUNKS_TABLE,
  PGVECTOR_DOCUMENTS_TABLE,
  PGVECTOR_JOBS_TABLE,
} from './pgvector.provisioning';

const MAX_ERROR_LENGTH = 4000;
// Serializes concurrent auto-provisioning across app instances/workers so that
// only one connection runs the (idempotent) DDL at a time.
const PROVISION_ADVISORY_LOCK = `hashtext('hexabot_pgvector_provisioning')`;

export interface PgvectorJob {
  contentId: string;
  revision: number;
  attempts: number;
}

export interface PgvectorContent {
  id: string;
  searchText: string;
}

export interface PgvectorEmbeddedChunk {
  index: number;
  text: string;
  embedding: number[];
}

export type PgvectorSearchOptions = ContentSearchOptions;

/**
 * PostgreSQL persistence boundary for the pgvector helper.
 *
 * The schema and trigger DDL lives in {@link ./pgvector.provisioning}: the
 * v3.4.0 migration runs it best-effort at upgrade time, and this store re-runs
 * it on demand (self-heal) when the `vector` extension is installed later. The
 * store otherwise owns queue claiming, revision-guarded writes, reconciliation,
 * and exact cosine search.
 */
export class PgvectorStore extends ContentSearchStore {
  private infrastructureReady = false;

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  private helperTable(name: string): string {
    return this.metadata.schema
      ? `${quoteIdentifier(this.metadata.schema)}.${quoteIdentifier(name)}`
      : quoteIdentifier(name);
  }

  private helperRegclass(name: string): string {
    return this.metadata.schema ? `${this.metadata.schema}.${name}` : name;
  }

  async assertInfrastructure(): Promise<void> {
    if (this.dataSource.options.type !== 'postgres') {
      throw new RagHelperUnavailableError(
        'The pgvector RAG helper requires PostgreSQL.',
      );
    }
    if (this.infrastructureReady) {
      return;
    }

    if (await this.hasInfrastructure()) {
      this.infrastructureReady = true;

      return;
    }

    // v3.4.0 provisions on a best-effort basis and silently falls back to
    // lexical RAG when the `vector` extension is missing at upgrade time. Once
    // the extension is installed, self-heal here so selecting the pgvector
    // helper starts working without a manual migration re-run. The
    // provisioning DDL is idempotent and serialized by an advisory lock.
    await this.provisionInfrastructure();
    this.infrastructureReady = true;
  }

  private async hasInfrastructure(): Promise<boolean> {
    const [state] = await this.dataSource.query(
      `SELECT to_regtype('vector') IS NOT NULL AS "hasVector", ` +
        `to_regclass($1) IS NOT NULL AS "hasDocuments", ` +
        `to_regclass($2) IS NOT NULL AS "hasChunks", ` +
        `to_regclass($3) IS NOT NULL AS "hasJobs"`,
      [
        this.helperRegclass(PGVECTOR_DOCUMENTS_TABLE),
        this.helperRegclass(PGVECTOR_CHUNKS_TABLE),
        this.helperRegclass(PGVECTOR_JOBS_TABLE),
      ],
    );

    return Boolean(
      state?.hasVector &&
        state?.hasDocuments &&
        state?.hasChunks &&
        state?.hasJobs,
    );
  }

  private async provisionInfrastructure(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(
        `SELECT pg_advisory_xact_lock(${PROVISION_ADVISORY_LOCK})`,
      );
      // Re-check under the lock: another instance may have just provisioned.
      if (!(await isPgvectorProvisioned(queryRunner))) {
        await provisionPgvectorInfrastructure(queryRunner);
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const reason = error instanceof Error ? error.message : String(error);
      throw new RagHelperUnavailableError(
        'The pgvector RAG helper is unavailable. Install the PostgreSQL vector extension with sufficient database privileges so Hexabot can provision it automatically. ' +
          `Provisioning failed: ${reason}`,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async enqueueAll(): Promise<void> {
    await this.assertInfrastructure();
    const table = this.contentTable;
    const idColumn = quoteIdentifier(this.columnName('id'));

    await this.dataSource.query(
      `INSERT INTO ${this.helperTable(PGVECTOR_JOBS_TABLE)} AS job ` +
        `("content_id", "revision", "attempts", "available_at", "locked_at", "locked_by", "last_error", "updated_at") ` +
        `SELECT content.${idColumn}, 1, 0, NOW(), NULL, NULL, NULL, NOW() FROM ${table} content ` +
        `ON CONFLICT ("content_id") DO UPDATE SET ` +
        `"revision" = job."revision" + 1, ` +
        `"attempts" = 0, "available_at" = NOW(), "locked_at" = NULL, ` +
        `"locked_by" = NULL, "last_error" = NULL, "updated_at" = NOW()`,
    );
  }

  /**
   * Enqueues only rows that have neither a fresh document nor an existing job.
   * Unlike enqueueAll, this can run periodically without resetting retries.
   */
  async enqueueMissing(profile: string): Promise<void> {
    await this.assertInfrastructure();
    const table = this.contentTable;
    const idColumn = quoteIdentifier(this.columnName('id'));
    const textColumn = quoteIdentifier(this.columnName('searchText'));
    const documents = this.helperTable(PGVECTOR_DOCUMENTS_TABLE);
    const jobs = this.helperTable(PGVECTOR_JOBS_TABLE);

    await this.dataSource.query(
      `INSERT INTO ${jobs} ` +
        `("content_id", "revision", "attempts", "available_at", "updated_at") ` +
        `SELECT content.${idColumn}, 1, 0, NOW(), NOW() FROM ${table} content ` +
        `WHERE NOT EXISTS (` +
        `SELECT 1 FROM ${documents} document ` +
        `WHERE document."content_id" = content.${idColumn} ` +
        `AND document."profile" = $1 ` +
        `AND document."source_text" = content.${textColumn}` +
        `) AND NOT EXISTS (` +
        `SELECT 1 FROM ${jobs} job WHERE job."content_id" = content.${idColumn}` +
        `) ON CONFLICT ("content_id") DO NOTHING`,
      [profile],
    );
  }

  async wakePendingRetries(): Promise<void> {
    await this.assertInfrastructure();
    await this.dataSource.query(
      `UPDATE ${this.helperTable(PGVECTOR_JOBS_TABLE)} ` +
        `SET "available_at" = NOW(), "last_error" = NULL, "updated_at" = NOW() ` +
        `WHERE "locked_at" IS NULL`,
    );
  }

  async claimJobs(workerId: string, limit: number): Promise<PgvectorJob[]> {
    await this.assertInfrastructure();
    const result = await this.dataSource.query(
      `WITH available_jobs AS (` +
        `SELECT "content_id" FROM ${this.helperTable(PGVECTOR_JOBS_TABLE)} ` +
        `WHERE ("locked_at" IS NULL AND "available_at" <= NOW()) ` +
        `OR "locked_at" < NOW() - INTERVAL '5 minutes' ` +
        `ORDER BY "available_at" ASC, "updated_at" ASC ` +
        `FOR UPDATE SKIP LOCKED LIMIT $2` +
        `) UPDATE ${this.helperTable(PGVECTOR_JOBS_TABLE)} job ` +
        `SET "locked_at" = NOW(), "locked_by" = $1, "updated_at" = NOW() ` +
        `FROM available_jobs ` +
        `WHERE job."content_id" = available_jobs."content_id" ` +
        `RETURNING job."content_id" AS "contentId", ` +
        `job."revision" AS "revision", job."attempts" AS "attempts"`,
      [workerId, Math.max(1, Math.floor(limit))],
    );
    const rows = Array.isArray(result[0]) ? result[0] : result;

    return rows.map((row: Record<string, unknown>) => ({
      contentId: String(row.contentId),
      revision: Number(row.revision),
      attempts: Number(row.attempts),
    }));
  }

  async loadContent(contentId: string): Promise<PgvectorContent | undefined> {
    const table = this.contentTable;
    const idColumn = quoteIdentifier(this.columnName('id'));
    const textColumn = quoteIdentifier(this.columnName('searchText'));
    const rows = await this.dataSource.query(
      `SELECT ${idColumn} AS "id", ${textColumn} AS "searchText" ` +
        `FROM ${table} WHERE ${idColumn} = $1`,
      [contentId],
    );
    if (!rows[0]) {
      return undefined;
    }

    return {
      id: String(rows[0].id),
      searchText: String(rows[0].searchText ?? ''),
    };
  }

  /**
   * Atomically stores embeddings only when the claimed job and live source
   * revision still match. Documents from prior profiles are removed after the
   * new profile succeeds, never before.
   */
  async save(
    job: PgvectorJob,
    workerId: string,
    profile: string,
    sourceText: string,
    chunks: PgvectorEmbeddedChunk[],
  ): Promise<boolean> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const currentSource = await this.lockCurrentSource(
        queryRunner,
        job.contentId,
      );
      const currentJob = await this.lockCurrentJob(queryRunner, job.contentId);
      if (
        currentSource !== sourceText ||
        currentJob?.revision !== job.revision ||
        currentJob?.workerId !== workerId
      ) {
        await queryRunner.commitTransaction();

        return false;
      }

      const documents = this.helperTable(PGVECTOR_DOCUMENTS_TABLE);
      const chunkTable = this.helperTable(PGVECTOR_CHUNKS_TABLE);
      await queryRunner.query(
        `DELETE FROM ${documents} WHERE "content_id" = $1 AND "profile" = $2`,
        [job.contentId, profile],
      );
      await queryRunner.query(
        `INSERT INTO ${documents} ` +
          `("content_id", "profile", "source_text", "created_at", "updated_at") ` +
          `VALUES ($1, $2, $3, NOW(), NOW())`,
        [job.contentId, profile, sourceText],
      );

      for (const chunk of chunks) {
        await queryRunner.query(
          `INSERT INTO ${chunkTable} ` +
            `("content_id", "profile", "chunk_index", "chunk_text", "embedding") ` +
            `VALUES ($1, $2, $3, $4, $5::vector)`,
          [
            job.contentId,
            profile,
            chunk.index,
            chunk.text,
            JSON.stringify(chunk.embedding),
          ],
        );
      }

      await queryRunner.query(
        `DELETE FROM ${documents} WHERE "content_id" = $1 AND "profile" <> $2`,
        [job.contentId, profile],
      );
      await queryRunner.query(
        `DELETE FROM ${this.helperTable(PGVECTOR_JOBS_TABLE)} ` +
          `WHERE "content_id" = $1 AND "revision" = $2 AND "locked_by" = $3`,
        [job.contentId, job.revision, workerId],
      );
      await queryRunner.commitTransaction();

      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async fail(
    job: PgvectorJob,
    workerId: string,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : 'Unknown embedding error';
    await this.dataSource.query(
      `UPDATE ${this.helperTable(PGVECTOR_JOBS_TABLE)} SET ` +
        `"attempts" = "attempts" + 1, ` +
        `"available_at" = NOW() + make_interval(secs => LEAST(` +
        `900::double precision, 5 * power(2::double precision, LEAST("attempts", 20))` +
        `)), "locked_at" = NULL, "locked_by" = NULL, ` +
        `"last_error" = $4, "updated_at" = NOW() ` +
        `WHERE "content_id" = $1 AND "revision" = $2 AND "locked_by" = $3`,
      [
        job.contentId,
        job.revision,
        workerId,
        message.slice(0, MAX_ERROR_LENGTH),
      ],
    );
  }

  async search(
    embedding: number[],
    profile: string,
    options: PgvectorSearchOptions = {},
  ): Promise<ContentSearchHit[]> {
    await this.assertInfrastructure();
    const table = this.contentTable;
    const idColumn = quoteIdentifier(this.columnName('id'));
    const titleColumn = quoteIdentifier(this.columnName('title'));
    const textColumn = quoteIdentifier(this.columnName('searchText'));
    const statusColumn = quoteIdentifier(this.columnName('status'));
    const contentTypeColumn = quoteIdentifier(this.contentTypeColumnName);
    const chunks = this.helperTable(PGVECTOR_CHUNKS_TABLE);
    const documents = this.helperTable(PGVECTOR_DOCUMENTS_TABLE);
    const params: unknown[] = [JSON.stringify(embedding), profile];
    const conditions = [
      `document."profile" = $2`,
      `document."source_text" = content.${textColumn}`,
    ];

    if (typeof options.status === 'boolean') {
      params.push(options.status);
      conditions.push(`content.${statusColumn} = $${params.length}`);
    }
    if (options.contentTypeId) {
      params.push(options.contentTypeId);
      conditions.push(`content.${contentTypeColumn} = $${params.length}`);
    }

    const rows = await this.dataSource.query(
      `SELECT "contentId", "title", "text", "contentTypeId", "score" ` +
        `FROM (` +
        `SELECT content.${idColumn} AS "contentId", ` +
        `content.${titleColumn} AS "title", chunk."chunk_text" AS "text", ` +
        `content.${contentTypeColumn} AS "contentTypeId", ` +
        `1 - (chunk."embedding" <=> $1::vector) AS "score", ` +
        `ROW_NUMBER() OVER (` +
        `PARTITION BY content.${idColumn} ` +
        `ORDER BY chunk."embedding" <=> $1::vector ASC, chunk."chunk_index" ASC` +
        `) AS "rank" ` +
        `FROM ${chunks} chunk ` +
        `INNER JOIN ${documents} document ` +
        `ON document."content_id" = chunk."content_id" ` +
        `AND document."profile" = chunk."profile" ` +
        `INNER JOIN ${table} content ` +
        `ON content.${idColumn} = document."content_id" ` +
        `WHERE ${conditions.join(' AND ')}` +
        `) ranked WHERE "rank" = 1 ` +
        `ORDER BY "score" DESC, "contentId" ASC ` +
        `LIMIT ${this.normalizeLimit(options.limit)}`,
      params,
    );

    return this.mapHits(rows, (row) =>
      row.score == null ? undefined : Number(row.score),
    );
  }

  private async lockCurrentSource(
    queryRunner: QueryRunner,
    contentId: string,
  ): Promise<string | undefined> {
    const table = this.contentTable;
    const idColumn = quoteIdentifier(this.columnName('id'));
    const textColumn = quoteIdentifier(this.columnName('searchText'));
    const rows = await queryRunner.query(
      `SELECT ${textColumn} AS "searchText" FROM ${table} ` +
        `WHERE ${idColumn} = $1 FOR UPDATE`,
      [contentId],
    );

    return rows[0] ? String(rows[0].searchText ?? '') : undefined;
  }

  private async lockCurrentJob(
    queryRunner: QueryRunner,
    contentId: string,
  ): Promise<{ revision: number; workerId?: string } | undefined> {
    const rows = await queryRunner.query(
      `SELECT "revision", "locked_by" AS "workerId" ` +
        `FROM ${this.helperTable(PGVECTOR_JOBS_TABLE)} ` +
        `WHERE "content_id" = $1 FOR UPDATE`,
      [contentId],
    );
    if (!rows[0]) {
      return undefined;
    }

    return {
      revision: Number(rows[0].revision),
      workerId: rows[0].workerId == null ? undefined : String(rows[0].workerId),
    };
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { QueryRunner } from 'typeorm';

// Schema object names and DDL for the pgvector RAG helper. This is the single
// source of truth for provisioning, imported by both the v3.4.0 migration
// (best-effort provisioning at upgrade time) and the runtime store (idempotent
// self-heal when the `vector` extension is installed later), so the two paths
// can never drift apart.
export const PGVECTOR_DOCUMENTS_TABLE = 'rag_pgvector_documents';

export const PGVECTOR_CHUNKS_TABLE = 'rag_pgvector_chunks';

export const PGVECTOR_JOBS_TABLE = 'rag_pgvector_jobs';

export const PGVECTOR_TRIGGER = 'contents_enqueue_pgvector_rag';

export const PGVECTOR_TRIGGER_FUNCTION = 'enqueue_pgvector_rag_content';

/**
 * Quotes an object name, prefixing the configured connection schema when one is
 * set so the DDL targets the right namespace under multi-tenant/test schemas.
 */
export function qualifiedName(queryRunner: QueryRunner, name: string): string {
  const schema = (queryRunner.connection.options as { schema?: string }).schema;
  const quotedName = `"${name.replace(/"/g, '""')}"`;

  return schema ? `"${schema.replace(/"/g, '""')}".${quotedName}` : quotedName;
}

/**
 * Reports whether the pgvector infrastructure is already fully in place: the
 * `vector` type/extension, the three helper tables, and the enqueue trigger.
 *
 * Used by the runtime store's self-heal to re-check under an advisory lock and
 * skip the DDL when another instance has already provisioned everything.
 */
export async function isPgvectorProvisioned(
  queryRunner: QueryRunner,
): Promise<boolean> {
  const schema = (queryRunner.connection.options as { schema?: string }).schema;
  const regclass = (name: string) => (schema ? `${schema}.${name}` : name);
  const [state] = await queryRunner.query(
    `SELECT to_regtype('vector') IS NOT NULL AS "hasVector", ` +
      `to_regclass($1) IS NOT NULL AS "hasDocuments", ` +
      `to_regclass($2) IS NOT NULL AS "hasChunks", ` +
      `to_regclass($3) IS NOT NULL AS "hasJobs", ` +
      `EXISTS (` +
      `SELECT 1 FROM pg_trigger WHERE "tgname" = $4 AND NOT "tgisinternal"` +
      `) AS "hasTrigger"`,
    [
      regclass(PGVECTOR_DOCUMENTS_TABLE),
      regclass(PGVECTOR_CHUNKS_TABLE),
      regclass(PGVECTOR_JOBS_TABLE),
      PGVECTOR_TRIGGER,
    ],
  );

  return Boolean(
    state?.hasVector &&
      state?.hasDocuments &&
      state?.hasChunks &&
      state?.hasJobs &&
      state?.hasTrigger,
  );
}

/**
 * Creates (or repairs) the entire pgvector RAG infrastructure on PostgreSQL:
 * the `vector` extension, the document/chunk/job tables, the enqueue trigger,
 * and an initial backfill of the job queue.
 *
 * Every statement is idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` /
 * `DROP TRIGGER IF EXISTS` / `ON CONFLICT DO NOTHING`), so this is safe to run
 * repeatedly. It intentionally does NOT catch errors: callers decide how to
 * react to a missing extension or insufficient privileges (fall back to lexical
 * RAG, roll back a savepoint, surface an error, ...).
 */
export async function provisionPgvectorInfrastructure(
  queryRunner: QueryRunner,
): Promise<void> {
  const contents = qualifiedName(queryRunner, 'contents');
  const documents = qualifiedName(queryRunner, PGVECTOR_DOCUMENTS_TABLE);
  const chunks = qualifiedName(queryRunner, PGVECTOR_CHUNKS_TABLE);
  const jobs = qualifiedName(queryRunner, PGVECTOR_JOBS_TABLE);
  const triggerFunction = qualifiedName(queryRunner, PGVECTOR_TRIGGER_FUNCTION);

  await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await queryRunner.query(
    `CREATE TABLE IF NOT EXISTS ${documents} (` +
      `"content_id" varchar NOT NULL, ` +
      `"profile" varchar(64) NOT NULL, ` +
      `"source_text" text NOT NULL, ` +
      `"created_at" timestamptz NOT NULL DEFAULT NOW(), ` +
      `"updated_at" timestamptz NOT NULL DEFAULT NOW(), ` +
      `PRIMARY KEY ("content_id", "profile"), ` +
      `CONSTRAINT "fk_rag_pgvector_documents_content" ` +
      `FOREIGN KEY ("content_id") REFERENCES ${contents}("id") ON DELETE CASCADE` +
      `)`,
  );
  await queryRunner.query(
    `CREATE TABLE IF NOT EXISTS ${chunks} (` +
      `"content_id" varchar NOT NULL, ` +
      `"profile" varchar(64) NOT NULL, ` +
      `"chunk_index" integer NOT NULL, ` +
      `"chunk_text" text NOT NULL, ` +
      `"embedding" vector NOT NULL, ` +
      `PRIMARY KEY ("content_id", "profile", "chunk_index"), ` +
      `CONSTRAINT "fk_rag_pgvector_chunks_document" ` +
      `FOREIGN KEY ("content_id", "profile") ` +
      `REFERENCES ${documents}("content_id", "profile") ` +
      `ON DELETE CASCADE` +
      `)`,
  );
  await queryRunner.query(
    `CREATE TABLE IF NOT EXISTS ${jobs} (` +
      `"content_id" varchar PRIMARY KEY, ` +
      `"revision" bigint NOT NULL DEFAULT 1, ` +
      `"attempts" integer NOT NULL DEFAULT 0, ` +
      `"available_at" timestamptz NOT NULL DEFAULT NOW(), ` +
      `"locked_at" timestamptz NULL, ` +
      `"locked_by" varchar NULL, ` +
      `"last_error" text NULL, ` +
      `"updated_at" timestamptz NOT NULL DEFAULT NOW(), ` +
      `CONSTRAINT "fk_rag_pgvector_jobs_content" ` +
      `FOREIGN KEY ("content_id") REFERENCES ${contents}("id") ON DELETE CASCADE` +
      `)`,
  );
  await queryRunner.query(
    `CREATE INDEX IF NOT EXISTS "rag_pgvector_jobs_available_idx" ` +
      `ON ${jobs} ("available_at", "updated_at")`,
  );
  await queryRunner.query(
    `CREATE OR REPLACE FUNCTION ${triggerFunction}() ` +
      `RETURNS TRIGGER AS $$ BEGIN ` +
      `IF TG_OP = 'INSERT' OR NEW."searchText" IS DISTINCT FROM OLD."searchText" THEN ` +
      `DELETE FROM ${documents} WHERE "content_id" = NEW."id"; ` +
      `INSERT INTO ${jobs} AS job ` +
      `("content_id", "revision", "attempts", "available_at", "locked_at", "locked_by", "last_error", "updated_at") ` +
      `VALUES (NEW."id", 1, 0, NOW(), NULL, NULL, NULL, NOW()) ` +
      `ON CONFLICT ("content_id") DO UPDATE SET ` +
      `"revision" = job."revision" + 1, ` +
      `"attempts" = 0, "available_at" = NOW(), "locked_at" = NULL, ` +
      `"locked_by" = NULL, "last_error" = NULL, "updated_at" = NOW(); ` +
      `END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await queryRunner.query(
    `DROP TRIGGER IF EXISTS "${PGVECTOR_TRIGGER}" ON ${contents}`,
  );
  await queryRunner.query(
    `CREATE TRIGGER "${PGVECTOR_TRIGGER}" ` +
      `AFTER INSERT OR UPDATE OF "searchText" ON ${contents} ` +
      `FOR EACH ROW EXECUTE FUNCTION ${triggerFunction}()`,
  );
  await queryRunner.query(
    `INSERT INTO ${jobs} ` +
      `("content_id", "revision", "attempts", "available_at", "updated_at") ` +
      `SELECT "id", 1, 0, NOW(), NOW() FROM ${contents} ` +
      `ON CONFLICT ("content_id") DO NOTHING`,
  );
}

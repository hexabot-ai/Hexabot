/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { QueryRunner } from 'typeorm';

import { qualifiedName } from '@/helper/lib/content-search.store';

// Schema object names and DDL for the built-in lexical (full-text) RAG helper.
// This is the single source of truth for provisioning the database-native
// search structures — a Postgres GIN expression index over `to_tsvector`, or a
// SQLite FTS5 virtual table with its sync triggers — so the v3.4.0 migration
// and any future runtime self-heal share exactly the same DDL and can never
// drift apart.
const CONTENTS_TABLE = 'contents';
const CONTENTS_FTS_INDEX = 'contents_fts_idx';
const CONTENTS_FTS_TABLE = 'contents_fts';
const CONTENTS_FTS_INSERT_TRIGGER = 'contents_fts_insert';
const CONTENTS_FTS_UPDATE_TRIGGER = 'contents_fts_update';
const CONTENTS_FTS_DELETE_TRIGGER = 'contents_fts_delete';
// The current SQLite sync triggers, dropped and recreated together with the
// FTS5 table so a re-run rebuilds cleanly.
const CONTENTS_FTS_TRIGGERS = [
  CONTENTS_FTS_INSERT_TRIGGER,
  CONTENTS_FTS_UPDATE_TRIGGER,
  CONTENTS_FTS_DELETE_TRIGGER,
] as const;
// llamaindex-era triggers left on "contents" by the previous RAG. Their
// external-content FTS5 table used an incompatible column list, so they are
// dropped before the index is (re)built: an orphaned legacy trigger would fire
// against the new table with its old columns and break every write to
// "contents".
const LEGACY_SQLITE_FTS_TRIGGERS = [
  'contents_fts_after_insert',
  'contents_fts_after_update',
  'contents_fts_after_delete',
] as const;

function isSqlite(queryRunner: QueryRunner): boolean {
  const databaseType = queryRunner.connection.options.type;

  return databaseType === 'better-sqlite3' || databaseType === 'sqlite';
}

/**
 * Creates (or repairs) the database-native lexical search infrastructure for
 * the current database: a GIN `to_tsvector` index on PostgreSQL, or an FTS5
 * virtual table with its sync triggers and an initial backfill on SQLite.
 *
 * Idempotent and safe to run repeatedly — on SQLite it drops and rebuilds the
 * FTS structures so a legacy (llamaindex-era) table with an incompatible schema
 * is always replaced. Databases other than PostgreSQL/SQLite have no native
 * lexical helper and are left untouched.
 *
 * It intentionally does NOT catch errors: callers decide how to react (roll
 * back a migration, surface an error, ...).
 */
export async function provisionLexicalInfrastructure(
  queryRunner: QueryRunner,
): Promise<void> {
  const databaseType = queryRunner.connection.options.type;

  if (databaseType === 'postgres') {
    await provisionPostgresLexicalInfrastructure(queryRunner);
  } else if (isSqlite(queryRunner)) {
    await provisionSqliteLexicalInfrastructure(queryRunner);
  }
}

/**
 * Removes the lexical search infrastructure for the current database. Used by
 * the v3.4.0 migration's `down` path.
 */
export async function deprovisionLexicalInfrastructure(
  queryRunner: QueryRunner,
): Promise<void> {
  const databaseType = queryRunner.connection.options.type;

  if (databaseType === 'postgres') {
    await queryRunner.query(
      `DROP INDEX IF EXISTS ${qualifiedName(queryRunner, CONTENTS_FTS_INDEX)}`,
    );
  } else if (isSqlite(queryRunner)) {
    for (const trigger of CONTENTS_FTS_TRIGGERS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "${trigger}"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "${CONTENTS_FTS_TABLE}"`);
  }
}

async function provisionPostgresLexicalInfrastructure(
  queryRunner: QueryRunner,
): Promise<void> {
  const contents = qualifiedName(queryRunner, CONTENTS_TABLE);
  await queryRunner.query(
    `CREATE INDEX IF NOT EXISTS "${CONTENTS_FTS_INDEX}" ON ${contents} ` +
      `USING GIN (to_tsvector('simple', COALESCE("searchText", '')))`,
  );
}

async function provisionSqliteLexicalInfrastructure(
  queryRunner: QueryRunner,
): Promise<void> {
  // The llamaindex-era RAG left a "contents_fts" FTS5 table with an
  // incompatible schema (external-content `fts5(title, searchText,
  // content='contents')`) plus its own AFTER triggers on "contents". A plain
  // `CREATE VIRTUAL TABLE IF NOT EXISTS` would silently keep that legacy table
  // — the "id" column doesn't exist there, so the backfill INSERT below and
  // the stale triggers both fail on any DB upgraded from a llamaindex
  // version. Drop the legacy structures (and the current ones, for
  // idempotent re-runs) before recreating, so the table is always rebuilt
  // with the new schema. `DROP TABLE` on an FTS5 table also removes its
  // shadow tables (_data/_idx/_docsize/_config).
  await dropSqliteLexicalInfrastructure(queryRunner);
  await queryRunner.query(
    `CREATE VIRTUAL TABLE IF NOT EXISTS "${CONTENTS_FTS_TABLE}" ` +
      `USING fts5("id" UNINDEXED, "searchText", tokenize = 'unicode61')`,
  );
  await queryRunner.query(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENTS_FTS_INSERT_TRIGGER}" ` +
      `AFTER INSERT ON "${CONTENTS_TABLE}" BEGIN ` +
      `INSERT INTO "${CONTENTS_FTS_TABLE}" ("id", "searchText") ` +
      `VALUES (NEW."id", NEW."searchText"); END`,
  );
  await queryRunner.query(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENTS_FTS_UPDATE_TRIGGER}" ` +
      `AFTER UPDATE OF "searchText" ON "${CONTENTS_TABLE}" BEGIN ` +
      `DELETE FROM "${CONTENTS_FTS_TABLE}" WHERE "id" = OLD."id"; ` +
      `INSERT INTO "${CONTENTS_FTS_TABLE}" ("id", "searchText") ` +
      `VALUES (NEW."id", NEW."searchText"); END`,
  );
  await queryRunner.query(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENTS_FTS_DELETE_TRIGGER}" ` +
      `AFTER DELETE ON "${CONTENTS_TABLE}" BEGIN ` +
      `DELETE FROM "${CONTENTS_FTS_TABLE}" WHERE "id" = OLD."id"; END`,
  );
  await queryRunner.query(`DELETE FROM "${CONTENTS_FTS_TABLE}"`);
  await queryRunner.query(
    `INSERT INTO "${CONTENTS_FTS_TABLE}" ("id", "searchText") ` +
      `SELECT "id", "searchText" FROM "${CONTENTS_TABLE}"`,
  );
}

/**
 * Removes any pre-existing "contents_fts" full-text structures before the
 * SQLite lexical index is rebuilt. This covers both the llamaindex-era triggers
 * and the current ones so a re-run is idempotent. The triggers must go before
 * the table: an orphaned legacy trigger left behind would fire against the
 * freshly created table with its old column list and break every write to
 * "contents".
 */
async function dropSqliteLexicalInfrastructure(
  queryRunner: QueryRunner,
): Promise<void> {
  for (const trigger of [
    ...LEGACY_SQLITE_FTS_TRIGGERS,
    ...CONTENTS_FTS_TRIGGERS,
  ]) {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "${trigger}"`);
  }
  await queryRunner.query(`DROP TABLE IF EXISTS "${CONTENTS_FTS_TABLE}"`);
}

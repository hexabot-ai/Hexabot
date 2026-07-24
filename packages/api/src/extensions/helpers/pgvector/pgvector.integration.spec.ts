/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import { ContentOrmEntity } from '@/cms/entities/content.entity';
import Migration1784815200000_V3_4_0 from '@/migration/migrations/1784815200000-v-3-4-0.migration';

import { FullTextSearchStore } from '../fulltext-search/fulltext-search.store';

import { isPgvectorProvisioned } from './pgvector.provisioning';
import { PgvectorStore } from './pgvector.store';

const databaseUrl = process.env.TEST_PGVECTOR_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('PostgreSQL lexical and pgvector RAG integration', () => {
  jest.setTimeout(30000);

  const schema = `rag_test_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let store: PgvectorStore;
  let contentTypeId: string;

  beforeAll(async () => {
    admin = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
    }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    dataSource = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
      entities: [ContentOrmEntity, ContentTypeOrmEntity],
    }).initialize();
    await dataSource.query(
      `CREATE TABLE "${schema}"."content_types" (` +
        `"id" varchar PRIMARY KEY, "name" varchar NOT NULL UNIQUE` +
        `)`,
    );
    await dataSource.query(
      `CREATE TABLE "${schema}"."contents" (` +
        `"id" varchar PRIMARY KEY, ` +
        `"content_type_id" varchar NOT NULL REFERENCES "${schema}"."content_types"("id") ON DELETE CASCADE, ` +
        `"title" varchar NOT NULL, "status" boolean NOT NULL DEFAULT true, ` +
        `"properties" text NULL, "searchText" text NOT NULL` +
        `)`,
    );

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await new Migration1784815200000_V3_4_0().up(queryRunner);
    await queryRunner.commitTransaction();
    await queryRunner.release();

    contentTypeId = randomUUID();
    await dataSource.query(
      `INSERT INTO "${schema}"."content_types" ("id", "name") VALUES ($1, 'Articles')`,
      [contentTypeId],
    );
    store = new PgvectorStore(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('provisions lexical search and a durable trigger-backed queue', async () => {
    const contentId = randomUUID();
    const source = 'title: Vector guide\nbody: semantic retrieval';
    await dataSource.query(
      `INSERT INTO "${schema}"."contents" ` +
        `("id", "content_type_id", "title", "status", "searchText") ` +
        `VALUES ($1, $2, 'Vector guide', true, $3)`,
      [contentId, contentTypeId, source],
    );

    const lexicalHits = await new FullTextSearchStore(dataSource).search(
      'semantic retrieval',
      { status: true },
    );
    expect(lexicalHits.some((hit) => hit.contentId === contentId)).toBe(true);

    const jobs = await store.claimJobs('integration-worker', 2);
    expect(jobs).toContainEqual({
      contentId,
      revision: 1,
      attempts: 0,
    });
    await store.save(
      jobs.find((job) => job.contentId === contentId)!,
      'integration-worker',
      'profile-a',
      source,
      [
        { index: 0, text: 'weaker chunk', embedding: [0, 1] },
        { index: 1, text: 'best semantic chunk', embedding: [1, 0] },
      ],
    );

    await expect(
      store.search([1, 0], 'profile-a', { status: true, limit: 5 }),
    ).resolves.toEqual([
      expect.objectContaining({
        contentId,
        text: 'best semantic chunk',
        score: 1,
      }),
    ]);
  });

  it('re-enqueues on deactivation and discards inactive embeddings', async () => {
    const contentId = randomUUID();
    const source = 'title: Draftable\nbody: publish state';
    await dataSource.query(
      `INSERT INTO "${schema}"."contents" ` +
        `("id", "content_type_id", "title", "status", "searchText") ` +
        `VALUES ($1, $2, 'Draftable', true, $3)`,
      [contentId, contentTypeId, source],
    );

    // Embed while active, then confirm it is retrievable.
    const activeJobs = await store.claimJobs('discard-worker', 10);
    const activeJob = activeJobs.find((job) => job.contentId === contentId)!;
    expect(activeJob).toBeDefined();
    await store.save(activeJob, 'discard-worker', 'profile-a', source, [
      { index: 0, text: 'publish state', embedding: [1, 0] },
    ]);
    const activeHits = await store.search([1, 0], 'profile-a', {
      status: true,
      limit: 10,
    });
    expect(activeHits.some((hit) => hit.contentId === contentId)).toBe(true);

    // Deactivating fires the trigger: it drops the documents immediately and
    // enqueues a fresh job for the worker to reconcile.
    await dataSource.query(
      `UPDATE "${schema}"."contents" SET "status" = false WHERE "id" = $1`,
      [contentId],
    );
    const inactiveHits = await store.search([1, 0], 'profile-a', {
      status: true,
      limit: 10,
    });
    expect(inactiveHits.some((hit) => hit.contentId === contentId)).toBe(false);
    const enqueued = await dataSource.query(
      `SELECT "content_id" FROM "${schema}"."rag_pgvector_jobs" WHERE "content_id" = $1`,
      [contentId],
    );
    expect(enqueued).toHaveLength(1);

    // The worker loads the row, sees it is inactive, and discards it.
    const inactiveJobs = await store.claimJobs('discard-worker', 10);
    const inactiveJob = inactiveJobs.find(
      (job) => job.contentId === contentId,
    )!;
    expect(inactiveJob).toBeDefined();
    await expect(store.loadContent(contentId)).resolves.toEqual({
      id: contentId,
      searchText: source,
      status: false,
    });
    await expect(
      store.discardInactive(inactiveJob, 'discard-worker'),
    ).resolves.toBe(true);

    for (const table of ['rag_pgvector_documents', 'rag_pgvector_jobs']) {
      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*) AS count FROM "${schema}"."${table}" WHERE "content_id" = $1`,
        [contentId],
      );
      expect(Number(count)).toBe(0);
    }
  });

  it('invalidates stale embeddings, revises active work, and cascades deletes', async () => {
    const contentId = randomUUID();
    const source = 'title: Concurrent updates';
    await dataSource.query(
      `INSERT INTO "${schema}"."contents" ` +
        `("id", "content_type_id", "title", "status", "searchText") ` +
        `VALUES ($1, $2, 'Concurrent updates', true, $3)`,
      [contentId, contentTypeId, source],
    );
    const [job] = await store.claimJobs('stale-worker', 1);

    await dataSource.query(
      `UPDATE "${schema}"."contents" SET "searchText" = $2 WHERE "id" = $1`,
      [contentId, `${source}\nbody: newer revision`],
    );
    await expect(
      store.save(job, 'stale-worker', 'profile-a', source, [
        { index: 0, text: source, embedding: [1, 0] },
      ]),
    ).resolves.toBe(false);

    const [queued] = await dataSource.query(
      `SELECT "revision", "locked_by" FROM "${schema}"."rag_pgvector_jobs" WHERE "content_id" = $1`,
      [contentId],
    );
    expect(Number(queued.revision)).toBe(2);
    expect(queued.locked_by).toBeNull();

    await dataSource.query(
      `DELETE FROM "${schema}"."content_types" WHERE "id" = $1`,
      [contentTypeId],
    );
    for (const table of [
      'rag_pgvector_documents',
      'rag_pgvector_chunks',
      'rag_pgvector_jobs',
    ]) {
      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*) AS count FROM "${schema}"."${table}"`,
      );
      expect(Number(count)).toBe(0);
    }
  });
});

describeWithPostgres('pgvector runtime self-heal', () => {
  jest.setTimeout(30000);

  const schema = `rag_repair_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let store: PgvectorStore;

  beforeAll(async () => {
    admin = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
    }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    dataSource = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
      entities: [ContentOrmEntity, ContentTypeOrmEntity],
    }).initialize();
    // Only the base content table exists: this mimics an installation where
    // v3.4.0 ran but pgvector provisioning was skipped (extension unavailable),
    // and the operator installed the `vector` extension afterwards.
    await dataSource.query(
      `CREATE TABLE "${schema}"."content_types" (` +
        `"id" varchar PRIMARY KEY, "name" varchar NOT NULL UNIQUE` +
        `)`,
    );
    await dataSource.query(
      `CREATE TABLE "${schema}"."contents" (` +
        `"id" varchar PRIMARY KEY, ` +
        `"content_type_id" varchar NOT NULL REFERENCES "${schema}"."content_types"("id") ON DELETE CASCADE, ` +
        `"title" varchar NOT NULL, "status" boolean NOT NULL DEFAULT true, ` +
        `"properties" text NULL, "searchText" text NOT NULL` +
        `)`,
    );
    await dataSource.query(
      `INSERT INTO "${schema}"."content_types" ("id", "name") VALUES ('ct-1', 'Articles')`,
    );
    await dataSource.query(
      `INSERT INTO "${schema}"."contents" ` +
        `("id", "content_type_id", "title", "searchText") ` +
        `VALUES ('content-1', 'ct-1', 'Doc', 'hello world')`,
    );
    store = new PgvectorStore(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('provisions missing infrastructure on first use and backfills the queue', async () => {
    const before = dataSource.createQueryRunner();
    await before.connect();
    await expect(isPgvectorProvisioned(before)).resolves.toBe(false);
    await before.release();

    await expect(store.assertInfrastructure()).resolves.toBeUndefined();

    const after = dataSource.createQueryRunner();
    await after.connect();
    await expect(isPgvectorProvisioned(after)).resolves.toBe(true);
    await after.release();

    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*) AS count FROM "${schema}"."rag_pgvector_jobs"`,
    );
    expect(Number(count)).toBe(1);
  });

  it('is an idempotent no-op once provisioned', async () => {
    await expect(
      new PgvectorStore(dataSource).assertInfrastructure(),
    ).resolves.toBeUndefined();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await expect(isPgvectorProvisioned(queryRunner)).resolves.toBe(true);
    await queryRunner.release();
  });
});

describeWithPostgres('contents.searchText btree index removal', () => {
  jest.setTimeout(30000);

  const schema = `rag_idx_${process.pid}_${Date.now()}`;
  // High-entropy text so TOAST compression can't shrink the btree entry back
  // under the 2704-byte limit (repetitive text would compress and slip through).
  const longText = randomBytes(4000).toString('hex'); // 8 KB, incompressible
  let admin: DataSource;
  let dataSource: DataSource;

  beforeAll(async () => {
    admin = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
    }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    dataSource = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
    }).initialize();
    await dataSource.query(
      `CREATE TABLE "${schema}"."contents" (` +
        `"id" varchar PRIMARY KEY, ` +
        `"title" varchar NOT NULL, "status" boolean NOT NULL DEFAULT true, ` +
        `"searchText" text NOT NULL` +
        `)`,
    );
    // Reproduce the auto-generated btree index that TypeORM would create from
    // the (now removed) `@Index(['searchText'])` decorator.
    await dataSource.query(
      `CREATE INDEX "IDX_contents_searchText_legacy" ` +
        `ON "${schema}"."contents" ("searchText")`,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  const insertLongContent = (id: string) =>
    dataSource.query(
      `INSERT INTO "${schema}"."contents" ("id", "title", "searchText") ` +
        `VALUES ($1, 'Long', $2)`,
      [id, longText],
    );

  it('rejects long content while the btree index exists', async () => {
    await expect(insertLongContent('before')).rejects.toThrow(
      /index row size|maximum .* for index/i,
    );
  });

  it('drops the index so long content can be inserted', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await new Migration1784815200000_V3_4_0().up(queryRunner);
    await queryRunner.commitTransaction();
    await queryRunner.release();

    const indexes = await dataSource.query(
      `SELECT i.relname AS name FROM pg_index ix ` +
        `JOIN pg_class i ON i.oid = ix.indexrelid ` +
        `JOIN pg_class t ON t.oid = ix.indrelid ` +
        `JOIN pg_namespace n ON n.oid = t.relnamespace ` +
        `JOIN pg_am am ON am.oid = i.relam ` +
        `JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0] ` +
        `WHERE t.relname = 'contents' AND a.attname = 'searchText' ` +
        `AND ix.indnatts = 1 AND am.amname = 'btree' AND n.nspname = $1`,
      [schema],
    );
    expect(indexes).toHaveLength(0);

    await expect(insertLongContent('after')).resolves.not.toThrow();
  });
});

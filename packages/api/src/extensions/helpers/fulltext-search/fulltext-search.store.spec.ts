/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource } from 'typeorm';

import { ContentRepository } from '@/cms/repositories/content.repository';
import Migration1784815200000_V3_4_0 from '@/migration/migrations/1784815200000-v-3-4-0.migration';
import { installContentFixturesTypeOrm } from '@/utils/test/fixtures/content';
import { installContentTypeFixturesTypeOrm } from '@/utils/test/fixtures/contenttype';
import { buildTestingMocks } from '@/utils/test/utils';

import { FullTextSearchStore } from './fulltext-search.store';

describe('FullTextSearchStore (SQLite FTS5)', () => {
  let contentRepository: ContentRepository;
  let dataSource: DataSource;
  let store: FullTextSearchStore;
  let contentTypeId: string;

  beforeAll(async () => {
    const { module, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [ContentRepository],
      typeorm: [
        {
          fixtures: [
            installContentTypeFixturesTypeOrm,
            installContentFixturesTypeOrm,
          ],
        },
      ],
    });
    [contentRepository] = await getMocks([ContentRepository]);
    dataSource = module.get(DataSource);
    store = new FullTextSearchStore(dataSource);

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await new Migration1784815200000_V3_4_0().up(queryRunner);
    await queryRunner.release();

    const [{ id }] = await dataSource.query(
      'SELECT id FROM content_types LIMIT 1',
    );
    contentTypeId = id;
  });

  it('provisions FTS structures through the migration', async () => {
    const tables = await dataSource.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='contents_fts'",
    );
    expect(tables).toHaveLength(1);
  });

  it('backfills existing rows and finds active content', async () => {
    const hits = await store.search('Jean', { status: true });

    expect(hits.some((hit) => hit.title === 'Jean')).toBe(true);
    const jean = hits.find((hit) => hit.title === 'Jean');
    expect(jean?.contentId).toBeTruthy();
    expect(jean?.text).toContain('Jean');
    expect(typeof jean?.score).toBe('number');
  });

  it('excludes inactive content unless included', async () => {
    const activeOnly = await store.search('Adaptateur', { status: true });
    expect(activeOnly.some((hit) => hit.title === 'Adaptateur')).toBe(false);

    const includingInactive = await store.search('Adaptateur');
    expect(includingInactive.some((hit) => hit.title === 'Adaptateur')).toBe(
      true,
    );
  });

  it('filters by content type and respects the limit', async () => {
    const hits = await store.search('store', {
      contentTypeId,
      limit: 1,
    });

    expect(hits.length).toBeLessThanOrEqual(1);
    for (const hit of hits) {
      expect(hit.contentTypeId).toBe(contentTypeId);
    }
  });

  it('handles FTS5 special characters and token-less queries', async () => {
    await expect(store.search('"unbalanced (quote* :')).resolves.toEqual(
      expect.any(Array),
    );
    await expect(store.search('***')).resolves.toEqual([]);
  });

  it('keeps the index in sync through insert/update/delete triggers', async () => {
    const created = await contentRepository.create({
      title: 'Zephyrwidget',
      contentType: contentTypeId,
      status: true,
      properties: { subtitle: 'uniqueneedletoken' },
    } as never);

    let hits = await store.search('uniqueneedletoken');
    expect(hits.some((hit) => hit.contentId === created.id)).toBe(true);

    await contentRepository.updateOne(created.id, {
      properties: { subtitle: 'replacedneedletoken' },
    } as never);
    hits = await store.search('uniqueneedletoken');
    expect(hits.some((hit) => hit.contentId === created.id)).toBe(false);
    hits = await store.search('replacedneedletoken');
    expect(hits.some((hit) => hit.contentId === created.id)).toBe(true);

    await contentRepository.deleteOne(created.id);
    hits = await store.search('replacedneedletoken');
    expect(hits.some((hit) => hit.contentId === created.id)).toBe(false);
  });

  it('rebuilds FTS rows transactionally', async () => {
    await dataSource.query(`DELETE FROM "contents_fts"`);
    await store.reindex();
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*) AS count FROM "contents_fts"`,
    );
    const [{ contentCount }] = await dataSource.query(
      `SELECT COUNT(*) AS contentCount FROM "contents"`,
    );

    expect(Number(count)).toBe(Number(contentCount));
  });

  it('removes FTS rows when contents are cascade-deleted with their content type', async () => {
    await dataSource.query('PRAGMA foreign_keys = ON');
    const [content] = await dataSource.query(
      `SELECT "content_type_id" AS "contentTypeId" FROM "contents" LIMIT 1`,
    );

    await dataSource.query(`DELETE FROM "content_types" WHERE "id" = ?`, [
      content.contentTypeId,
    ]);

    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*) AS count FROM "contents_fts" ` +
        `WHERE "id" NOT IN (SELECT "id" FROM "contents")`,
    );
    expect(Number(count)).toBe(0);
  });
});

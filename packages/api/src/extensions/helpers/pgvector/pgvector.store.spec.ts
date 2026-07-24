/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource, QueryRunner } from 'typeorm';

import { RagHelperUnavailableError } from '@/cms/errors/rag.errors';

import { PgvectorStore } from './pgvector.store';

const contentMetadata = {
  tableName: 'contents',
  tablePath: 'contents',
  schema: undefined,
  findColumnWithPropertyName: (name: string) => ({
    databaseName:
      name === 'searchText'
        ? 'searchText'
        : name === 'contentType'
          ? 'content_type_id'
          : name,
  }),
  findRelationWithPropertyPath: () => ({
    joinColumns: [{ databaseName: 'content_type_id' }],
  }),
};
const createDataSource = () => {
  const query = jest.fn();
  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
    connection: { options: { type: 'postgres' } },
  };
  const dataSource = {
    options: { type: 'postgres' },
    getMetadata: jest.fn().mockReturnValue(contentMetadata),
    query,
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  } as unknown as DataSource;

  return {
    dataSource,
    query,
    queryRunner: queryRunner as unknown as jest.Mocked<QueryRunner>,
  };
};

describe('PgvectorStore', () => {
  const missingState = {
    hasVector: false,
    hasDocuments: false,
    hasChunks: false,
    hasJobs: false,
  };

  describe('assertInfrastructure', () => {
    it('does not provision when the infrastructure already exists', async () => {
      const { dataSource, query } = createDataSource();
      query.mockResolvedValueOnce([
        {
          hasVector: true,
          hasDocuments: true,
          hasChunks: true,
          hasJobs: true,
        },
      ]);
      const store = new PgvectorStore(dataSource);

      await expect(store.assertInfrastructure()).resolves.toBeUndefined();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('auto-provisions under an advisory lock when infrastructure is missing', async () => {
      const { dataSource, query, queryRunner } = createDataSource();
      query.mockResolvedValueOnce([missingState]);
      queryRunner.query
        .mockResolvedValueOnce(undefined) // advisory lock
        .mockResolvedValueOnce([missingState]) // re-check under the lock
        .mockResolvedValue(undefined); // DDL statements
      const store = new PgvectorStore(dataSource);

      await expect(store.assertInfrastructure()).resolves.toBeUndefined();

      const statements = queryRunner.query.mock.calls.map(([sql]) =>
        String(sql),
      );
      expect(statements[0]).toContain('pg_advisory_xact_lock');
      expect(
        statements.some((sql) =>
          sql.includes('CREATE EXTENSION IF NOT EXISTS vector'),
        ),
      ).toBe(true);
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('skips the DDL when another instance provisioned under the lock', async () => {
      const { dataSource, query, queryRunner } = createDataSource();
      query.mockResolvedValueOnce([missingState]);
      queryRunner.query
        .mockResolvedValueOnce(undefined) // advisory lock
        .mockResolvedValueOnce([
          {
            hasVector: true,
            hasDocuments: true,
            hasChunks: true,
            hasJobs: true,
            hasTrigger: true,
          },
        ]); // re-check under the lock: already provisioned
      const store = new PgvectorStore(dataSource);

      await expect(store.assertInfrastructure()).resolves.toBeUndefined();

      const statements = queryRunner.query.mock.calls.map(([sql]) =>
        String(sql),
      );
      expect(statements.some((sql) => sql.includes('CREATE EXTENSION'))).toBe(
        false,
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('rolls back and raises RagHelperUnavailableError when provisioning fails', async () => {
      const { dataSource, query, queryRunner } = createDataSource();
      query.mockResolvedValueOnce([missingState]);
      queryRunner.query
        .mockResolvedValueOnce(undefined) // advisory lock
        .mockResolvedValueOnce([missingState]) // re-check under the lock
        .mockRejectedValueOnce(
          new Error('permission denied to create extension "vector"'),
        );
      const store = new PgvectorStore(dataSource);

      await expect(store.assertInfrastructure()).rejects.toThrow(
        RagHelperUnavailableError,
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('rejects non-PostgreSQL data sources', async () => {
      const { dataSource } = createDataSource();
      (dataSource.options as { type: string }).type = 'better-sqlite3';
      const store = new PgvectorStore(dataSource);

      await expect(store.assertInfrastructure()).rejects.toThrow(
        RagHelperUnavailableError,
      );
    });
  });

  it('uses exact cosine distance and returns one best chunk per content', async () => {
    const { dataSource, query } = createDataSource();
    query
      .mockResolvedValueOnce([
        {
          hasVector: true,
          hasDocuments: true,
          hasChunks: true,
          hasJobs: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          contentId: 'c1',
          title: 'One',
          text: 'best chunk',
          contentTypeId: 'ct1',
          score: 0.75,
        },
      ]);
    const store = new PgvectorStore(dataSource);
    const hits = await store.search([1, 0], 'profile', {
      status: true,
      limit: 3,
    });
    const sql = String(query.mock.calls[1][0]);
    expect(sql).toContain('<=> $1::vector');
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('PARTITION BY');
    expect(sql).toContain('document."source_text" = content."searchText"');
    expect(hits).toEqual([
      {
        contentId: 'c1',
        title: 'One',
        text: 'best chunk',
        contentTypeId: 'ct1',
        score: 0.75,
      },
    ]);
  });

  it('claims expired work with skip-locked leases', async () => {
    const { dataSource, query } = createDataSource();
    query
      .mockResolvedValueOnce([
        {
          hasVector: true,
          hasDocuments: true,
          hasChunks: true,
          hasJobs: true,
        },
      ])
      .mockResolvedValueOnce([
        [{ contentId: 'c1', revision: '4', attempts: 2 }],
        1,
      ]);
    const store = new PgvectorStore(dataSource);

    await expect(store.claimJobs('worker', 2)).resolves.toEqual([
      { contentId: 'c1', revision: 4, attempts: 2 },
    ]);
    expect(String(query.mock.calls[1][0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(String(query.mock.calls[1][0])).toContain(`INTERVAL '5 minutes'`);
  });

  it('guards persistence by source text, revision, and worker lease', async () => {
    const { dataSource, queryRunner } = createDataSource();
    queryRunner.query
      .mockResolvedValueOnce([{ searchText: 'new source' }])
      .mockResolvedValueOnce([{ revision: '2', workerId: 'worker' }]);
    const store = new PgvectorStore(dataSource);

    await expect(
      store.save(
        { contentId: 'c1', revision: 1, attempts: 0 },
        'worker',
        'profile',
        'old source',
        [{ index: 0, text: 'old source', embedding: [1, 0] }],
      ),
    ).resolves.toBe(false);

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(
      queryRunner.query.mock.calls.some(([sql]) =>
        String(sql).startsWith('INSERT INTO "rag_pgvector_documents"'),
      ),
    ).toBe(false);
  });

  it('removes old profiles only after the replacement chunks are stored', async () => {
    const { dataSource, queryRunner } = createDataSource();
    queryRunner.query
      .mockResolvedValueOnce([{ searchText: 'current source' }])
      .mockResolvedValueOnce([{ revision: '3', workerId: 'worker' }])
      .mockResolvedValue([]);
    const store = new PgvectorStore(dataSource);

    await expect(
      store.save(
        { contentId: 'c1', revision: 3, attempts: 0 },
        'worker',
        'new-profile',
        'current source',
        [{ index: 0, text: 'current source', embedding: [1, 0] }],
      ),
    ).resolves.toBe(true);

    const statements = queryRunner.query.mock.calls.map(([sql]) => String(sql));
    const insertChunk = statements.findIndex((sql) =>
      sql.startsWith('INSERT INTO "rag_pgvector_chunks"'),
    );
    const removeOldProfiles = statements.findIndex((sql) =>
      sql.includes(`"profile" <> $2`),
    );
    expect(insertChunk).toBeGreaterThan(-1);
    expect(removeOldProfiles).toBeGreaterThan(insertChunk);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('retains failed jobs with bounded exponential retry metadata', async () => {
    const { dataSource, query } = createDataSource();
    const store = new PgvectorStore(dataSource);

    await store.fail(
      { contentId: 'c1', revision: 3, attempts: 7 },
      'worker',
      new Error('embedding failed'),
    );

    expect(String(query.mock.calls[0][0])).toContain('900::double precision');
    expect(query.mock.calls[0][1]).toEqual([
      'c1',
      3,
      'worker',
      'embedding failed',
    ]);
  });
});

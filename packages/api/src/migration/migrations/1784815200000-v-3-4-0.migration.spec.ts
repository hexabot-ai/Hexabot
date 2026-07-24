/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource, QueryRunner, Repository } from 'typeorm';

import { SettingOrmEntity } from '@/setting/entities/setting.entity';

import Migration1784815200000_V3_4_0 from './1784815200000-v-3-4-0.migration';

describe('Migration v3.4.0', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  let settings: Repository<SettingOrmEntity>;

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [SettingOrmEntity],
      synchronize: true,
    }).initialize();
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    settings = queryRunner.manager.getRepository(SettingOrmEntity);
    await queryRunner.query(
      `CREATE TABLE "contents" (` +
        `"id" varchar PRIMARY KEY, "searchText" text NOT NULL` +
        `)`,
    );
    await queryRunner.query(
      `INSERT INTO "contents" ("id", "searchText") VALUES ('content-1', 'hello world')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" varchar PRIMARY KEY, "type" varchar NOT NULL)`,
    );
    await queryRunner.query(
      `INSERT INTO "users" ("id", "type") VALUES ('owner-1', 'UserOrmEntity')`,
    );
    await queryRunner.query(
      `CREATE TABLE "credentials" (` +
        `"id" varchar PRIMARY KEY, "name" varchar NOT NULL UNIQUE, ` +
        `"value" text NOT NULL, "owner_id" varchar NOT NULL` +
        `)`,
    );
  });

  afterEach(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  const seedLegacyEmbeddingSettings = async (
    apiKey = 'legacy-key',
    enabled = true,
  ) => {
    await settings.save([
      settings.create({
        group: 'rag_settings',
        label: 'enabled',
        value: enabled,
      }),
      settings.create({
        group: 'rag_settings',
        label: 'default_mode',
        value: 'embedding',
      }),
      settings.create({
        group: 'rag_settings',
        label: 'embedding_provider',
        value: 'openai',
      }),
      settings.create({
        group: 'rag_settings',
        label: 'embedding_model',
        value: 'legacy-model',
      }),
      settings.create({
        group: 'rag_settings',
        label: 'embedding_api_key',
        value: apiKey,
      }),
      settings.create({
        group: 'rag_settings',
        label: 'embedding_base_url',
        value: 'https://embeddings.example/v1',
      }),
      settings.create({
        group: 'rag_settings',
        label: 'embedding_dimensions',
        value: 768,
      }),
    ]);
  };
  const seedNewDefaults = async () => {
    await settings.save([
      settings.create({
        group: 'global_settings',
        label: 'default_rag_helper',
        value: 'fulltext-search',
      }),
      ...Object.entries({
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
        embedding_api_key: '',
        embedding_base_url: '',
        embedding_dimensions: 1536,
        chunk_size: 2000,
        chunk_overlap: 200,
      }).map(([label, value]) =>
        settings.create({
          group: 'pgvector',
          subgroup: 'helper',
          label,
          value,
        }),
      ),
    ]);
  };
  const getValue = async (group: string, label: string) =>
    (
      await settings.findOneByOrFail({
        group,
        label,
      })
    ).value;

  it('migrates SQLite embedding installations to lexical while preserving configuration', async () => {
    await seedLegacyEmbeddingSettings();
    await seedNewDefaults();
    const migration = new Migration1784815200000_V3_4_0();

    await migration.up(queryRunner);

    await expect(
      getValue('global_settings', 'default_rag_helper'),
    ).resolves.toBe('fulltext-search');
    await expect(getValue('pgvector', 'embedding_model')).resolves.toBe(
      'legacy-model',
    );
    await expect(getValue('pgvector', 'embedding_provider')).resolves.toBe(
      'openai',
    );
    const credentialId = await getValue('pgvector', 'embedding_api_key');
    expect(credentialId).toEqual(expect.any(String));
    await expect(
      queryRunner.query(
        `SELECT "value", "owner_id" AS "ownerId" FROM "credentials" WHERE "id" = ?`,
        [credentialId],
      ),
    ).resolves.toEqual([{ value: 'legacy-key', ownerId: 'owner-1' }]);
    await expect(getValue('pgvector', 'embedding_base_url')).resolves.toBe(
      'https://embeddings.example/v1',
    );
    await expect(getValue('pgvector', 'embedding_dimensions')).resolves.toBe(
      768,
    );
  });

  it('selects pgvector only for PostgreSQL with extension and an API key', async () => {
    await seedLegacyEmbeddingSettings();
    await seedNewDefaults();
    const migration = new Migration1784815200000_V3_4_0();

    await (
      migration as unknown as {
        migrateSettings(
          runner: QueryRunner,
          postgres: boolean,
          vector: boolean,
        ): Promise<void>;
      }
    ).migrateSettings(queryRunner, true, true);

    await expect(
      getValue('global_settings', 'default_rag_helper'),
    ).resolves.toBe('pgvector');
  });

  it('keeps lexical when legacy RAG was disabled even if embeddings were configured', async () => {
    await seedLegacyEmbeddingSettings('legacy-key', false);
    await seedNewDefaults();
    const migration = new Migration1784815200000_V3_4_0();

    await (
      migration as unknown as {
        migrateSettings(
          runner: QueryRunner,
          postgres: boolean,
          vector: boolean,
        ): Promise<void>;
      }
    ).migrateSettings(queryRunner, true, true);

    await expect(
      getValue('global_settings', 'default_rag_helper'),
    ).resolves.toBe('fulltext-search');
  });

  it.each([
    { postgres: true, vector: false, apiKey: 'legacy-key' },
    { postgres: true, vector: true, apiKey: '' },
    { postgres: false, vector: true, apiKey: 'legacy-key' },
  ])(
    'falls back to lexical for unavailable legacy embedding combinations',
    async ({ postgres, vector, apiKey }) => {
      await seedLegacyEmbeddingSettings(apiKey);
      const migration = new Migration1784815200000_V3_4_0();

      await (
        migration as unknown as {
          migrateSettings(
            runner: QueryRunner,
            isPostgres: boolean,
            pgvectorAvailable: boolean,
          ): Promise<void>;
        }
      ).migrateSettings(queryRunner, postgres, vector);

      await expect(
        getValue('global_settings', 'default_rag_helper'),
      ).resolves.toBe('fulltext-search');
    },
  );

  it('is idempotent and rolls back only new structures and settings', async () => {
    await seedLegacyEmbeddingSettings();
    const migration = new Migration1784815200000_V3_4_0();

    await migration.up(queryRunner);
    await migration.up(queryRunner);
    expect(
      await settings.countBy({
        group: 'pgvector',
        label: 'embedding_model',
      }),
    ).toBe(1);
    expect(
      await queryRunner.query(`SELECT COUNT(*) AS count FROM "contents_fts"`),
    ).toEqual([{ count: 1 }]);
    expect(
      await queryRunner.query(`SELECT COUNT(*) AS count FROM "credentials"`),
    ).toEqual([{ count: 1 }]);

    await migration.down(queryRunner);

    expect(await settings.countBy({ group: 'pgvector' })).toBe(0);
    expect(
      await settings.countBy({
        group: 'rag_settings',
        label: 'embedding_model',
      }),
    ).toBe(1);
    expect(
      await queryRunner.query(
        `SELECT name FROM sqlite_master WHERE name = 'contents_fts'`,
      ),
    ).toEqual([]);
  });
});

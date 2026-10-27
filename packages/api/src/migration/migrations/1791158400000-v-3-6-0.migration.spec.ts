/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource, EntitySchema, QueryRunner } from 'typeorm';

import Migration1791158400000_V3_6_0 from './1791158400000-v-3-6-0.migration';

/**
 * Maps `workflow_runs` to an entity, as the application data source does. A
 * query builder given that table name then resolves this entity, and accepts
 * its property names (`failedAt`) instead of its column names (`failed_at`).
 */
const WorkflowRunEntity = new EntitySchema({
  name: 'WorkflowRunOrmEntity',
  tableName: 'workflow_runs',
  columns: {
    id: { type: 'varchar', primary: true },
    status: { type: 'varchar' },
    error: { type: 'text', nullable: true },
    metadata: { type: 'text', nullable: true },
    suspendedAt: { name: 'suspended_at', type: 'datetime', nullable: true },
    failedAt: { name: 'failed_at', type: 'datetime', nullable: true },
    createdAt: { name: 'created_at', type: 'datetime', createDate: true },
    updatedAt: { name: 'updated_at', type: 'datetime', updateDate: true },
  },
});
const AWAITING_OPERATOR_INDEX = 'IDX_workflow_runs_awaiting_operator';
const LEGACY_COLUMNS = [
  'suspended_step',
  'suspension_reason',
  'suspension_data',
  'last_resume_data',
  'suspension_step_exec_id',
  'suspension_index',
  'suspension_key',
  'suspension_await_results',
];

describe('Migration v3.6.0', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  const columnNames = async (): Promise<string[]> =>
    (
      (await queryRunner.query(`PRAGMA table_info("workflow_runs")`)) as Array<{
        name: string;
      }>
    ).map(({ name }) => name);
  const indexNames = async (): Promise<string[]> =>
    (
      (await queryRunner.query(`PRAGMA index_list("workflow_runs")`)) as Array<{
        name: string;
      }>
    ).map(({ name }) => name);
  const findRun = async (id: string) =>
    (
      (await queryRunner.query(`SELECT * FROM "workflow_runs" WHERE "id" = ?`, [
        id,
      ])) as Array<Record<string, unknown>>
    )[0];
  // Migrations run inside a transaction, where foreign keys stay enforced.
  const inTransaction = async (operation: () => Promise<void>) => {
    await queryRunner.startTransaction();
    await operation();
    await queryRunner.commitTransaction();
  };

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [WorkflowRunEntity],
    }).initialize();
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    // The workflow_runs schema of v3.5, with the relations that reference it.
    await queryRunner.query(
      `CREATE TABLE "workflow_runs" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"status" varchar NOT NULL DEFAULT ('idle'), ` +
        `"parent_run_id" varchar REFERENCES "workflow_runs" ("id") ON DELETE SET NULL, ` +
        `"suspended_step" varchar(255), ` +
        `"suspension_reason" varchar(255), ` +
        `"suspension_data" text, ` +
        `"suspension_step_exec_id" varchar(255), ` +
        `"suspension_index" integer, ` +
        `"suspension_key" varchar(255), ` +
        `"suspension_await_results" text, ` +
        `"last_resume_data" text, ` +
        `"metadata" text, ` +
        `"error" text, ` +
        `"suspended_at" datetime, ` +
        `"failed_at" datetime, ` +
        `"created_at" datetime, ` +
        `"updated_at" datetime` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TABLE "memory_records" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"run_id" varchar REFERENCES "workflow_runs" ("id") ON DELETE CASCADE` +
        `)`,
    );
    await queryRunner.query(
      `INSERT INTO "workflow_runs" ("id", "status", "parent_run_id", "suspended_step", "suspension_key") VALUES ` +
        `('parent', 'suspended', NULL, '0:call_child', 'index:1'), ` +
        `('child', 'suspended', 'parent', '0:ask', 'index:1'), ` +
        `('done', 'finished', NULL, NULL, NULL)`,
    );
    await queryRunner.query(
      `INSERT INTO "memory_records" ("id", "run_id") VALUES ('memory', 'child')`,
    );
  });

  afterEach(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  it('replaces the suspension columns with a checkpoint column', async () => {
    await inTransaction(() =>
      new Migration1791158400000_V3_6_0().up(queryRunner),
    );

    const columns = await columnNames();
    expect(columns).toContain('checkpoint');
    expect(columns).toEqual(expect.not.arrayContaining(LEGACY_COLUMNS));
    // Columns the checkpoint does not replace stay.
    expect(columns).toEqual(
      expect.arrayContaining(['suspended_at', 'parent_run_id', 'error']),
    );
  });

  it('fails runs suspended without a checkpoint and leaves the others', async () => {
    const logger = { warn: jest.fn() };

    await inTransaction(() =>
      new Migration1791158400000_V3_6_0().up(queryRunner, {
        logger,
      } as never),
    );

    for (const id of ['parent', 'child']) {
      const run = await findRun(id);
      expect(run.status).toBe('failed');
      expect(run.error).toContain('v3.6.0');
      expect(run.failed_at).toBeTruthy();
      expect(run.updated_at).toBeTruthy();
    }
    expect((await findRun('done')).status).toBe('finished');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('2 suspended workflow run(s)'),
    );
  });

  it('drops the execution state the previous engine kept in the metadata', async () => {
    const setMetadata = async (id: string, metadata: string) =>
      await queryRunner.query(
        `UPDATE "workflow_runs" SET "metadata" = ? WHERE "id" = ?`,
        [metadata, id],
      );
    await setMetadata(
      'done',
      JSON.stringify({
        trigger: 'manual',
        state: { accumulator: 1, iterationStack: [0] },
      }),
    );
    await setMetadata('parent', 'not json');
    await setMetadata(
      'child',
      JSON.stringify({ trigger: 'manual', state: { accumulator: 'a\u0000b' } }),
    );

    await inTransaction(() =>
      new Migration1791158400000_V3_6_0().up(queryRunner),
    );

    expect(JSON.parse((await findRun('done')).metadata as string)).toEqual({
      trigger: 'manual',
    });
    expect(JSON.parse((await findRun('child')).metadata as string)).toEqual({
      trigger: 'manual',
    });
    expect((await findRun('parent')).metadata).toBe('not json');
  });

  it('keeps memory records and parent links of the runs', async () => {
    await inTransaction(() =>
      new Migration1791158400000_V3_6_0().up(queryRunner),
    );

    expect(
      await queryRunner.query(`SELECT "id", "run_id" FROM "memory_records"`),
    ).toEqual([{ id: 'memory', run_id: 'child' }]);
    expect((await findRun('child')).parent_run_id).toBe('parent');
  });

  it('is idempotent and keeps runs suspended with a checkpoint', async () => {
    const migration = new Migration1791158400000_V3_6_0();
    await inTransaction(() => migration.up(queryRunner));
    await queryRunner.query(
      `INSERT INTO "workflow_runs" ("id", "status", "checkpoint") VALUES ('resumable', 'suspended', '{"version":1}')`,
    );

    await inTransaction(() => migration.up(queryRunner));

    expect((await findRun('resumable')).status).toBe('suspended');
    expect(await columnNames()).toContain('checkpoint');
  });

  it('adds an indexed awaiting_operator flag', async () => {
    await inTransaction(() =>
      new Migration1791158400000_V3_6_0().up(queryRunner),
    );

    const column = (
      (await queryRunner.query(`PRAGMA table_info("workflow_runs")`)) as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>
    ).find(({ name }) => name === 'awaiting_operator');
    expect(column).toMatchObject({ notnull: 1, dflt_value: '0' });
    expect(await indexNames()).toContain(AWAITING_OPERATOR_INDEX);
    expect((await findRun('done')).awaiting_operator).toBe(0);
  });

  it('flags the runs whose checkpoint holds a wait only an admin resolves', async () => {
    const migration = new Migration1791158400000_V3_6_0();
    const logger = { warn: jest.fn(), log: jest.fn() };
    await inTransaction(() => migration.up(queryRunner));
    const checkpoint = (...reasons: string[]) =>
      JSON.stringify({
        version: 1,
        waits: reasons.map((reason, index) => ({
          waitId: `wait-${index}`,
          reason,
        })),
      });
    await queryRunner.query(
      `INSERT INTO "workflow_runs" ("id", "status", "checkpoint") VALUES ` +
        `('approval', 'suspended', ?), ` +
        `('resume', 'suspended', ?), ` +
        `('child-only', 'suspended', ?), ` +
        `('malformed', 'suspended', 'not json')`,
      [
        checkpoint('awaiting_user_response', 'awaiting_approval'),
        checkpoint('awaiting_resume'),
        checkpoint('awaiting_child_workflow'),
      ],
    );

    await inTransaction(() => migration.up(queryRunner, { logger } as never));

    expect((await findRun('approval')).awaiting_operator).toBe(1);
    expect((await findRun('resume')).awaiting_operator).toBe(1);
    expect((await findRun('child-only')).awaiting_operator).toBe(0);
    expect((await findRun('malformed')).awaiting_operator).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('2 workflow run(s) waiting on an admin'),
    );
    expect(await indexNames()).toContain(AWAITING_OPERATOR_INDEX);
  });

  it('does nothing when the table does not exist yet', async () => {
    await queryRunner.query(`DROP TABLE "memory_records"`);
    await queryRunner.query(`DROP TABLE "workflow_runs"`);

    await expect(
      new Migration1791158400000_V3_6_0().up(queryRunner),
    ).resolves.toBeUndefined();
  });

  it('restores the suspension columns and fails suspended runs on down', async () => {
    const migration = new Migration1791158400000_V3_6_0();
    await inTransaction(() => migration.up(queryRunner));
    await queryRunner.query(
      `INSERT INTO "workflow_runs" ("id", "status", "checkpoint") VALUES ('resumable', 'suspended', '{"version":1}')`,
    );

    await inTransaction(() => migration.down(queryRunner));

    const columns = await columnNames();
    expect(columns).not.toContain('checkpoint');
    expect(columns).not.toContain('awaiting_operator');
    expect(await indexNames()).not.toContain(AWAITING_OPERATOR_INDEX);
    expect(columns).toEqual(expect.arrayContaining(LEGACY_COLUMNS));
    expect((await findRun('resumable')).status).toBe('failed');
    expect(
      await queryRunner.query(`SELECT "id" FROM "memory_records"`),
    ).toEqual([{ id: 'memory' }]);
  });
});

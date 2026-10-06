/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableColumnOptions,
} from 'typeorm';

import { MigrationServices } from '../types';

const WORKFLOW_RUNS_TABLE = 'workflow_runs';

type ColumnSpec = {
  /** Column type used with a native `ALTER TABLE` on SQLite. */
  sqliteType: string;
  /** Column definition used on other databases. */
  column: TableColumnOptions;
};

/** The workflow run checkpoint, the only state needed to resume a run. */
const CHECKPOINT_COLUMN: ColumnSpec = {
  sqliteType: 'text',
  column: { name: 'checkpoint', type: 'json', isNullable: true },
};
/** Suspension columns of the previous engine, replaced by the checkpoint. */
const LEGACY_SUSPENSION_COLUMNS: ColumnSpec[] = [
  {
    sqliteType: 'varchar(255)',
    column: {
      name: 'suspended_step',
      type: 'varchar',
      length: '255',
      isNullable: true,
    },
  },
  {
    sqliteType: 'varchar(255)',
    column: {
      name: 'suspension_reason',
      type: 'varchar',
      length: '255',
      isNullable: true,
    },
  },
  {
    sqliteType: 'text',
    column: { name: 'suspension_data', type: 'json', isNullable: true },
  },
  {
    sqliteType: 'text',
    column: { name: 'last_resume_data', type: 'json', isNullable: true },
  },
  {
    sqliteType: 'varchar(255)',
    column: {
      name: 'suspension_step_exec_id',
      type: 'varchar',
      length: '255',
      isNullable: true,
    },
  },
  {
    sqliteType: 'integer',
    column: { name: 'suspension_index', type: 'int', isNullable: true },
  },
  {
    sqliteType: 'varchar(255)',
    column: {
      name: 'suspension_key',
      type: 'varchar',
      length: '255',
      isNullable: true,
    },
  },
  {
    sqliteType: 'text',
    column: {
      name: 'suspension_await_results',
      type: 'json',
      isNullable: true,
    },
  },
];

/**
 * v3.6.0 moves workflow suspension to agentic checkpoints.
 *
 * A suspended run is now resumed from a single JSON `checkpoint` column, which
 * replaces the suspension columns of the previous engine: the replay state,
 * the last resume payload, and the suspended step, reason and data, which the
 * checkpoint's open waits now describe. Runs suspended before
 * this upgrade have no checkpoint and can never be resumed, so they are failed
 * with an explicit error instead of claiming their subscriber's next event.
 * The execution state the previous engine kept in `metadata.state` is
 * dropped as well.
 *
 * `workflow_runs` only exists through TypeORM `synchronize`; when it is
 * missing, synchronize creates it (with its foreign keys) and there is nothing
 * to migrate.
 *
 * On SQLite, columns are added and dropped with a native `ALTER TABLE`.
 * TypeORM's `addColumn`/`dropColumn` rebuild the table instead, and the
 * `DROP TABLE` of that rebuild would fire the foreign keys referencing runs
 * (still enforced inside the migration transaction): it would delete every
 * run-scoped memory record and unlink child runs from their parents.
 */
export default class Migration1791158400000_V3_6_0
  implements MigrationInterface
{
  name = 'Migration1791158400000_V3_6_0';

  public async up(
    queryRunner: QueryRunner,
    services?: MigrationServices,
  ): Promise<void> {
    if (!(await queryRunner.hasTable(WORKFLOW_RUNS_TABLE))) {
      return;
    }

    await this.addColumn(queryRunner, CHECKPOINT_COLUMN);

    const failed = await this.failSuspendedRuns(queryRunner, {
      withoutCheckpointOnly: true,
      error:
        'This run was suspended before the v3.6.0 upgrade and cannot be resumed.',
    });
    if (failed > 0) {
      services?.logger?.warn(
        `${failed} suspended workflow run(s) have no checkpoint and were marked ` +
          'as failed; the next event from each subscriber starts a new run.',
      );
    }

    await this.dropLegacyMetadataState(queryRunner);

    for (const spec of LEGACY_SUSPENSION_COLUMNS) {
      await this.dropColumn(queryRunner, spec);
    }
  }

  public async down(
    queryRunner: QueryRunner,
    services?: MigrationServices,
  ): Promise<void> {
    if (!(await queryRunner.hasTable(WORKFLOW_RUNS_TABLE))) {
      return;
    }

    // The previous engine cannot resume from a checkpoint.
    const failed = await this.failSuspendedRuns(queryRunner, {
      withoutCheckpointOnly: false,
      error:
        'This run was suspended before the v3.6.0 downgrade and cannot be resumed.',
    });
    if (failed > 0) {
      services?.logger?.warn(
        `${failed} suspended workflow run(s) were marked as failed by the downgrade.`,
      );
    }

    await this.dropColumn(queryRunner, CHECKPOINT_COLUMN);

    for (const spec of LEGACY_SUSPENSION_COLUMNS) {
      await this.addColumn(queryRunner, spec);
    }
  }

  /**
   * Mark suspended runs as failed.
   *
   * The update is written in SQL: given the table name, a query builder
   * resolves the `WorkflowRunOrmEntity` the application registers, and then
   * only accepts its property names (`failedAt`), not column names.
   *
   * @returns The number of runs marked as failed.
   */
  private async failSuspendedRuns(
    queryRunner: QueryRunner,
    options: { withoutCheckpointOnly: boolean; error: string },
  ): Promise<number> {
    const { driver } = queryRunner.connection;
    const table = this.tablePath(queryRunner)
      .split('.')
      .map((part) => driver.escape(part))
      .join('.');
    const [query, parameters] = driver.escapeQueryWithParameters(
      `UPDATE ${table} SET "status" = 'failed', "error" = :error, ` +
        `"failed_at" = :now, "updated_at" = :now ` +
        `WHERE "status" = 'suspended'` +
        (options.withoutCheckpointOnly ? ` AND "checkpoint" IS NULL` : ''),
      { error: options.error, now: new Date() },
      {},
    );
    const result = await queryRunner.query(query, parameters, true);

    return result.affected ?? 0;
  }

  /**
   * Drop the execution state (iteration, accumulator) the previous engine
   * kept in `metadata.state`; nothing reads it any more. Other metadata keys
   * are kept.
   */
  private async dropLegacyMetadataState(
    queryRunner: QueryRunner,
  ): Promise<void> {
    if (!(await queryRunner.hasColumn(WORKFLOW_RUNS_TABLE, 'metadata'))) {
      return;
    }

    const [metadata, hasState] = this.isSqlite(queryRunner)
      ? [
          `json_remove("metadata", '$.state')`,
          // `json_type` throws on malformed JSON, so only valid values reach it.
          `CASE WHEN json_valid("metadata") ` +
            `THEN json_type("metadata", '$.state') IS NOT NULL ELSE 0 END`,
        ]
      : // Postgres refuses to read JSON holding a `\u0000` escape, which the
        // stored state can hold, so those values are left as they are; the
        // `CASE` keeps them away from any JSON function. `->` gives NULL,
        // rather than failing, on a value that is not an object.
        [
          `COALESCE((SELECT json_object_agg("key", "value") ` +
            `FROM json_each(CAST("metadata" AS json)) WHERE "key" <> 'state'), ` +
            `CAST('{}' AS json))`,
          `CASE WHEN strpos(CAST("metadata" AS text), '\\u0000') > 0 THEN false ` +
            `ELSE (CAST("metadata" AS json) -> 'state') IS NOT NULL END`,
        ];

    await queryRunner.manager
      .createQueryBuilder()
      .update(this.tablePath(queryRunner))
      .set({ metadata: () => metadata })
      .where(hasState)
      .callListeners(false)
      .execute();
  }

  private async addColumn(
    queryRunner: QueryRunner,
    spec: ColumnSpec,
  ): Promise<void> {
    const { name } = spec.column;
    if (await queryRunner.hasColumn(WORKFLOW_RUNS_TABLE, name)) {
      return;
    }

    if (this.isSqlite(queryRunner)) {
      await queryRunner.query(
        `ALTER TABLE "${WORKFLOW_RUNS_TABLE}" ADD COLUMN "${name}" ${spec.sqliteType}`,
      );

      return;
    }

    await queryRunner.addColumn(
      WORKFLOW_RUNS_TABLE,
      new TableColumn(spec.column),
    );
  }

  private async dropColumn(
    queryRunner: QueryRunner,
    spec: ColumnSpec,
  ): Promise<void> {
    const { name } = spec.column;
    if (!(await queryRunner.hasColumn(WORKFLOW_RUNS_TABLE, name))) {
      return;
    }

    if (this.isSqlite(queryRunner)) {
      await queryRunner.query(
        `ALTER TABLE "${WORKFLOW_RUNS_TABLE}" DROP COLUMN "${name}"`,
      );

      return;
    }

    await queryRunner.dropColumn(WORKFLOW_RUNS_TABLE, name);
  }

  /**
   * Name of the runs table, qualified with the configured schema (Postgres
   * `DB_SCHEMA`). Query builders do not apply that schema to a bare table
   * name, unlike the query runner's table helpers.
   */
  private tablePath(queryRunner: QueryRunner): string {
    const { schema } = queryRunner.connection.options as { schema?: string };

    return queryRunner.connection.driver.buildTableName(
      WORKFLOW_RUNS_TABLE,
      schema,
    );
  }

  private isSqlite(queryRunner: QueryRunner): boolean {
    const databaseType = queryRunner.connection.options.type;

    return databaseType === 'better-sqlite3' || databaseType === 'sqlite';
  }
}

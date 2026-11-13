/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHash } from 'crypto';

import { resolveWorkflowInputSchema, WorkflowType } from '@hexabot-ai/types';
import { QueryRunner, TableColumn } from 'typeorm';

import {
  extractWorkflowInputs,
  upgradeLegacyWorkflowInputs,
} from '@/workflow/lib/legacy-workflow-inputs';

const WORKFLOWS_TABLE = 'workflows';
const VERSIONS_TABLE = 'workflow_versions';
const INPUT_SCHEMA_COLUMN = 'input_schema';

/** What the steps report to; the application logger and Nest's both fit. */
export type MigrationStepLogger = {
  log(message: string): void;
  warn(message: string): void;
};

type WorkflowRow = {
  id: string;
  name: string;
  type: string;
  current_version_id?: string | null;
  input_schema?: unknown;
};

type VersionRow = {
  id: string;
  workflow_id: string;
  version: number;
  definition_yml: string;
};

const isSqlite = (queryRunner: QueryRunner): boolean => {
  const databaseType = queryRunner.connection.options.type;

  return databaseType === 'better-sqlite3' || databaseType === 'sqlite';
};
/**
 * Name of a table, qualified with the configured schema (Postgres
 * `DB_SCHEMA`) and escaped for raw SQL.
 */
const tablePath = (queryRunner: QueryRunner, table: string): string => {
  const { driver, options } = queryRunner.connection;

  return driver
    .buildTableName(table, (options as { schema?: string }).schema)
    .split('.')
    .map((part) => driver.escape(part))
    .join('.');
};
/** SQLite stores JSON columns as text; Postgres returns them parsed. */
const readJson = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value ?? undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};
const hasWorkflowTables = async (queryRunner: QueryRunner): Promise<boolean> =>
  (await queryRunner.hasTable(WORKFLOWS_TABLE)) &&
  (await queryRunner.hasTable(VERSIONS_TABLE));
/** Rewrite the definition of a version, with the checksum that follows from it. */
const saveDefinition = async (
  queryRunner: QueryRunner,
  versionId: string,
  definitionYml: string,
): Promise<void> => {
  const [query, parameters] =
    queryRunner.connection.driver.escapeQueryWithParameters(
      `UPDATE ${tablePath(queryRunner, VERSIONS_TABLE)} ` +
        `SET "definition_yml" = :definitionYml, "checksum" = :checksum ` +
        `WHERE "id" = :id`,
      {
        definitionYml,
        // As `WorkflowVersionOrmEntity.computeChecksum` computes it.
        checksum: createHash('sha256').update(definitionYml).digest('hex'),
        id: versionId,
      },
      {},
    );
  await queryRunner.query(query, parameters);
};

/**
 * Whether workflows still carry the input schema column of v3.6 and
 * earlier, which {@link moveWorkflowInputSchemasToDefinitions} empties.
 */
export const hasWorkflowInputSchemaColumn = async (
  queryRunner: QueryRunner,
): Promise<boolean> =>
  (await hasWorkflowTables(queryRunner)) &&
  (await queryRunner.hasColumn(WORKFLOWS_TABLE, INPUT_SCHEMA_COLUMN));

/**
 * Make the definition the only description of a workflow's input.
 *
 * Until v3.6 the input of a workflow was described twice: by a JSON Schema
 * on the workflow record (`workflows.input_schema`) and by a field map in
 * its definition (`inputs.schema`). Every version of every workflow is
 * rewritten so that `inputs.schema` is the JSON Schema its runs are checked
 * against (see `upgradeLegacyWorkflowInputs`), history included: restoring
 * an older version then keeps the input the workflow takes today. The
 * checksum of a rewritten version follows. The column is dropped last.
 *
 * Suspended runs pinned to a rewritten version stay resumable: the
 * fingerprint a checkpoint is checked against does not cover `inputs`, and
 * resuming does not check the start input again.
 *
 * Safe to run again: definitions already rewritten are left alone, and the
 * column is only read and dropped while it exists.
 *
 * @returns The number of versions rewritten.
 */
export const moveWorkflowInputSchemasToDefinitions = async (
  queryRunner: QueryRunner,
  logger?: MigrationStepLogger,
): Promise<number> => {
  if (!(await hasWorkflowTables(queryRunner))) {
    return 0;
  }

  const hasColumn = await queryRunner.hasColumn(
    WORKFLOWS_TABLE,
    INPUT_SCHEMA_COLUMN,
  );
  const workflows = (await queryRunner.query(
    `SELECT "id", "name", "type"` +
      (hasColumn ? `, "${INPUT_SCHEMA_COLUMN}"` : '') +
      ` FROM ${tablePath(queryRunner, WORKFLOWS_TABLE)}`,
  )) as WorkflowRow[];
  const workflowsById = new Map(
    workflows.map((workflow) => [workflow.id, workflow]),
  );
  const versions = (await queryRunner.query(
    `SELECT "id", "workflow_id", "version", "definition_yml" ` +
      `FROM ${tablePath(queryRunner, VERSIONS_TABLE)}`,
  )) as VersionRow[];
  let rewritten = 0;

  for (const version of versions) {
    const workflow = workflowsById.get(version.workflow_id);
    if (!workflow || typeof version.definition_yml !== 'string') {
      continue;
    }

    const upgrade = upgradeLegacyWorkflowInputs(version.definition_yml, {
      type: workflow.type,
      inputSchema: readJson(workflow.input_schema),
    });
    for (const warning of upgrade.warnings) {
      logger?.warn(
        `Workflow "${workflow.name}" (version ${version.version}): ${warning}.`,
      );
    }

    if (upgrade.changed) {
      await saveDefinition(queryRunner, version.id, upgrade.definitionYml);
      rewritten += 1;
    }
  }

  if (rewritten > 0) {
    logger?.log(
      `${rewritten} workflow version(s) now declare the input of their ` +
        'workflow as a JSON Schema, under "inputs.schema".',
    );
  }

  if (hasColumn) {
    // A native `ALTER TABLE` on SQLite: TypeORM's `dropColumn` rebuilds the
    // table, and the `DROP TABLE` of that rebuild would fire the foreign keys
    // referencing workflows (still enforced inside a transaction), deleting
    // their versions and runs.
    await (isSqlite(queryRunner)
      ? queryRunner.query(
          `ALTER TABLE "${WORKFLOWS_TABLE}" DROP COLUMN "${INPUT_SCHEMA_COLUMN}"`,
        )
      : queryRunner.dropColumn(WORKFLOWS_TABLE, INPUT_SCHEMA_COLUMN));
  }

  return rewritten;
};

/**
 * Undo {@link moveWorkflowInputSchemasToDefinitions} for v3.6 and earlier,
 * which read `inputs.schema` as a field map and cannot load a JSON Schema
 * there.
 *
 * The column is added back and filled for every workflow: a manual one gets
 * the schema its current version declares, the others the schema of their
 * trigger. `inputs` is taken out of every version of the manual workflows,
 * so that the record schema is the only check, as it was for the workflows
 * built in the editor.
 *
 * @returns The number of versions rewritten.
 */
export const restoreWorkflowInputSchemaColumn = async (
  queryRunner: QueryRunner,
): Promise<number> => {
  if (!(await hasWorkflowTables(queryRunner))) {
    return 0;
  }

  if (!(await queryRunner.hasColumn(WORKFLOWS_TABLE, INPUT_SCHEMA_COLUMN))) {
    await (isSqlite(queryRunner)
      ? queryRunner.query(
          `ALTER TABLE "${WORKFLOWS_TABLE}" ADD COLUMN "${INPUT_SCHEMA_COLUMN}" text`,
        )
      : queryRunner.addColumn(
          WORKFLOWS_TABLE,
          new TableColumn({
            name: INPUT_SCHEMA_COLUMN,
            type: 'json',
            isNullable: true,
          }),
        ));
  }

  const { driver } = queryRunner.connection;
  const workflows = (await queryRunner.query(
    `SELECT "id", "name", "type", "current_version_id" ` +
      `FROM ${tablePath(queryRunner, WORKFLOWS_TABLE)}`,
  )) as WorkflowRow[];
  const versions = (await queryRunner.query(
    `SELECT "id", "workflow_id", "version", "definition_yml" ` +
      `FROM ${tablePath(queryRunner, VERSIONS_TABLE)}`,
  )) as VersionRow[];
  const manualIds = new Set(
    workflows
      .filter(({ type }) => type === WorkflowType.manual)
      .map(({ id }) => id),
  );
  const declaredByVersion = new Map<string, unknown>();
  let rewritten = 0;

  for (const version of versions) {
    if (
      !manualIds.has(version.workflow_id) ||
      typeof version.definition_yml !== 'string'
    ) {
      continue;
    }

    const extracted = extractWorkflowInputs(version.definition_yml);
    declaredByVersion.set(version.id, extracted.inputSchema);
    if (extracted.changed) {
      await saveDefinition(queryRunner, version.id, extracted.definitionYml);
      rewritten += 1;
    }
  }

  for (const workflow of workflows) {
    const declared = workflow.current_version_id
      ? declaredByVersion.get(workflow.current_version_id)
      : undefined;
    const [query, parameters] = driver.escapeQueryWithParameters(
      `UPDATE ${tablePath(queryRunner, WORKFLOWS_TABLE)} ` +
        `SET "${INPUT_SCHEMA_COLUMN}" = :inputSchema WHERE "id" = :id`,
      {
        inputSchema: JSON.stringify(
          declared ?? resolveWorkflowInputSchema(workflow.type),
        ),
        id: workflow.id,
      },
      {},
    );
    await queryRunner.query(query, parameters);
  }

  // SQLite cannot make an existing column required; v3.6 always writes it.
  if (queryRunner.connection.options.type === 'postgres') {
    await queryRunner.query(
      `ALTER TABLE ${tablePath(queryRunner, WORKFLOWS_TABLE)} ` +
        `ALTER COLUMN "${INPUT_SCHEMA_COLUMN}" SET NOT NULL`,
    );
  }

  return rewritten;
};

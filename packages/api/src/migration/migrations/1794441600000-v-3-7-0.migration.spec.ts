/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  compileWorkflow,
  fingerprintWorkflow,
  validateWorkflow,
} from '@hexabot-ai/agentic';
import { resolveWorkflowInputSchema } from '@hexabot-ai/types';
import { Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { parse } from 'yaml';

import { runBeforeSynchronize } from '@/database/before-synchronize';

import Migration1794441600000_V3_7_0 from './1794441600000-v-3-7-0.migration';

const FLOW = `defs:
  greet:
    kind: task
    action: noop
flow:
  # Greets the caller.
  - do: greet
outputs:
  done: =true
`;
const FIELD_MAP = `inputs:
  schema:
    question:
      type: string
${FLOW}`;
const DEFAULT_MANUAL_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {},
  additionalProperties: {},
};
const TOPIC_SCHEMA = {
  type: 'object',
  properties: { topic: { type: 'string', default: 'news' } },
  required: ['topic'],
};
const QUESTION_SCHEMA = {
  type: 'object',
  properties: { question: { type: 'string' } },
  additionalProperties: false,
};
const checksumOf = (definitionYml: string) =>
  createHash('sha256').update(definitionYml).digest('hex');
/** The tables of v3.6 the migration reads, with the relations between them. */
const createSchema = async (queryRunner: QueryRunner) => {
  await queryRunner.query(
    `CREATE TABLE "workflows" (` +
      `"id" varchar PRIMARY KEY NOT NULL, ` +
      `"name" varchar(255) NOT NULL, ` +
      `"type" varchar NOT NULL, ` +
      `"input_schema" text NOT NULL, ` +
      `"current_version_id" varchar REFERENCES "workflow_versions" ("id") ON DELETE SET NULL` +
      `)`,
  );
  await queryRunner.query(
    `CREATE TABLE "workflow_versions" (` +
      `"id" varchar PRIMARY KEY NOT NULL, ` +
      `"workflow_id" varchar NOT NULL REFERENCES "workflows" ("id") ON DELETE CASCADE, ` +
      `"version" integer NOT NULL, ` +
      `"definition_yml" text NOT NULL, ` +
      `"checksum" varchar(64) NOT NULL` +
      `)`,
  );
  await queryRunner.query(
    `CREATE TABLE "workflow_runs" (` +
      `"id" varchar PRIMARY KEY NOT NULL, ` +
      `"status" varchar NOT NULL, ` +
      `"workflow_id" varchar NOT NULL REFERENCES "workflows" ("id") ON DELETE CASCADE, ` +
      `"workflow_version_id" varchar REFERENCES "workflow_versions" ("id") ON DELETE SET NULL` +
      `)`,
  );
};
const insertWorkflow = async (
  queryRunner: QueryRunner,
  workflow: {
    id: string;
    type: string;
    inputSchema: unknown;
    versions: string[];
  },
) => {
  await queryRunner.query(
    `INSERT INTO "workflows" ("id", "name", "type", "input_schema") VALUES (?, ?, ?, ?)`,
    [
      workflow.id,
      `${workflow.id} workflow`,
      workflow.type,
      JSON.stringify(workflow.inputSchema),
    ],
  );
  for (const [index, definitionYml] of workflow.versions.entries()) {
    await queryRunner.query(
      `INSERT INTO "workflow_versions" ("id", "workflow_id", "version", "definition_yml", "checksum") VALUES (?, ?, ?, ?, ?)`,
      [
        `${workflow.id}-v${index + 1}`,
        workflow.id,
        index + 1,
        definitionYml,
        checksumOf(definitionYml),
      ],
    );
  }
  await queryRunner.query(
    `UPDATE "workflows" SET "current_version_id" = ? WHERE "id" = ?`,
    [`${workflow.id}-v${workflow.versions.length}`, workflow.id],
  );
};
/** One workflow per case the upgrade tells apart. */
const insertWorkflows = async (queryRunner: QueryRunner) => {
  // Built in the editor: the schema is on the record only.
  await insertWorkflow(queryRunner, {
    id: 'record',
    type: 'manual',
    inputSchema: TOPIC_SCHEMA,
    versions: [FLOW, FLOW],
  });
  // Written by hand: the fields are in the definition only.
  await insertWorkflow(queryRunner, {
    id: 'fields',
    type: 'manual',
    inputSchema: DEFAULT_MANUAL_SCHEMA,
    versions: [FLOW, FIELD_MAP],
  });
  await insertWorkflow(queryRunner, {
    id: 'both',
    type: 'manual',
    inputSchema: TOPIC_SCHEMA,
    versions: [FIELD_MAP],
  });
  await insertWorkflow(queryRunner, {
    id: 'chat',
    type: 'conversational',
    inputSchema: resolveWorkflowInputSchema('conversational'),
    versions: [FIELD_MAP, FLOW],
  });
  await queryRunner.query(
    `INSERT INTO "workflow_runs" ("id", "status", "workflow_id", "workflow_version_id") VALUES ` +
      `('run', 'suspended', 'fields', 'fields-v2')`,
  );
};

describe('Migration v3.7.0', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  const columnNames = async (): Promise<string[]> =>
    (
      (await queryRunner.query(`PRAGMA table_info("workflows")`)) as Array<{
        name: string;
      }>
    ).map(({ name }) => name);
  const findVersion = async (id: string) =>
    (
      (await queryRunner.query(
        `SELECT "definition_yml", "checksum" FROM "workflow_versions" WHERE "id" = ?`,
        [id],
      )) as Array<{ definition_yml: string; checksum: string }>
    )[0];
  const inputsOf = async (versionId: string) =>
    (
      parse((await findVersion(versionId)).definition_yml) as {
        inputs?: unknown;
      }
    ).inputs;
  const count = async (table: string): Promise<number> =>
    (
      (await queryRunner.query(
        `SELECT COUNT(*) AS "count" FROM "${table}"`,
      )) as Array<{ count: number }>
    )[0].count;
  // Migrations run inside a transaction, where foreign keys stay enforced.
  const inTransaction = async (operation: () => Promise<void>) => {
    await queryRunner.startTransaction();
    await operation();
    await queryRunner.commitTransaction();
  };
  const migrate = async (logger?: { log: jest.Mock; warn: jest.Mock }) =>
    await inTransaction(() =>
      new Migration1794441600000_V3_7_0().up(queryRunner, { logger } as any),
    );

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    }).initialize();
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await createSchema(queryRunner);
    await insertWorkflows(queryRunner);
  });

  afterEach(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  it('writes the input schema of a manual workflow into every one of its versions', async () => {
    await migrate();

    expect(await inputsOf('record-v1')).toEqual({ schema: TOPIC_SCHEMA });
    expect(await inputsOf('record-v2')).toEqual({ schema: TOPIC_SCHEMA });
  });

  it('turns the field map of a definition into a JSON Schema', async () => {
    await migrate();

    expect(await inputsOf('fields-v2')).toEqual({ schema: QUESTION_SCHEMA });
    // A version that declared nothing still takes any object.
    expect((await findVersion('fields-v1')).definition_yml).toBe(FLOW);
  });

  it('lets the input schema of the workflow replace the fields its definition declared, and reports it', async () => {
    const logger = { log: jest.fn(), warn: jest.fn() };

    await migrate(logger);

    expect(await inputsOf('both-v1')).toEqual({ schema: TOPIC_SCHEMA });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Workflow "both workflow" (version 1): the fields the definition ' +
        'declared (question) were replaced by the input schema of the workflow.',
    );
    expect(logger.log).toHaveBeenCalledWith(
      '5 workflow version(s) now declare the input of their workflow as a ' +
        'JSON Schema, under "inputs.schema".',
    );
  });

  it('removes the inputs a conversational workflow declared', async () => {
    await migrate();

    expect(await inputsOf('chat-v1')).toBeUndefined();
    expect((await findVersion('chat-v2')).definition_yml).toBe(FLOW);
  });

  it('leaves definitions the application accepts, with their comments', async () => {
    await migrate();

    for (const id of ['record-v1', 'fields-v2', 'both-v1', 'chat-v1']) {
      const { definition_yml } = await findVersion(id);

      expect(validateWorkflow(definition_yml).success).toBe(true);
      expect(definition_yml).toContain('# Greets the caller.');
    }
  });

  it('recomputes the checksum of the versions it rewrites', async () => {
    await migrate();

    for (const id of ['record-v1', 'fields-v1', 'fields-v2', 'chat-v1']) {
      const version = await findVersion(id);

      expect(version.checksum).toBe(checksumOf(version.definition_yml));
    }
    expect((await findVersion('fields-v2')).checksum).not.toBe(
      checksumOf(FIELD_MAP),
    );
  });

  it('drops the input schema column without deleting what references workflows', async () => {
    await migrate();

    expect(await columnNames()).not.toContain('input_schema');
    expect(await count('workflows')).toBe(4);
    expect(await count('workflow_versions')).toBe(7);
    expect(
      await queryRunner.query(
        `SELECT "workflow_version_id" FROM "workflow_runs" WHERE "id" = 'run'`,
      ),
    ).toEqual([{ workflow_version_id: 'fields-v2' }]);
    expect(
      await queryRunner.query(
        `SELECT "current_version_id" FROM "workflows" WHERE "id" = 'fields'`,
      ),
    ).toEqual([{ current_version_id: 'fields-v2' }]);
  });

  it('keeps the fingerprint suspended runs are resumed against', async () => {
    const fingerprint = (definitionYml: string) => {
      const validation = validateWorkflow(definitionYml);
      if (!validation.success) {
        throw new Error('The definition is not valid');
      }

      return fingerprintWorkflow(
        compileWorkflow(validation.data, {
          actions: {
            noop: {
              name: 'noop',
              parseSettings: (settings: unknown) => settings,
            },
          },
        } as any),
      );
    };

    await migrate();

    // The field map does not compile any more; without it, the definition is
    // what the run was suspended on, as far as a checkpoint is concerned.
    expect(fingerprint((await findVersion('fields-v2')).definition_yml)).toBe(
      fingerprint(FLOW),
    );
  });

  it('changes nothing when run again', async () => {
    await migrate();
    const before = await queryRunner.query(`SELECT * FROM "workflow_versions"`);
    const logger = { log: jest.fn(), warn: jest.fn() };

    await migrate(logger);

    expect(
      await queryRunner.query(`SELECT * FROM "workflow_versions"`),
    ).toEqual(before);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does nothing on a database without workflows', async () => {
    await queryRunner.query(`DROP TABLE "workflow_runs"`);
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);
    await queryRunner.query(`DROP TABLE "workflow_versions"`);
    await queryRunner.query(`DROP TABLE "workflows"`);

    await expect(migrate()).resolves.toBeUndefined();
  });

  describe('down', () => {
    const findInputSchema = async (id: string) =>
      JSON.parse(
        (
          (await queryRunner.query(
            `SELECT "input_schema" FROM "workflows" WHERE "id" = ?`,
            [id],
          )) as Array<{ input_schema: string }>
        )[0].input_schema,
      );
    const rollBack = async (logger?: { log: jest.Mock; warn: jest.Mock }) =>
      await inTransaction(() =>
        new Migration1794441600000_V3_7_0().down(queryRunner, {
          logger,
        } as any),
      );

    it('gives every workflow its input schema back, from its current version', async () => {
      await migrate();
      await rollBack();

      expect(await columnNames()).toContain('input_schema');
      expect(await findInputSchema('record')).toEqual(TOPIC_SCHEMA);
      expect(await findInputSchema('fields')).toEqual(QUESTION_SCHEMA);
      expect(await findInputSchema('both')).toEqual(TOPIC_SCHEMA);
      expect(await findInputSchema('chat')).toEqual(
        resolveWorkflowInputSchema('conversational'),
      );
    });

    it('takes the inputs out of the definitions, which v3.6 cannot read', async () => {
      const logger = { log: jest.fn(), warn: jest.fn() };

      await migrate();
      await rollBack(logger);

      for (const id of ['record-v1', 'record-v2', 'fields-v2', 'both-v1']) {
        const version = await findVersion(id);

        expect(parse(version.definition_yml)).toEqual(parse(FLOW));
        expect(version.checksum).toBe(checksumOf(version.definition_yml));
      }
      expect(logger.warn).toHaveBeenCalledWith(
        '"inputs" was taken out of 4 workflow version(s): v3.6 keeps the ' +
          'input schema of a workflow on its record.',
      );
    });

    it('gives a manual workflow that declares nothing the open schema', async () => {
      await queryRunner.query(
        `UPDATE "workflows" SET "input_schema" = ? WHERE "id" = 'record'`,
        [JSON.stringify(DEFAULT_MANUAL_SCHEMA)],
      );

      await migrate();
      await rollBack();

      expect(await findInputSchema('record')).toEqual(DEFAULT_MANUAL_SCHEMA);
    });
  });
});

describe('runBeforeSynchronize', () => {
  let directory: string;
  let database: string;

  const withDatabase = async <T>(
    operation: (queryRunner: QueryRunner) => Promise<T>,
  ): Promise<T> => {
    const dataSource = await new DataSource({
      type: 'better-sqlite3',
      database,
    }).initialize();
    const queryRunner = dataSource.createQueryRunner();

    try {
      return await operation(queryRunner);
    } finally {
      await queryRunner.release();
      await dataSource.destroy();
    }
  };
  const readState = async () =>
    await withDatabase(async (queryRunner) => ({
      hasColumn: await queryRunner.hasColumn('workflows', 'input_schema'),
      inputs: (
        parse(
          (
            (await queryRunner.query(
              `SELECT "definition_yml" FROM "workflow_versions" WHERE "id" = 'record-v2'`,
            )) as Array<{ definition_yml: string }>
          )[0].definition_yml,
        ) as { inputs?: unknown }
      ).inputs,
    }));

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    directory = mkdtempSync(join(tmpdir(), 'hexabot-before-synchronize-'));
    database = join(directory, 'hexabot.sqlite');
    await withDatabase(async (queryRunner) => {
      await createSchema(queryRunner);
      await insertWorkflows(queryRunner);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('moves the input schemas into the definitions before synchronizing drops them', async () => {
    await runBeforeSynchronize({
      type: 'better-sqlite3',
      database,
      synchronize: true,
    });

    expect(await readState()).toEqual({
      hasColumn: false,
      inputs: { schema: TOPIC_SCHEMA },
    });
  });

  it('leaves the database to the migration when it is not synchronized', async () => {
    await runBeforeSynchronize({
      type: 'better-sqlite3',
      database,
      synchronize: false,
    });

    expect(await readState()).toEqual({ hasColumn: true, inputs: undefined });
  });

  it('does nothing once the column is gone', async () => {
    const options = {
      type: 'better-sqlite3' as const,
      database,
      synchronize: true,
    };

    await runBeforeSynchronize(options);
    await expect(runBeforeSynchronize(options)).resolves.toBeUndefined();
  });

  it('does nothing on an empty database', async () => {
    await expect(
      runBeforeSynchronize({
        type: 'better-sqlite3',
        database: join(directory, 'empty.sqlite'),
        synchronize: true,
      }),
    ).resolves.toBeUndefined();
  });
});

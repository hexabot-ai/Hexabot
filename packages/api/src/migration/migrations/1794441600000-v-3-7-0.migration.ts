/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  moveWorkflowInputSchemasToDefinitions,
  restoreWorkflowInputSchemaColumn,
} from '../lib/workflow-input-schemas';
import { MigrationServices } from '../types';

/**
 * v3.7.0 makes the definition the only description of a workflow's input.
 *
 * `inputs.schema` of a definition is now a JSON Schema, and the input schema
 * the workflow record carried (`workflows.input_schema`) is gone: the API
 * derives `inputSchema` from the workflow type and the current definition.
 * Every stored version is rewritten to the new form, then the column is
 * dropped (see `moveWorkflowInputSchemasToDefinitions`).
 *
 * With `DB_SYNCHRONIZE=true`, TypeORM drops the column when the connection
 * opens, before any migration runs. The same step is therefore run ahead of
 * it (`runBeforeSynchronize`), and this migration then finds nothing left to
 * do. It does the work on the deployments that do not synchronize.
 */
export default class Migration1794441600000_V3_7_0
  implements MigrationInterface
{
  name = 'Migration1794441600000_V3_7_0';

  public async up(
    queryRunner: QueryRunner,
    services?: MigrationServices,
  ): Promise<void> {
    await moveWorkflowInputSchemasToDefinitions(queryRunner, services?.logger);
  }

  public async down(
    queryRunner: QueryRunner,
    services?: MigrationServices,
  ): Promise<void> {
    const rewritten = await restoreWorkflowInputSchemaColumn(queryRunner);
    if (rewritten > 0) {
      services?.logger?.warn(
        `"inputs" was taken out of ${rewritten} workflow version(s): v3.6 ` +
          'keeps the input schema of a workflow on its record.',
      );
    }
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Logger } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';

import {
  hasWorkflowInputSchemaColumn,
  moveWorkflowInputSchemasToDefinitions,
} from '@/migration/lib/workflow-input-schemas';

/**
 * Move out of the database what TypeORM is about to drop from it.
 *
 * With `synchronize` on, TypeORM aligns the tables with the entities when
 * the connection opens: a column no entity declares any more is dropped
 * then, before any migration ran, and a migration moving its content
 * elsewhere would find it gone. The steps that move such content are run
 * here, on a connection of their own that knows no entity. Their migration
 * runs them as well, for the deployments that do not synchronize.
 *
 * A step has to be safe to run on every start: it checks by itself whether
 * its work is still to be done. One that fails stops the application from
 * starting, so that nothing is dropped before it succeeded.
 *
 * @param options The options the application connects with.
 */
export const runBeforeSynchronize = async (
  options: DataSourceOptions,
): Promise<void> => {
  if (!options.synchronize || options.type === 'mongodb') {
    return;
  }

  const dataSource = await new DataSource({
    ...options,
    entities: [],
    subscribers: [],
    migrations: [],
    synchronize: false,
    dropSchema: false,
    migrationsRun: false,
  } as DataSourceOptions).initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    // v3.7.0: `workflows.input_schema` moves into the workflow definitions.
    if (!(await hasWorkflowInputSchemaColumn(queryRunner))) {
      return;
    }

    await queryRunner.startTransaction();
    try {
      await moveWorkflowInputSchemasToDefinitions(
        queryRunner,
        new Logger('BeforeSynchronize'),
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
};

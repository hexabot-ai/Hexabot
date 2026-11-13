# Migration Module

The `migration` module for **Hexabot** provides a simple and effective way to manage database migrations powered by **TypeORM**. It allows you to create, execute, and roll back migrations, ensuring the database schema stays in sync with the version DB updates.

Whenever a new version is released which requires some DB updates, the `onApplicationBootstrap()` lifecycle hook
will apply migrations automatically when `config.database.autoMigrate` is enabled (by default this is true outside production, or when the environment variables opt-in).

## Features

- Generate timestamped migration files automatically in kebab-case.
- Track migration execution status in the relational `hexabot_migrations` table.
- Run individual or all migrations with ease.
- Built-in support for rollback logic.
- Keeps track of the database schema version in the metadata table (SettingModule).

## Usage

### Creating a Migration

To create a new migration:

```bash
pnpm --filter @hexabot-ai/api run cli migration create <version>
```

Replace `<version>` with the next version for your migration, such as `v3.0.1`.

Example:

```bash
pnpm --filter @hexabot-ai/api run cli migration create v3.0.1
```

This will generate a new file under `src/migration/migrations/` with a timestamped filename in kebab-case.

### Running Migrations

#### Running a Specific Migration

To execute a specific migration, use:

```bash
pnpm --filter @hexabot-ai/api run cli migration migrate up <version>
```

Example:

```bash
pnpm --filter @hexabot-ai/api run cli migration migrate up v3.0.1
```

#### Rolling Back a Specific Migration

To roll back a specific migration, use:

```bash
pnpm --filter @hexabot-ai/api run cli migration migrate down <version>
```

Example:

```bash
pnpm --filter @hexabot-ai/api run cli migration migrate down v3.0.1
```

#### Running All Migrations

To execute all pending migrations:

```bash
pnpm --filter @hexabot-ai/api run cli migration migrate up
```

#### Rolling Back All Migrations

To roll back all migrations:

```bash
pnpm --filter @hexabot-ai/api run cli migration migrate down
```

### Tracking Migration Status

The migration status is stored in the `hexabot_migrations` table managed by TypeORM. This table helps ensure that each migration is executed or rolled back only once, avoiding duplicate operations.

## Example Migration File

Below is an example migration file:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

import { MigrationServices } from '../types';

export default class Migration1700000000000_V2_2_0 implements MigrationInterface {
  name = 'Migration1700000000000_V2_2_0';

  public async up(
    queryRunner: QueryRunner,
    _services?: MigrationServices,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE attachment SET type = 'text/csv' WHERE type = 'csv'`,
    );
  }

  public async down(
    queryRunner: QueryRunner,
    _services?: MigrationServices,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE attachment SET type = 'csv' WHERE type = 'text/csv'`,
    );
  }
}
```

### Explanation

- **`up` Method**: Defines the operations to apply the migration (e.g., running SQL statements through the query runner).
- **`down` Method**: Defines the rollback logic to revert the migration.

## Moving data out of a column an entity no longer declares

With `DB_SYNCHRONIZE=true`, TypeORM aligns the tables with the entities when
the connection opens, which is before any migration runs. A column removed
from an entity is dropped at that point, with its content, so a migration
that moves this content elsewhere would find nothing left.

Write such a move as a step that checks by itself whether its work is still
to be done, and run it from two places:

- `runBeforeSynchronize` (`src/database/before-synchronize.ts`), which the
  application calls before it opens its connection when synchronizing is on;
- the migration, for the deployments that do not synchronize.

`src/migration/lib/workflow-input-schemas.ts` (v3.7.0) is the example to
follow. A step that fails stops the application from starting, so that
nothing is dropped before it succeeded.

## Best Practices

- Use semantic versioning (e.g., `v3.0.1`) for your migration names to keep track of changes systematically.
- Always test migrations in a development or staging environment before running them in production.
- Keep the `up` and `down` methods idempotent to avoid side effects from repeated execution.

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

import { MigrationServices } from '../types';

export default class Migration1782864000000_V_3_2_8
  implements MigrationInterface
{
  name = 'Migration1782864000000_V_3_2_8';

  public async up(
    queryRunner: QueryRunner,
    _services?: MigrationServices,
  ): Promise<void> {
    const hasPersonalTokens = await queryRunner.hasTable(
      'personal_access_tokens',
    );
    const hasMcpTokens = await queryRunner.hasTable('mcp_tokens');

    if (!hasPersonalTokens && hasMcpTokens) {
      await queryRunner.renameTable('mcp_tokens', 'personal_access_tokens');
    } else if (!hasPersonalTokens) {
      await queryRunner.createTable(
        new Table({
          name: 'personal_access_tokens',
          columns: [
            { name: 'id', type: 'varchar', isPrimary: true },
            {
              name: 'created_at',
              type: this.dateColumnType(queryRunner),
              isNullable: true,
            },
            {
              name: 'updated_at',
              type: this.dateColumnType(queryRunner),
              isNullable: true,
            },
            { name: 'name', type: 'varchar', isNullable: false },
            { name: 'token_hash', type: 'text', isNullable: false },
            {
              name: 'token_prefix',
              type: 'varchar',
              length: '32',
              isNullable: false,
            },
            {
              name: 'token_type',
              type: 'varchar',
              length: '16',
              isNullable: false,
              default: "'api'",
            },
            {
              name: 'scopes',
              type: this.jsonColumnType(queryRunner),
              isNullable: false,
              default: this.emptyJsonArrayDefault(queryRunner),
            },
            { name: 'owner_id', type: 'varchar', isNullable: false },
            {
              name: 'expires_at',
              type: this.dateColumnType(queryRunner),
              isNullable: true,
            },
            {
              name: 'last_used_at',
              type: this.dateColumnType(queryRunner),
              isNullable: true,
            },
            {
              name: 'revoked_at',
              type: this.dateColumnType(queryRunner),
              isNullable: true,
            },
          ],
        }),
      );
      await queryRunner.createForeignKey(
        'personal_access_tokens',
        new TableForeignKey({
          columnNames: ['owner_id'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }

    await this.ensureColumn(
      queryRunner,
      new TableColumn({
        name: 'token_type',
        type: 'varchar',
        length: '16',
        isNullable: false,
        default: "'mcp'",
      }),
    );
    await this.ensureColumn(
      queryRunner,
      new TableColumn({
        name: 'scopes',
        type: this.jsonColumnType(queryRunner),
        isNullable: false,
        default: this.emptyJsonArrayDefault(queryRunner),
      }),
    );
    await this.ensureIndex(
      queryRunner,
      new TableIndex({
        name: 'IDX_personal_access_tokens_token_hash',
        columnNames: ['token_hash'],
        isUnique: true,
      }),
    );
    await this.ensureIndex(
      queryRunner,
      new TableIndex({
        name: 'IDX_personal_access_tokens_owner',
        columnNames: ['owner_id'],
      }),
    );
    await this.ensureIndex(
      queryRunner,
      new TableIndex({
        name: 'IDX_personal_access_tokens_token_type',
        columnNames: ['token_type'],
      }),
    );
  }

  public async down(
    queryRunner: QueryRunner,
    _services?: MigrationServices,
  ): Promise<void> {
    const hasPersonalTokens = await queryRunner.hasTable(
      'personal_access_tokens',
    );
    if (!hasPersonalTokens) {
      return;
    }

    // If an `mcp_tokens` table already exists we cannot safely restore into it,
    // and dropping `personal_access_tokens` would silently discard the MCP
    // tokens it still holds. Bail out rather than lose data.
    if (await queryRunner.hasTable('mcp_tokens')) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'mcp_tokens',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          {
            name: 'created_at',
            type: this.dateColumnType(queryRunner),
            isNullable: true,
          },
          {
            name: 'updated_at',
            type: this.dateColumnType(queryRunner),
            isNullable: true,
          },
          { name: 'name', type: 'varchar', isNullable: false },
          { name: 'token_hash', type: 'text', isNullable: false },
          {
            name: 'token_prefix',
            type: 'varchar',
            length: '32',
            isNullable: false,
          },
          { name: 'owner_id', type: 'varchar', isNullable: false },
          {
            name: 'expires_at',
            type: this.dateColumnType(queryRunner),
            isNullable: true,
          },
          {
            name: 'last_used_at',
            type: this.dateColumnType(queryRunner),
            isNullable: true,
          },
          {
            name: 'revoked_at',
            type: this.dateColumnType(queryRunner),
            isNullable: true,
          },
        ],
      }),
    );
    await queryRunner.query(`
      INSERT INTO mcp_tokens (
        id, created_at, updated_at, name, token_hash, token_prefix,
        owner_id, expires_at, last_used_at, revoked_at
      )
      SELECT
        id, created_at, updated_at, name, token_hash, token_prefix,
        owner_id, expires_at, last_used_at, revoked_at
      FROM personal_access_tokens
      WHERE token_type = 'mcp'
    `);

    await queryRunner.dropTable('personal_access_tokens');
  }

  private async ensureColumn(
    queryRunner: QueryRunner,
    column: TableColumn,
  ): Promise<void> {
    const hasColumn = await queryRunner.hasColumn(
      'personal_access_tokens',
      column.name,
    );
    if (!hasColumn) {
      await queryRunner.addColumn('personal_access_tokens', column);
    }
  }

  private async ensureIndex(
    queryRunner: QueryRunner,
    index: TableIndex,
  ): Promise<void> {
    const table = await queryRunner.getTable('personal_access_tokens');
    const exists = table?.indices.some((candidate) =>
      this.hasSameColumns(candidate, index),
    );

    if (!exists) {
      await queryRunner.createIndex('personal_access_tokens', index);
    }
  }

  private hasSameColumns(left: TableIndex, right: TableIndex): boolean {
    return (
      left.columnNames.length === right.columnNames.length &&
      left.columnNames.every(
        (column, index) => column === right.columnNames[index],
      )
    );
  }

  private dateColumnType(queryRunner: QueryRunner): string {
    return queryRunner.connection.options.type === 'postgres'
      ? 'timestamptz'
      : 'datetime';
  }

  private jsonColumnType(queryRunner: QueryRunner): string {
    return queryRunner.connection.options.type === 'postgres' ? 'json' : 'text';
  }

  private emptyJsonArrayDefault(queryRunner: QueryRunner): string {
    return queryRunner.connection.options.type === 'postgres'
      ? "'[]'::json"
      : "'[]'";
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  AuditLogService as SdkAuditLogService,
  IAuditLog,
} from 'nestjs-auditlog';
import {
  DataSource,
  EntityMetadata,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  ObjectLiteral,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';

import { config } from '@/config';
import { registerOrmSubscriber } from '@/database/register-orm-subscriber';

import { getAuditLabelProperty } from '../decorators/audit-label.decorator';
import { AuditContextService } from '../services/audit-context.service';

type AuditOperation = 'Create' | 'Update' | 'Remove';
type LabeledAuditLog = IAuditLog & {
  resource: IAuditLog['resource'] & { label?: string };
  actor: IAuditLog['actor'] & { label?: string };
};

const INTERNAL_TABLES = new Set([
  'audit_logs',
  'migrations',
  'sessions',
  'stats',
]);
const UNKNOWN_VALUE = 'unknown';

@Injectable()
@EventSubscriber()
export class AuditLogSubscriber implements EntitySubscriberInterface {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLogService: SdkAuditLogService,
    private readonly auditContext: AuditContextService,
  ) {
    registerOrmSubscriber(this.dataSource, this);
  }

  private shouldSkip(metadata: EntityMetadata): boolean {
    return !config.audit.enabled || INTERNAL_TABLES.has(metadata.tableName);
  }

  async afterInsert(event: InsertEvent<ObjectLiteral>): Promise<void> {
    await this.record('Create', event, undefined, event.entity);
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    await this.record(
      'Update',
      event,
      event.databaseEntity,
      event.entity as ObjectLiteral | undefined,
    );
  }

  async afterRemove(event: RemoveEvent<ObjectLiteral>): Promise<void> {
    await this.record(
      'Remove',
      event,
      event.databaseEntity ?? event.entity,
      undefined,
    );
  }

  private async record(
    operation: AuditOperation,
    event:
      | InsertEvent<ObjectLiteral>
      | UpdateEvent<ObjectLiteral>
      | RemoveEvent<ObjectLiteral>,
    before?: ObjectLiteral,
    after?: ObjectLiteral,
  ): Promise<void> {
    if (this.shouldSkip(event.metadata)) {
      return;
    }

    const beforeData = this.toAuditData(event.metadata, before);
    const afterData = this.toAuditData(event.metadata, after);
    const resourceLabel =
      this.getResourceLabel(event.metadata, afterData) ??
      this.getResourceLabel(event.metadata, beforeData);
    const auditLog = this.buildAuditLog(
      operation,
      event,
      beforeData,
      afterData,
      resourceLabel,
    );

    await this.auditLogService.sendAuditLog(auditLog);
  }

  private buildAuditLog(
    operation: AuditOperation,
    event:
      | InsertEvent<ObjectLiteral>
      | UpdateEvent<ObjectLiteral>
      | RemoveEvent<ObjectLiteral>,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
    resourceLabel?: string,
  ): IAuditLog {
    const context = this.auditContext.getContext();
    const resourceId =
      this.getResourceId(event, before) ?? this.getResourceId(event, after);
    const entityName = this.getEntityName(event.metadata);
    const auditLog: LabeledAuditLog = {
      resource: {
        id: resourceId ?? UNKNOWN_VALUE,
        type: entityName,
        ...(resourceLabel ? { label: resourceLabel } : {}),
      },
      operation: {
        id: `typeorm.${entityName}.${operation.toLowerCase()}`,
        type: operation,
        status: 'SUCCEEDED',
      },
      actor: {
        id: context.actorId ?? 'system',
        type: context.actorType ?? 'system',
        ...(context.actorLabel ? { label: context.actorLabel } : {}),
        ip: context.ip,
        agent: context.userAgent,
      },
      data_diff: {
        before: before ?? null,
        after: after ?? null,
        diff: this.diff(before, after),
      },
    };

    return auditLog;
  }

  private getEntityName(metadata: EntityMetadata): string {
    return (metadata.targetName || metadata.name || metadata.tableName).replace(
      /OrmEntity$/,
      '',
    );
  }

  private getResourceId(
    event:
      | InsertEvent<ObjectLiteral>
      | UpdateEvent<ObjectLiteral>
      | RemoveEvent<ObjectLiteral>,
    data?: Record<string, unknown>,
  ): string | undefined {
    const eventId = 'entityId' in event ? event.entityId : undefined;

    if (typeof eventId === 'string') {
      return eventId;
    }

    if (eventId && typeof eventId === 'object') {
      return JSON.stringify(eventId);
    }

    const primaryColumn = event.metadata.primaryColumns[0]?.propertyName;
    const primaryValue = primaryColumn ? data?.[primaryColumn] : undefined;

    return primaryValue === undefined ? undefined : String(primaryValue);
  }

  private getResourceLabel(
    metadata: EntityMetadata,
    data?: Record<string, unknown>,
  ): string | undefined {
    const labelProperty = getAuditLabelProperty(metadata);
    if (!labelProperty) {
      return undefined;
    }

    return this.toLabel(data?.[labelProperty]);
  }

  private toLabel(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();

      return trimmed.length > 0 ? trimmed : undefined;
    }

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }

    return undefined;
  }

  private toAuditData(
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
  ): Record<string, unknown> | undefined {
    if (!entity) {
      return undefined;
    }

    const result: Record<string, unknown> = {};

    for (const column of metadata.columns) {
      const value = column.getEntityValue(entity);
      if (value !== undefined) {
        result[column.propertyName] = this.normalizeValue(
          column.propertyName,
          value,
        );
      }
    }

    for (const relation of metadata.relations) {
      const value = relation.getEntityValue(entity);
      if (value !== undefined) {
        result[relation.propertyName] = this.normalizeValue(
          relation.propertyName,
          value,
        );
      }
    }

    return this.cloneJson(result);
  }

  private normalizeValue(field: string, value: unknown): unknown {
    if (this.isMaskedField(field)) {
      return '[REDACTED]';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeValue(field, entry));
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string') {
        return record.id;
      }

      return Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          this.normalizeValue(key, entry),
        ]),
      );
    }

    return value;
  }

  private isMaskedField(field: string): boolean {
    const normalized = field.toLowerCase();

    return config.audit.maskFields.some(
      (maskedField) => maskedField.toLowerCase() === normalized,
    );
  }

  private diff(
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Record<string, { before: unknown; after: unknown }> | null {
    if (!before && !after) {
      return null;
    }

    const keys = new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ]);
    const changes: Record<string, { before: unknown; after: unknown }> = {};

    for (const key of keys) {
      const previousValue = before?.[key];
      const nextValue = after?.[key];
      if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
        changes[key] = {
          before: previousValue ?? null,
          after: nextValue ?? null,
        };
      }
    }

    return Object.keys(changes).length ? changes : null;
  }

  private cloneJson(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }
}

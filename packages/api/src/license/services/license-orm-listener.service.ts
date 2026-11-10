/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  FindOptionsWhere,
  InsertEvent,
  ObjectLiteral,
} from 'typeorm';

import { registerOrmSubscriber } from '@/database/register-orm-subscriber';
import { UserOrmEntity } from '@/user/entities/user.entity';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';

import {
  LICENSE_QUOTA_LIMITS,
  LICENSE_QUOTA_RESOURCE_NAMES,
  LicenseQuotaResource,
  LicenseQuotaTier,
  resolveLicenseQuotaTier,
} from '../types/license-quota';

import { LicenseService } from './license.service';

type InsertLimitRule<Entity extends ObjectLiteral = ObjectLiteral> = {
  target: new (...args: any[]) => Entity;
  resource: LicenseQuotaResource;
  buildWhere?: (
    event: InsertEvent<Entity>,
  ) => FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[] | undefined;
};

@Injectable()
@EventSubscriber()
export class LicenseOrmListener implements EntitySubscriberInterface {
  private readonly rules: readonly InsertLimitRule[] = [
    {
      target: UserOrmEntity,
      resource: 'users',
    },
    {
      target: WorkflowOrmEntity,
      resource: 'workflows',
    },
  ];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly licenseService: LicenseService,
  ) {
    registerOrmSubscriber(this.dataSource, this);
  }

  private resolveRule(
    event: InsertEvent<ObjectLiteral>,
  ): InsertLimitRule | undefined {
    const targetName = event.metadata.targetName ?? event.metadata.name;

    return this.rules.find(
      (rule) =>
        rule.target === event.metadata.target ||
        (typeof rule.target === 'function' && rule.target.name === targetName),
    );
  }

  private buildLimitMessage(
    resource: LicenseQuotaResource,
    tier: LicenseQuotaTier,
    limit: number,
  ): string {
    const resourceName = LICENSE_QUOTA_RESOURCE_NAMES[resource];
    const resourceWithCardinality = limit === 1 ? resourceName : resource;

    return `Cannot create ${resourceName}: ${tier} plan allows up to ${limit} ${resourceWithCardinality}.`;
  }

  async beforeInsert(event: InsertEvent<ObjectLiteral>): Promise<void> {
    const rule = this.resolveRule(event);

    if (!rule) {
      return;
    }

    const tier = resolveLicenseQuotaTier(
      this.licenseService.getStatus(),
      this.licenseService.getPlan(),
    );
    const limit = LICENSE_QUOTA_LIMITS[rule.resource][tier];

    if (typeof limit !== 'number') {
      return;
    }

    const where = rule.buildWhere?.(event as InsertEvent<any>);
    const currentCount = await event.manager.count(
      rule.target as any,
      where ? ({ where } as any) : undefined,
    );

    if (currentCount >= limit) {
      throw new ForbiddenException(
        this.buildLimitMessage(rule.resource, tier, limit),
      );
    }
  }
}

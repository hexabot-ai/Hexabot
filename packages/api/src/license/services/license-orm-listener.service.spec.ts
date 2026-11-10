/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ForbiddenException } from '@nestjs/common';
import { DataSource, InsertEvent, ObjectLiteral } from 'typeorm';

import { registerOrmSubscriber } from '@/database/register-orm-subscriber';
import { UserOrmEntity } from '@/user/entities/user.entity';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';

import { LicensePlan, LicenseStatus } from '../types/license-feature.enum';
import { LICENSE_QUOTA_LIMITS } from '../types/license-quota';

import { LicenseOrmListener } from './license-orm-listener.service';
import { LicenseService } from './license.service';

type ListenerTestEnv = {
  listener: LicenseOrmListener;
  dataSource: DataSource;
  licenseService: Pick<LicenseService, 'getStatus' | 'getPlan'>;
};

const createLicenseServiceMock = (
  status: LicenseStatus,
  plan: LicensePlan,
): Pick<LicenseService, 'getStatus' | 'getPlan'> => ({
  getStatus: jest.fn().mockReturnValue(status),
  getPlan: jest.fn().mockReturnValue(plan),
});
const createListener = (
  status: LicenseStatus,
  plan: LicensePlan,
): ListenerTestEnv => {
  const dataSource = {
    subscribers: [],
  } as unknown as DataSource;
  const licenseService = createLicenseServiceMock(status, plan);
  const listener = new LicenseOrmListener(
    dataSource,
    licenseService as LicenseService,
  );

  return {
    listener,
    dataSource,
    licenseService,
  };
};
const createInsertEvent = <Entity extends ObjectLiteral>(
  target: new (...args: any[]) => Entity,
  count: number,
): {
  event: InsertEvent<Entity>;
  manager: { count: jest.Mock };
} => {
  const manager = {
    count: jest.fn().mockResolvedValue(count),
  };
  const event = {
    metadata: {
      target,
      targetName: target.name,
      name: target.name,
    },
    manager,
  } as unknown as InsertEvent<Entity>;

  return { event, manager };
};
const withCardinality = (name: string, limit: number) =>
  limit === 1 ? name : `${name}s`;
const expectNumericLimit = (limit: number | null): number => {
  if (typeof limit !== 'number') {
    throw new Error('Expected numeric quota limit in test.');
  }

  return limit;
};

describe('LicenseOrmListener', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('registers itself once in datasource subscribers', () => {
    const { listener, dataSource } = createListener('active', 'pro');

    expect(dataSource.subscribers).toEqual([listener]);

    registerOrmSubscriber(dataSource, listener);

    expect(dataSource.subscribers).toHaveLength(1);
  });

  it('ignores entities without a configured insert rule', async () => {
    class DummyOrmEntity {}

    const { listener } = createListener('active', 'pro');
    const { event, manager } = createInsertEvent(DummyOrmEntity, 999);

    await expect(listener.beforeInsert(event)).resolves.toBeUndefined();
    expect(manager.count).not.toHaveBeenCalled();
  });

  it('blocks user creation at community limit', async () => {
    const limit = expectNumericLimit(LICENSE_QUOTA_LIMITS.users.community);
    const { listener } = createListener('inactive', 'unlimited');
    const { event } = createInsertEvent(UserOrmEntity, limit);

    await expect(listener.beforeInsert(event)).rejects.toThrow(
      new ForbiddenException(
        `Cannot create user: community plan allows up to ${limit} ${withCardinality('user', limit)}.`,
      ),
    );
  });

  it('blocks workflow creation at community limit', async () => {
    const limit = expectNumericLimit(LICENSE_QUOTA_LIMITS.workflows.community);
    const { listener } = createListener('inactive', 'unlimited');
    const { event } = createInsertEvent(WorkflowOrmEntity, limit);

    await expect(listener.beforeInsert(event)).rejects.toThrow(
      new ForbiddenException(
        `Cannot create workflow: community plan allows up to ${limit} ${withCardinality('workflow', limit)}.`,
      ),
    );
  });

  it.each([
    ['starter', expectNumericLimit(LICENSE_QUOTA_LIMITS.users.starter)],
    ['pro', expectNumericLimit(LICENSE_QUOTA_LIMITS.users.pro)],
    ['unlimited', expectNumericLimit(LICENSE_QUOTA_LIMITS.users.unlimited)],
  ] as const)('enforces %s user limit at %d', async (plan, limit) => {
    const { listener } = createListener('active', plan);
    const { event, manager } = createInsertEvent(UserOrmEntity, limit);

    await expect(listener.beforeInsert(event)).rejects.toThrow(
      new ForbiddenException(
        `Cannot create user: ${plan} plan allows up to ${limit} ${withCardinality('user', limit)}.`,
      ),
    );
    expect(manager.count).toHaveBeenCalledWith(UserOrmEntity, undefined);
  });

  it.each([
    ['starter', expectNumericLimit(LICENSE_QUOTA_LIMITS.workflows.starter)],
    ['pro', expectNumericLimit(LICENSE_QUOTA_LIMITS.workflows.pro)],
  ] as const)('enforces %s workflow limit at %d', async (plan, limit) => {
    const { listener } = createListener('active', plan);
    const { event, manager } = createInsertEvent(WorkflowOrmEntity, limit);

    await expect(listener.beforeInsert(event)).rejects.toThrow(
      new ForbiddenException(
        `Cannot create workflow: ${plan} plan allows up to ${limit} ${withCardinality('workflow', limit)}.`,
      ),
    );
    expect(manager.count).toHaveBeenCalledWith(WorkflowOrmEntity, undefined);
  });

  it('does not cap workflows on unlimited plan', async () => {
    const { listener } = createListener('active', 'unlimited');
    const { event, manager } = createInsertEvent(WorkflowOrmEntity, 10_000);

    await expect(listener.beforeInsert(event)).resolves.toBeUndefined();
    expect(manager.count).not.toHaveBeenCalled();
  });

  it.each([
    'inactive',
    'expired',
    'disabled',
    'invalid',
    'undefined',
    'error',
  ] as const)(
    'resolves %s license status to community tier',
    async (status: LicenseStatus) => {
      const limit = expectNumericLimit(LICENSE_QUOTA_LIMITS.users.community);
      const { listener } = createListener(status, 'unlimited');
      const { event } = createInsertEvent(UserOrmEntity, limit);

      await expect(listener.beforeInsert(event)).rejects.toThrow(
        new ForbiddenException(
          `Cannot create user: community plan allows up to ${limit} ${withCardinality('user', limit)}.`,
        ),
      );
    },
  );

  it('resolves active unknown plan to community tier', async () => {
    const limit = expectNumericLimit(LICENSE_QUOTA_LIMITS.users.community);
    const { listener, licenseService } = createListener('active', 'unknown');
    const { event, manager } = createInsertEvent(UserOrmEntity, limit);

    await expect(listener.beforeInsert(event)).rejects.toThrow(
      new ForbiddenException(
        `Cannot create user: community plan allows up to ${limit} ${withCardinality('user', limit)}.`,
      ),
    );
    expect(manager.count).toHaveBeenCalledWith(UserOrmEntity, undefined);
    expect(licenseService.getStatus).toHaveBeenCalled();
    expect(licenseService.getPlan).toHaveBeenCalled();
  });
});

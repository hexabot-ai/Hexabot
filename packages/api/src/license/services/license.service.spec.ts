/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SettingOrmEntity } from '@/setting/entities/setting.entity';
import { UserOrmEntity } from '@/user/entities/user.entity';
import { UpdateEntityEvent } from '@/utils/types/entity-event.types';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';

import {
  LemonSqueezyActivationResponse,
  LemonSqueezyValidationResponse,
} from '../types/lemon-squeezy.types';
import { LicenseFeature } from '../types/license-feature.enum';
import { LicenseQuotaTier } from '../types/license-quota';

import { LicenseService } from './license.service';

type MockSettingService = {
  getSettings: jest.Mock;
  clearCache: jest.Mock;
};

type MockMetadataService = {
  findOne: jest.Mock;
  deleteOne: jest.Mock;
  updateOne: jest.Mock;
};

type MockLemonSqueezyService = {
  validate: jest.Mock;
  activate: jest.Mock;
  deactivate: jest.Mock;
  extractAxiosError: jest.Mock;
};

type MockLoggerService = {
  debug: jest.Mock;
  error: jest.Mock;
  warn: jest.Mock;
  verbose: jest.Mock;
};

type ServiceEnv = {
  service: LicenseService;
  apiService: MockLemonSqueezyService;
  settingService: MockSettingService;
  metadataService: MockMetadataService;
  logger: MockLoggerService;
  dataSource: DataSource;
};

type CreateEnvOptions = {
  apiService?: Partial<MockLemonSqueezyService>;
  settingService?: Partial<MockSettingService>;
  metadataService?: Partial<MockMetadataService>;
  logger?: Partial<MockLoggerService>;
  userCount?: number;
  workflowCount?: number;
};

const buildExpectedQuotas = (
  tier: LicenseQuotaTier,
  counts: { users?: number; workflows?: number } = {},
) => {
  const usersUsed = counts.users ?? 0;
  const workflowsUsed = counts.workflows ?? 0;
  const usersLimitByTier: Record<LicenseQuotaTier, number | null> = {
    community: 1,
    starter: 1,
    pro: 10,
    unlimited: 25,
  };
  const workflowsLimitByTier: Record<LicenseQuotaTier, number | null> = {
    community: 10,
    starter: 25,
    pro: 150,
    unlimited: null,
  };
  const usersLimit = usersLimitByTier[tier];
  const workflowsLimit = workflowsLimitByTier[tier];

  return {
    tier,
    resources: {
      users: {
        limit: usersLimit,
        used: usersUsed,
        remaining:
          typeof usersLimit === 'number'
            ? Math.max(usersLimit - usersUsed, 0)
            : null,
        reached:
          typeof usersLimit === 'number' ? usersUsed >= usersLimit : false,
      },
      workflows: {
        limit: workflowsLimit,
        used: workflowsUsed,
        remaining:
          typeof workflowsLimit === 'number'
            ? Math.max(workflowsLimit - workflowsUsed, 0)
            : null,
        reached:
          typeof workflowsLimit === 'number'
            ? workflowsUsed >= workflowsLimit
            : false,
      },
    },
  };
};
const defaultLicenseKey = {
  id: 123,
  status: 'active' as const,
  key: 'key_123',
  activation_limit: 10,
  activation_usage: 1,
  created_at: '2024-01-01',
  expires_at: null,
};
const defaultInstance = {
  id: 'instance-1',
  name: 'Hexabot',
  created_at: '2024-01-01',
};
const defaultMeta = {
  store_id: 1,
  order_id: 2,
  order_item_id: 3,
  product_id: 4,
  product_name: 'Pro Plan',
  variant_id: 5,
  variant_name: 'Pro',
  customer_id: 6,
  customer_name: 'Hexa',
  customer_email: 'hexabot@example.com',
};
const createValidationResponse = (
  overrides: Partial<LemonSqueezyValidationResponse> = {},
): LemonSqueezyValidationResponse => ({
  valid: true,
  error: null,
  license_key: {
    ...defaultLicenseKey,
    ...(overrides.license_key ?? {}),
  },
  instance: overrides.instance ?? defaultInstance,
  meta: overrides.meta ?? defaultMeta,
  ...overrides,
});
const createActivationResponse = (
  overrides: Partial<LemonSqueezyActivationResponse> = {},
): LemonSqueezyActivationResponse => ({
  activated: true,
  error: null,
  license_key: {
    ...defaultLicenseKey,
    ...(overrides.license_key ?? {}),
  },
  instance: overrides.instance ?? defaultInstance,
  meta: overrides.meta ?? defaultMeta,
  ...overrides,
});
const createSettingUpdateEvent = ({
  oldValue,
  newValue,
  group = 'global_settings',
  label = 'license_key',
}: {
  oldValue?: unknown;
  newValue?: unknown;
  group?: string;
  label?: string;
}) => {
  const databaseEntity = Object.assign(new SettingOrmEntity(), {
    group,
    label,
    value: oldValue,
  });
  const entity = Object.assign(new SettingOrmEntity(), {
    group,
    label,
    value: newValue,
  });

  return {
    databaseEntity,
    entity,
  } as unknown as UpdateEntityEvent<SettingOrmEntity>;
};
const createEnv = (overrides: CreateEnvOptions = {}): ServiceEnv => {
  const apiService: MockLemonSqueezyService = {
    validate: jest.fn(),
    activate: jest.fn(),
    deactivate: jest.fn(),
    extractAxiosError: jest
      .fn()
      .mockImplementation((err) => (err instanceof Error ? err.message : err)),
    ...overrides.apiService,
  };
  const settingService: MockSettingService = {
    getSettings: jest.fn().mockResolvedValue({ global_settings: {} }),
    clearCache: jest.fn().mockResolvedValue(undefined),
    ...overrides.settingService,
  };
  const metadataService: MockMetadataService = {
    findOne: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest
      .fn()
      .mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
    updateOne: jest.fn().mockResolvedValue({}),
    ...overrides.metadataService,
  };
  const logger: MockLoggerService = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    verbose: jest.fn(),
    ...overrides.logger,
  };
  const userCount = overrides.userCount ?? 0;
  const workflowCount = overrides.workflowCount ?? 0;
  const userRepository = {
    count: jest.fn().mockResolvedValue(userCount),
  };
  const workflowRepository = {
    count: jest.fn().mockResolvedValue(workflowCount),
  };
  const dataSource = {
    getRepository: jest.fn((target: unknown) => {
      if (target === UserOrmEntity) {
        return userRepository;
      }

      if (target === WorkflowOrmEntity) {
        return workflowRepository;
      }

      return {
        count: jest.fn().mockResolvedValue(0),
      };
    }),
  } as unknown as DataSource;
  const service = new LicenseService(
    apiService as unknown as any,
    settingService as unknown as any,
    metadataService as unknown as any,
    logger as unknown as any,
    dataSource,
  );

  return {
    service,
    apiService,
    settingService,
    metadataService,
    logger,
    dataSource,
  };
};

describe('LicenseService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('refresh', () => {
    it('starts with all features disabled', () => {
      const { service } = createEnv();

      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(false);
    });

    it('marks state as undefined when no license key is stored', async () => {
      const { service } = createEnv();

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'undefined',
        plan: 'unknown',
        activationLimit: null,
        activationUsage: null,
        lastError: 'No license key set (bootstrap).',
        quotas: buildExpectedQuotas('community'),
      });
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(false);
    });

    it('marks state invalid when validation fails', async () => {
      const { service, settingService, apiService } = createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'invalid-key' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({ valid: false, license_key: null }),
      );

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'invalid',
        plan: 'unknown',
        activationLimit: null,
        activationUsage: null,
        lastError: 'Invalid license key (bootstrap).',
        quotas: buildExpectedQuotas('community'),
      });
    });

    it('marks state expired when the license has expired', async () => {
      const { service, settingService, apiService } = createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'expired-key' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'expired',
            id: 0,
            key: 'expired-key',
            activation_limit: null,
            activation_usage: null,
            created_at: '',
            expires_at: null,
          },
          meta: {
            ...defaultMeta,
            product_name: 'Unlimited Plan',
          },
        }),
      );

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'expired',
        plan: 'unlimited',
        activationLimit: null,
        activationUsage: null,
        lastError: 'License key expired (bootstrap).',
        quotas: buildExpectedQuotas('community'),
      });
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(false);
    });

    it('marks state disabled when the license has been disabled', async () => {
      const { service, settingService, apiService } = createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'disabled-key' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'disabled',
            id: 0,
            key: 'disabled-key',
            activation_limit: null,
            activation_usage: null,
            created_at: '',
            expires_at: null,
          },
        }),
      );

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'disabled',
        plan: 'pro',
        activationLimit: null,
        activationUsage: null,
        lastError: 'License key disabled (bootstrap).',
        quotas: buildExpectedQuotas('community'),
      });
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(false);
    });

    it('activates a pro license and enables user management', async () => {
      const { service, settingService, apiService, metadataService } =
        createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'active-key' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          meta: {
            ...defaultMeta,
            product_name: 'Pro Annual',
          },
        }),
      );

      await service.refresh('bootstrap');

      expect(metadataService.updateOne).toHaveBeenCalledWith(
        { where: { name: 'instance_id' } },
        { name: 'instance_id', value: defaultInstance.id },
      );
      expect(service.getStatus()).toBe('active');
      expect(service.getPlan()).toBe('pro');
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(true);
    });

    it('keeps user management disabled for starter plan', async () => {
      const { service, settingService, apiService } = createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'starter-key' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          meta: {
            ...defaultMeta,
            product_name: 'Starter Monthly',
          },
        }),
      );

      await service.refresh('bootstrap');

      expect(service.getStatus()).toBe('active');
      expect(service.getPlan()).toBe('starter');
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(false);
    });

    it('includes pro quotas in snapshot when license is active', async () => {
      const { service, settingService, apiService } = createEnv({
        userCount: 9,
        workflowCount: 150,
      });
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'active-pro' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          meta: {
            ...defaultMeta,
            product_name: 'Pro Monthly',
          },
        }),
      );

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'active',
        plan: 'pro',
        activationLimit: 10,
        activationUsage: 1,
        lastError: null,
        quotas: buildExpectedQuotas('pro', { users: 9, workflows: 150 }),
      });
    });

    it('resolves active unknown plan to community quota tier', async () => {
      const { service, settingService, apiService } = createEnv({
        userCount: 1,
        workflowCount: 2,
      });
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'active-unknown' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          meta: {
            ...defaultMeta,
            product_name: 'Enterprise Plan',
          },
        }),
      );

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'active',
        plan: 'unknown',
        activationLimit: 10,
        activationUsage: 1,
        lastError: null,
        quotas: buildExpectedQuotas('community', {
          users: 1,
          workflows: 2,
        }),
      });
    });

    it('keeps unlimited workflow quota uncapped in snapshot', async () => {
      const { service, settingService, apiService } = createEnv({
        userCount: 24,
        workflowCount: 600,
      });
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'active-unlimited' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          meta: {
            ...defaultMeta,
            product_name: 'Unlimited Plan',
          },
        }),
      );

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'active',
        plan: 'unlimited',
        activationLimit: 10,
        activationUsage: 1,
        lastError: null,
        quotas: buildExpectedQuotas('unlimited', {
          users: 24,
          workflows: 600,
        }),
      });
    });

    it('activates through API when status is inactive and slots are available', async () => {
      const { service, settingService, apiService, metadataService } =
        createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'to-activate' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'inactive',
            activation_limit: 3,
            activation_usage: 1,
            id: 0,
            key: 'to-activate',
            created_at: '',
            expires_at: null,
          },
          instance: null,
          meta: {
            ...defaultMeta,
            product_name: 'Unlimited Plan',
          },
        }),
      );
      apiService.activate.mockResolvedValue(
        createActivationResponse({
          license_key: {
            status: 'active',
            activation_limit: 3,
            activation_usage: 2,
            id: 0,
            key: 'to-activate',
            created_at: '',
            expires_at: null,
          },
          meta: {
            ...defaultMeta,
            product_name: 'Unlimited Plan',
          },
        }),
      );

      await service.refresh('bootstrap');

      expect(apiService.activate).toHaveBeenCalledWith('to-activate');
      expect(metadataService.updateOne).toHaveBeenCalledWith(
        { where: { name: 'instance_id' } },
        { name: 'instance_id', value: defaultInstance.id },
      );
      expect(service.getStatus()).toBe('active');
      expect(service.getPlan()).toBe('unlimited');
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(true);
    });

    it('stores an error when activation slots are exhausted', async () => {
      const { service, settingService, apiService } = createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'full' },
      });
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'inactive',
            activation_limit: 1,
            activation_usage: 1,
            id: 0,
            key: 'full',
            created_at: '',
            expires_at: null,
          },
          instance: null,
        }),
      );

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'inactive',
        plan: 'pro',
        activationLimit: null,
        activationUsage: null,
        lastError: 'Activation limit reached during bootstrap (usage=1/1).',
        quotas: buildExpectedQuotas('community'),
      });
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(false);
    });

    it('uses Axios extractor when refresh throws', async () => {
      const { service, settingService, apiService } = createEnv();
      settingService.getSettings.mockResolvedValueOnce({
        global_settings: { license_key: 'network' },
      });
      apiService.extractAxiosError.mockReturnValue('Detailed');
      apiService.validate.mockRejectedValue(new Error('fail'));

      await service.refresh('bootstrap');

      await expect(service.getSnapshot()).resolves.toEqual({
        status: 'error',
        plan: 'unknown',
        activationLimit: null,
        activationUsage: null,
        lastError: 'Bootstrap failed: Detailed',
        quotas: buildExpectedQuotas('community'),
      });
    });
  });

  describe('handleLicenseKeyUpdate', () => {
    it('ignores non-license settings', async () => {
      const { service, apiService } = createEnv();

      await service.handleLicenseKeyUpdate(
        createSettingUpdateEvent({
          oldValue: 'old',
          newValue: 'new',
          group: 'other',
          label: 'other',
        }),
      );

      expect(apiService.validate).not.toHaveBeenCalled();
    });

    it('deactivates old key when removing a license key', async () => {
      const { service } = createEnv();
      const deactivateSpy = jest
        .spyOn(service, 'deactivate')
        .mockResolvedValue(true);

      await service.handleLicenseKeyUpdate(
        createSettingUpdateEvent({ oldValue: 'old-key', newValue: '' }),
      );

      expect(deactivateSpy).toHaveBeenCalledWith(
        'old-key',
        'License key removed.',
      );
      expect(service.getStatus()).toBe('undefined');
      expect(service.getPlan()).toBe('unknown');
      expect(service.getLastError()).toBe('No license key set.');
    });

    it('rejects removal when deactivation fails', async () => {
      const { service } = createEnv();
      jest.spyOn(service, 'deactivate').mockResolvedValue(false);

      await expect(
        service.handleLicenseKeyUpdate(
          createSettingUpdateEvent({ oldValue: 'old-key', newValue: '' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refreshes state when key does not change', async () => {
      const { service } = createEnv();
      const refreshSpy = jest
        .spyOn(service, 'refresh')
        .mockResolvedValue(undefined);

      await service.handleLicenseKeyUpdate(
        createSettingUpdateEvent({
          oldValue: 'same-key',
          newValue: 'same-key',
        }),
      );

      expect(refreshSpy).toHaveBeenCalledWith('setting');
    });

    it('rejects invalid license keys', async () => {
      const { service, apiService } = createEnv();
      apiService.validate.mockResolvedValue(
        createValidationResponse({ valid: false, license_key: null }),
      );

      await expect(
        service.handleLicenseKeyUpdate(
          createSettingUpdateEvent({
            oldValue: 'old-key',
            newValue: 'new-key',
          }),
        ),
      ).rejects.toThrow('Invalid license key.');
    });

    it('updates runtime state with clear error when first key is invalid', async () => {
      const { service, apiService } = createEnv();
      apiService.validate.mockResolvedValue(
        createValidationResponse({ valid: false, license_key: null }),
      );

      await expect(
        service.handleLicenseKeyUpdate(
          createSettingUpdateEvent({
            oldValue: undefined,
            newValue: 'invalid-key',
          }),
        ),
      ).rejects.toThrow('Invalid license key.');

      expect(service.getStatus()).toBe('invalid');
      expect(service.getLastError()).toBe('Invalid license key.');
    });

    it('rejects rotation when old license deactivation fails', async () => {
      const { service, apiService } = createEnv();
      jest.spyOn(service, 'deactivate').mockResolvedValue(false);
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'inactive',
            activation_limit: 5,
            activation_usage: 0,
            id: 0,
            key: 'new-key',
            created_at: '',
            expires_at: null,
          },
          instance: null,
        }),
      );

      await expect(
        service.handleLicenseKeyUpdate(
          createSettingUpdateEvent({
            oldValue: 'old-key',
            newValue: 'new-key',
          }),
        ),
      ).rejects.toThrow(
        'Failed to deactivate existing license key before rotation.',
      );
      expect(apiService.activate).not.toHaveBeenCalled();
    });

    it('sets a new license key when there is no previous key', async () => {
      const { service, apiService, metadataService } = createEnv();
      const deactivateSpy = jest.spyOn(service, 'deactivate');
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'inactive',
            activation_limit: 5,
            activation_usage: 0,
            id: 0,
            key: 'new-key',
            created_at: '',
            expires_at: null,
          },
          instance: null,
        }),
      );
      apiService.activate.mockResolvedValue(
        createActivationResponse({
          license_key: {
            status: 'active',
            activation_limit: 5,
            activation_usage: 1,
            id: 0,
            key: 'new-key',
            created_at: '',
            expires_at: null,
          },
        }),
      );

      await service.handleLicenseKeyUpdate(
        createSettingUpdateEvent({
          oldValue: undefined,
          newValue: 'new-key',
        }),
      );

      expect(deactivateSpy).not.toHaveBeenCalled();
      expect(metadataService.updateOne).toHaveBeenCalledWith(
        { where: { name: 'instance_id' } },
        { name: 'instance_id', value: defaultInstance.id },
      );
      expect(service.getStatus()).toBe('active');
      expect(service.getPlan()).toBe('pro');
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(true);
    });

    it('rotates to a valid key and applies activated state', async () => {
      const { service, apiService, metadataService } = createEnv();
      jest.spyOn(service, 'deactivate').mockResolvedValue(true);
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'inactive',
            activation_limit: 5,
            activation_usage: 2,
            id: 0,
            key: 'new-key',
            created_at: '',
            expires_at: null,
          },
          instance: null,
        }),
      );
      apiService.activate.mockResolvedValue(
        createActivationResponse({
          license_key: {
            status: 'active',
            activation_limit: 5,
            activation_usage: 3,
            id: 0,
            key: 'new-key',
            created_at: '',
            expires_at: null,
          },
          meta: {
            ...defaultMeta,
            product_name: 'Pro Plan',
          },
        }),
      );

      await service.handleLicenseKeyUpdate(
        createSettingUpdateEvent({ oldValue: 'old-key', newValue: 'new-key' }),
      );

      expect(apiService.activate).toHaveBeenCalledWith('new-key');
      expect(metadataService.updateOne).toHaveBeenCalledWith(
        { where: { name: 'instance_id' } },
        { name: 'instance_id', value: defaultInstance.id },
      );
      expect(service.getStatus()).toBe('active');
      expect(service.hasFeature(LicenseFeature.UserManagement)).toBe(true);
    });

    it('tries to restore old key when activation of new key fails', async () => {
      const { service, apiService } = createEnv();
      jest.spyOn(service, 'deactivate').mockResolvedValue(true);
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'inactive',
            activation_limit: 5,
            activation_usage: 0,
            id: 0,
            key: 'new-key',
            created_at: '',
            expires_at: null,
          },
          instance: null,
        }),
      );
      apiService.activate
        .mockResolvedValueOnce(
          createActivationResponse({ activated: false, error: null }),
        )
        .mockResolvedValueOnce(
          createActivationResponse({
            license_key: {
              status: 'active',
              activation_limit: 5,
              activation_usage: 1,
              id: 0,
              key: 'old-key',
              created_at: '',
              expires_at: null,
            },
          }),
        );

      await expect(
        service.handleLicenseKeyUpdate(
          createSettingUpdateEvent({
            oldValue: 'old-key',
            newValue: 'new-key',
          }),
        ),
      ).rejects.toThrow(BadRequestException);

      expect(apiService.activate).toHaveBeenNthCalledWith(1, 'new-key');
      expect(apiService.activate).toHaveBeenNthCalledWith(2, 'old-key');
    });
  });

  describe('deactivate', () => {
    it('deactivates active licenses and clears stored instance id', async () => {
      const { service, apiService, metadataService } = createEnv();
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'active',
            id: 0,
            key: 'key_123',
            activation_limit: 5,
            activation_usage: 2,
            created_at: '',
            expires_at: null,
          },
        }),
      );
      metadataService.findOne.mockResolvedValueOnce({ value: 'instance-2' });
      apiService.deactivate.mockResolvedValue({
        deactivated: true,
        error: null,
        license_key: {
          ...defaultLicenseKey,
          status: 'inactive',
        },
      });

      const result = await service.deactivate('key_123', 'cleanup');

      expect(result).toBe(true);
      expect(metadataService.deleteOne).toHaveBeenCalledWith({
        where: { name: 'instance_id' },
      });
      expect(service.getStatus()).toBe('inactive');
      expect(service.getPlan()).toBe('pro');
      expect(service.getLastError()).toBe('cleanup');
    });

    it('sets error status when license is invalid', async () => {
      const { service, apiService } = createEnv();
      apiService.validate.mockResolvedValue(
        createValidationResponse({ valid: false, license_key: null }),
      );

      await service.deactivate('key_123');

      expect(service.getStatus()).toBe('error');
    });

    it('returns false when deactivation throws', async () => {
      const { service, apiService, logger } = createEnv();
      apiService.validate.mockRejectedValue(new Error('network'));

      const result = await service.deactivate('key_123');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('marks local state inactive when instance id is missing', async () => {
      const { service, apiService, metadataService } = createEnv();
      metadataService.findOne.mockResolvedValueOnce(undefined);
      apiService.validate.mockResolvedValue(
        createValidationResponse({
          license_key: {
            status: 'active',
            id: 0,
            key: 'key_123',
            activation_limit: 5,
            activation_usage: 2,
            created_at: '',
            expires_at: null,
          },
        }),
      );

      const result = await service.deactivate('key_123', 'cleanup');

      expect(result).toBe(true);
      expect(apiService.deactivate).not.toHaveBeenCalled();
      expect(service.getStatus()).toBe('inactive');
    });
  });
});

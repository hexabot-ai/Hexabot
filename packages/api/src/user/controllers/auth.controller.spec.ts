/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JwtModule } from '@nestjs/jwt';

import { LicenseService } from '@/license/services/license.service';
import { ModelOrmEntity } from '@/user/entities/model.entity';
import { PermissionOrmEntity } from '@/user/entities/permission.entity';
import { RoleOrmEntity } from '@/user/entities/role.entity';
import { UserOrmEntity } from '@/user/entities/user.entity';
import { installLanguageFixturesTypeOrm } from '@/utils/test/fixtures/language';
import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import { MailerServiceProvider } from '@/utils/test/providers/mailer-service.provider';
import { buildTestingMocks } from '@/utils/test/utils';

import { LocalAuthController } from './auth.controller';

describe('AuthController (TypeORM)', () => {
  let authController: LocalAuthController;
  let licenseService: Pick<LicenseService, 'getSnapshot'>;
  const licenseSnapshot = {
    status: 'active',
    plan: 'pro',
    activationLimit: 10,
    activationUsage: 1,
    lastError: null,
    quotas: {
      tier: 'pro',
      resources: {
        users: {
          limit: 10,
          used: 1,
          remaining: 9,
          reached: false,
        },
        workflows: {
          limit: 150,
          used: 3,
          remaining: 147,
          reached: false,
        },
      },
    },
  } as const;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers', 'providers'],
      controllers: [LocalAuthController],
      imports: [JwtModule.register({})],
      providers: [
        MailerServiceProvider,
        I18nServiceProvider,
        {
          provide: LicenseService,
          useValue: {
            getSnapshot: jest.fn().mockResolvedValue(licenseSnapshot),
          },
        },
      ],
      typeorm: {
        entities: [
          ModelOrmEntity,
          PermissionOrmEntity,
          RoleOrmEntity,
          UserOrmEntity,
        ],
        fixtures: [
          installLanguageFixturesTypeOrm,
          installPermissionFixturesTypeOrm,
        ],
      },
    });

    [authController, licenseService] = await testing.getMocks([
      LocalAuthController,
      LicenseService,
    ]);
  });

  afterEach(jest.clearAllMocks);
  describe('session payload', () => {
    it('should include license snapshot in /auth/me payload', async () => {
      const req = {
        user: {
          id: 'user-id',
          email: 'admin@example.com',
        },
      } as any;
      const result = await authController.me(req);

      expect(result).toEqual({
        ...req.user,
        license: licenseSnapshot,
      });
      expect(licenseService.getSnapshot).toHaveBeenCalledTimes(1);
    });

    it('should include license snapshot in /auth/local payload', async () => {
      const req = {
        user: {
          id: 'user-id',
          email: 'admin@example.com',
        },
      } as any;
      const result = await authController.login(req);

      expect(result).toEqual({
        ...req.user,
        license: licenseSnapshot,
      });
      expect(licenseService.getSnapshot).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { User } from '@hexabot-ai/types';

import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { buildTestingMocks } from '@/utils/test/utils';

import { UserRepository } from '../repositories/user.repository';

import { AuthService } from './auth.service';

describe('AuthService (TypeORM)', () => {
  let authService: AuthService;
  let userRepository: UserRepository;
  let adminUser: User | null;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [AuthService],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    [authService, userRepository] = await testing.getMocks([
      AuthService,
      UserRepository,
    ]);

    adminUser = await userRepository.findOne({ where: { username: 'admin' } });
    jest.spyOn(userRepository, 'findOneByEmailWithPassword');
  });

  afterEach(jest.clearAllMocks);
  describe('validateUser', () => {
    const adminEmail = 'admin@admin.admin';

    it('should successfully validate user with the correct password', async () => {
      const result = await authService.validateUser(adminEmail, 'adminadmin');
      expect(userRepository.findOneByEmailWithPassword).toHaveBeenCalledWith(
        adminEmail,
      );
      expect(result!.id).toBe(adminUser!.id);
    });

    it('should not validate user if the provided password is incorrect', async () => {
      const result = await authService.validateUser(
        adminEmail,
        'randomPassword',
      );
      expect(userRepository.findOneByEmailWithPassword).toHaveBeenCalledWith(
        adminEmail,
      );
      expect(result).toBeNull();
    });

    it("should not validate user's password if the user does not exist", async () => {
      const missingEmail = 'admin2@admin.admin';
      const result = await authService.validateUser(missingEmail, 'admin');
      expect(userRepository.findOneByEmailWithPassword).toHaveBeenCalledWith(
        missingEmail,
      );
      expect(result).toBeNull();
    });
  });
});

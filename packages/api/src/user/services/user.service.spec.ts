/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { User as UserDto } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { userFixtures } from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';

import { UserRepository } from '../repositories/user.repository';

import { UserService } from './user.service';

describe('UserService (TypeORM)', () => {
  let module: TestingModule;
  let userService: UserService;
  let userRepository: UserRepository;
  let user: UserDto | null;

  const FIELDS_TO_IGNORE: string[] = [
    ...IGNORED_TEST_FIELDS,
    'password',
    'language',
    'resetCount',
    'sendEmail',
    'state',
    'timezone',
    'resetToken',
    'provider',
  ];

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [UserService],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    module = testing.module;

    [userService, userRepository] = await testing.getMocks([
      UserService,
      UserRepository,
    ]);

    user = await userRepository.findOne({ where: { username: 'admin' } });
  }, 30000);

  afterEach(jest.clearAllMocks);

  describe('findOneAndPopulate', () => {
    it('should find one user and populate its roles', async () => {
      jest.spyOn(userRepository, 'findOneAndPopulate');
      const result = await userService.findOneAndPopulate(user!.id);
      expect(userRepository.findOneAndPopulate).toHaveBeenCalledWith(user!.id);

      const expected = userFixtures.find(
        ({ username }) => username === 'admin',
      );
      expect(result).toEqualPayload(
        {
          ...expected,
          id: user!.id,
          roles: undefined,
        },
        [...FIELDS_TO_IGNORE, 'roles'],
      );

      const roleIds = (result?.roles ?? []).map((role) => role.id).sort();
      expect(roleIds).toEqual((user!.roles ?? []).sort());
    });
  });

  describe('findAndPopulate', () => {
    it('should find users, and for each user populate the corresponding roles', async () => {
      jest.spyOn(userRepository, 'findAndPopulate');
      const users = await userRepository.findAll();
      const result = await userService.findAndPopulate({
        order: { createdAt: 'ASC' },
      });

      expect(userRepository.findAndPopulate).toHaveBeenCalledWith({
        order: { createdAt: 'ASC' },
      });

      expect(result).toHaveLength(users.length);

      const roleMap = new Map<string, string[]>();
      result.forEach((userFull) => {
        roleMap.set(
          userFull.id,
          (userFull.roles ?? []).map((role) => role.id).sort(),
        );
      });

      users.forEach((plainUser) => {
        const expectedRoles = (plainUser.roles ?? []).sort();
        const actualRoles = roleMap.get(plainUser.id) ?? [];
        expect(actualRoles).toEqual(expectedRoles);
      });
    });
  });
});

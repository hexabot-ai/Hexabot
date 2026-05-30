/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import type { User } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { roleFixtureIds } from '@/utils/test/fixtures/role';
import { userFixtures } from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';

import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';

describe('UserRepository (TypeORM)', () => {
  let module: TestingModule;
  let userRepository: UserRepository;
  let user: User | null;

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
      providers: [UserRepository, RoleRepository],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    module = testing.module;

    [userRepository] = await testing.getMocks([UserRepository]);

    user = await userRepository.findOne({ where: { username: 'admin' } });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findOneAndPopulate', () => {
    it('should find one user and populate roles', async () => {
      const result = await userRepository.findOneAndPopulate(user!.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(user!.id);
      expect(result!.username).toBe(user!.username);

      const expectedRoleIds = [
        roleFixtureIds.admin,
        roleFixtureIds.manager,
      ].sort();
      const roleIds = (result!.roles ?? []).map((role) => role.id).sort();
      expect(roleIds).toEqual(expectedRoleIds);

      const expected = userFixtures.find(
        ({ username }) => username === 'admin',
      );
      if (!expected) {
        throw new Error('Expected admin user fixture to be available');
      }
      expect(result).toEqualPayload({ ...expected, roles: undefined }, [
        ...FIELDS_TO_IGNORE,
        'roles',
      ]);
    });
  });

  describe('findAndPopulate', () => {
    it('should populate roles for every user', async () => {
      const users = await userRepository.findAll();
      const result = await userRepository.findAndPopulate({});

      expect(result).toHaveLength(users.length);

      result.forEach((userFull) => {
        const plain = users.find((candidate) => candidate.id === userFull.id);
        expect(plain).toBeDefined();
        expect(userFull.roles.map((role) => role.id).sort()).toEqual(
          (plain!.roles ?? []).sort(),
        );
      });
    });
  });

  describe('assignment helpers', () => {
    it('returns only active user IDs from a candidate list', async () => {
      const missingId = randomUUID();
      const activeIds = await userRepository.findActiveUserIds([
        user!.id,
        missingId,
      ]);

      expect(activeIds).toContain(user!.id);
      expect(activeIds).not.toContain(missingId);
    });

    it('checks activity based on user state', async () => {
      const missingId = randomUUID();

      expect(await userRepository.isActiveUser(user!.id)).toBe(true);
      expect(await userRepository.isActiveUser(missingId)).toBe(false);

      await userRepository.updateOne(user!.id, { state: false });
      expect(await userRepository.isActiveUser(user!.id)).toBe(false);

      await userRepository.updateOne(user!.id, { state: true });
      expect(await userRepository.isActiveUser(user!.id)).toBe(true);
    });
  });
});

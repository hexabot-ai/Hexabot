/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Role } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import {
  installPermissionFixturesTypeOrm,
  permissionOrmFixtures,
} from '@/utils/test/fixtures/permission';
import { roleFixtureIds } from '@/utils/test/fixtures/role';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';

import { PermissionRepository } from './permission.repository';
import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';

describe('RoleRepository (TypeORM)', () => {
  let module: TestingModule;
  let roleRepository: RoleRepository;
  let permissionRepository: PermissionRepository;
  let userRepository: UserRepository;

  let adminRole: Role;
  let managerRole: Role;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [UserRepository, RoleRepository, PermissionRepository],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    module = testing.module;

    [roleRepository, userRepository, permissionRepository] =
      await testing.getMocks([
        RoleRepository,
        UserRepository,
        PermissionRepository,
      ]);

    adminRole = (await roleRepository.findOne({
      where: { name: 'admin' },
    }))!;
    managerRole = (await roleRepository.findOne({
      where: { name: 'manager' },
    }))!;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findOneAndPopulate', () => {
    it('should find one role and populate its permissions and users', async () => {
      const permissions = await permissionRepository.find({
        where: { role: { id: adminRole.id } },
      });
      const result = await roleRepository.findOneAndPopulate(adminRole.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(adminRole.id);
      expect(result!.name).toBe(adminRole.name);
      expect(result!.permissions?.length).toBe(permissions.length);

      const expectedActions = permissionOrmFixtures
        .filter((fixture) => fixture.role === roleFixtureIds.admin)
        .map((fixture) => fixture.action)
        .sort();
      const actions = (result!.permissions ?? [])
        .map((permission) => permission.action)
        .sort();
      expect(actions).toEqual(expectedActions);

      const expectedUserIds = [userFixtureIds.admin];
      const userIds = (result!.users ?? []).map((user) => user.id).sort();

      expect(userIds).toEqual(expectedUserIds);
    });
  });

  describe('findAndPopulate', () => {
    it('should find roles and populate permissions and users', async () => {
      const [roles, permissions, allUsers] = await Promise.all([
        roleRepository.findAll(),
        permissionRepository.findAll(),
        userRepository.findAll(),
      ]);
      const result = await roleRepository.findAndPopulate({});

      expect(result).toHaveLength(roles.length);

      result.forEach((role) => {
        const expectedPermissions = permissions.filter(
          (permission) => permission.role === role.id,
        );
        const expectedUsers = allUsers.filter((user) =>
          user.roles.includes(role.id),
        );
        const resultPermissionIds = (role.permissions ?? []).map(
          (permission) => permission.id,
        );
        const expectedPermissionIds = expectedPermissions.map(
          (permission) => permission.id,
        );
        expect(resultPermissionIds.sort()).toEqual(
          expectedPermissionIds.sort(),
        );

        const resultUserIds = (role.users ?? []).map((user) => user.id).sort();
        const expectedUserIds = expectedUsers.map((user) => user.id).sort();
        expect(resultUserIds).toEqual(expectedUserIds);
      });
    });
  });

  describe('deleteOne', () => {
    it('should delete a role by id', async () => {
      const permissionsBefore = await permissionRepository.find({
        where: { role: { id: managerRole.id } },
      });
      expect(permissionsBefore.length).toBeGreaterThan(0);

      const result = await roleRepository.deleteOne(managerRole.id);

      expect(result).toEqual({
        acknowledged: true,
        deletedCount: 1,
      });

      const permissionsAfter = await permissionRepository.find({
        where: { role: { id: managerRole.id } },
      });
      expect(permissionsAfter.length).toEqual(0);
    });

    it('should fail to delete a role that does not exist', async () => {
      expect(await roleRepository.deleteOne(managerRole.id)).toEqual({
        acknowledged: true,
        deletedCount: 0,
      });
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Role, Permission } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { roleFixtureIds, roleOrmFixtures } from '@/utils/test/fixtures/role';
import { buildTestingMocks } from '@/utils/test/utils';

import { PermissionRepository } from '../repositories/permission.repository';
import { RoleRepository } from '../repositories/role.repository';
import { UserRepository } from '../repositories/user.repository';

import { RoleService } from './role.service';

describe('RoleService (TypeORM)', () => {
  let module: TestingModule;
  let roleService: RoleService;
  let roleRepository: RoleRepository;
  let permissionRepository: PermissionRepository;
  let userRepository: UserRepository;
  let role: Role;
  let permissions: Permission[];

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [RoleService, UserRepository, PermissionRepository],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    module = testing.module;

    [roleService, roleRepository, userRepository, permissionRepository] =
      await testing.getMocks([
        RoleService,
        RoleRepository,
        UserRepository,
        PermissionRepository,
      ]);

    const foundRole = await roleRepository.findOne(roleFixtureIds.admin);
    if (!foundRole) {
      throw new Error('Expected admin role fixture to be available');
    }
    role = foundRole;

    permissions = await permissionRepository.find({
      where: { role: { id: roleFixtureIds.admin } },
    });
  });

  afterEach(jest.clearAllMocks);

  describe('findOneAndPopulate', () => {
    it('should find one role and populate its permissions and users', async () => {
      jest.spyOn(roleRepository, 'findOneAndPopulate');
      const result = await roleService.findOneAndPopulate(role.id);
      expect(roleRepository.findOneAndPopulate).toHaveBeenCalledWith(role.id);

      const expectedFixture = roleOrmFixtures.find(
        ({ id }) => id === roleFixtureIds.admin,
      )!;

      expect(result).toEqualPayload(
        {
          id: expectedFixture.id,
          name: expectedFixture.name,
          active: expectedFixture.active,
        },
        ['permissions', 'users', 'createdAt', 'updatedAt'],
      );

      const expectedUserIds = (await userRepository.findAll())
        .filter((user) => user.roles.includes(role.id))
        .map((user) => user.id)
        .sort();
      const userIds = (result?.users ?? []).map((user) => user.id).sort();
      expect(userIds).toEqual(expectedUserIds);

      const permissionIds = (result?.permissions ?? [])
        .map((permission) => permission.id)
        .sort();
      expect(permissionIds).toEqual(
        permissions.map((permission) => permission.id).sort(),
      );
    });
  });

  describe('findAndPopulate', () => {
    it('should find roles, and for each role populate the corresponding permissions and users', async () => {
      jest.spyOn(roleRepository, 'findAndPopulate');
      const allRoles = await roleRepository.findAll();
      const result = await roleService.findAndPopulate({
        order: { createdAt: 'ASC' },
      });

      expect(roleRepository.findAndPopulate).toHaveBeenCalledWith({
        order: { createdAt: 'ASC' },
      });

      expect(result).toHaveLength(allRoles.length);

      const allPermissions = await permissionRepository.findAll();
      const allUsers = await userRepository.findAll();

      result.forEach((roleResult) => {
        const expectedPermissions = allPermissions.filter(
          (permission) => permission.role === roleResult.id,
        );
        const expectedUserIds = allUsers
          .filter((user) => user.roles.includes(roleResult.id))
          .map((user) => user.id)
          .sort();
        const permissionIds = (roleResult.permissions ?? [])
          .map((permission) => permission.id)
          .sort();
        expect(permissionIds).toEqual(
          expectedPermissions.map((permission) => permission.id).sort(),
        );

        const userIds = (roleResult.users ?? []).map((user) => user.id).sort();
        expect(userIds).toEqual(expectedUserIds);
      });
    });
  });
});

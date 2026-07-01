/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Permission } from '@hexabot-ai/types';

import {
  installPermissionFixturesTypeOrm,
  permissionOrmFixtures,
} from '@/utils/test/fixtures/permission';
import { buildTestingMocks } from '@/utils/test/utils';

import { Action } from '../types/action.type';

import { ModelRepository } from './model.repository';
import { PermissionRepository } from './permission.repository';
import { RoleRepository } from './role.repository';

describe('PermissionRepository (TypeORM)', () => {
  let modelRepository: ModelRepository;
  let roleRepository: RoleRepository;
  let permissionRepository: PermissionRepository;
  let createPermission: Permission;
  let updatePermission: Permission;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [ModelRepository, RoleRepository, PermissionRepository],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    [modelRepository, roleRepository, permissionRepository] =
      await testing.getMocks([
        ModelRepository,
        RoleRepository,
        PermissionRepository,
      ]);

    const created = (await permissionRepository.findOne({
      where: { action: Action.CREATE },
    }))!;
    const updated = (await permissionRepository.findOne({
      where: { action: Action.UPDATE },
    }))!;

    createPermission = created;
    updatePermission = updated;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('findOneAndPopulate', () => {
    it('should find a permission and populate its role and model', async () => {
      const role = await roleRepository.findOne(createPermission.role);
      const model = await modelRepository.findOne(createPermission.model);
      const result = await permissionRepository.findOneAndPopulate(
        createPermission.id,
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe(createPermission.id);
      expect(result!.role?.id).toBe(role?.id);
      expect(result!.model?.id).toBe(model?.id);

      const expected = permissionOrmFixtures.find(
        ({ action }) => action === Action.CREATE,
      )!;
      expect(result!.action).toBe(expected.action);
      expect(result!.relation).toBe(expected.relation);
    });
  });

  describe('findAllAndPopulate', () => {
    it('should populate models and roles', async () => {
      const permissions = await permissionRepository.findAll();
      const result = await permissionRepository.findAllAndPopulate();

      expect(result).toHaveLength(permissions.length);

      result.forEach((permission) => {
        expect(permission.role).toBeDefined();
        expect(permission.model).toBeDefined();
        const expected = permissionOrmFixtures.find(
          ({ id }) => id === permission.id,
        );
        expect(expected).toBeDefined();
        expect(permission.role!.id).toBe(expected?.role);
        expect(permission.model!.id).toBe(expected?.model);
      });
    });
  });

  describe('deleteOne', () => {
    it('should delete a permission by id', async () => {
      const result = await permissionRepository.deleteOne(updatePermission.id);

      expect(result).toEqual({
        acknowledged: true,
        deletedCount: 1,
      });

      const remaining = await permissionRepository.find({
        where: { id: updatePermission.id },
      });
      expect(remaining.length).toBe(0);
    });

    it('should fail to delete a permission that does not exist', async () => {
      expect(await permissionRepository.deleteOne(updatePermission.id)).toEqual(
        {
          acknowledged: true,
          deletedCount: 0,
        },
      );
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Role, Model, Permission, PermissionFull } from '@hexabot-ai/types';
import { NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { buildTestingMocks } from '@/utils/test/utils';

import { PermissionCreateDto } from '../dto/permission.dto';
import { ModelService } from '../services/model.service';
import { PermissionService } from '../services/permission.service';
import { RoleService } from '../services/role.service';
import { Action } from '../types/action.type';

import { PermissionController } from './permission.controller';

describe('PermissionController (TypeORM)', () => {
  let module: TestingModule;
  let permissionController: PermissionController;
  let permissionService: PermissionService;
  let roleService: RoleService;
  let modelService: ModelService;
  let deletedId: string;
  let adminRole: Role;
  let contentModel: Model;
  let createPermission: Permission;
  let allPermissions: Permission[];

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [PermissionController],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    module = testing.module;

    [permissionController, roleService, modelService, permissionService] =
      await testing.getMocks([
        PermissionController,
        RoleService,
        ModelService,
        PermissionService,
      ]);

    allPermissions = await permissionService.findAll();
    adminRole = (await roleService.findOne({ where: { name: 'admin' } }))!;
    contentModel = (await modelService.findOne({
      where: { name: 'Content' },
    }))!;
    createPermission = (await permissionService.findOne({
      where: { action: Action.CREATE },
    }))!;
  });

  afterEach(jest.clearAllMocks);

  describe('find', () => {
    it('should find permissions', async () => {
      jest.spyOn(permissionService, 'find');
      const result = await permissionController.findPermissions([], {});
      expect(permissionService.find).toHaveBeenCalled();
      expect(result.length).toBe(allPermissions.length);
    });

    it('should populate model and role when requested', async () => {
      jest.spyOn(permissionService, 'findAndPopulate');
      const result = (await permissionController.findPermissions(
        ['model', 'role'],
        {},
      )) as PermissionFull[];
      expect(permissionService.findAndPopulate).toHaveBeenCalled();

      result.forEach((permission) => {
        const expected = allPermissions.find(
          (item) => item.id === permission.id,
        );
        expect(expected).toBeDefined();
        expect(permission.role?.id).toBe(expected?.role);
        expect(permission.model?.id).toBe(expected?.model);
      });
    });
  });

  describe('deleteOne', () => {
    it('should delete a permission with the id', async () => {
      jest.spyOn(permissionService, 'deleteOne');

      const result = await permissionController.deleteOne(createPermission.id);
      deletedId = createPermission.id;
      expect(permissionService.deleteOne).toHaveBeenCalledWith(
        createPermission.id,
      );
      expect(result).toEqual({ acknowledged: true, deletedCount: 1 });
    });

    it('should throw a NotFoundException when attempting to delete a non existing permission', async () => {
      jest.spyOn(permissionService, 'deleteOne');
      await expect(permissionController.deleteOne(deletedId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should return created permission', async () => {
      jest.spyOn(permissionService, 'create');
      const permissionDto: PermissionCreateDto = {
        model: contentModel.id,
        role: adminRole.id,
        action: Action.CREATE,
        relation: 'role',
      };
      const result = await permissionController.create(permissionDto);
      expect(permissionService.create).toHaveBeenCalledWith(permissionDto);
      expect(result).toMatchObject({
        action: permissionDto.action,
        relation: permissionDto.relation,
        role: permissionDto.role,
        model: permissionDto.model,
      });
    });
  });
});

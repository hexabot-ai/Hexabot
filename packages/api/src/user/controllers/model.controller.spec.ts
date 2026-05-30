/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ModelFull } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { buildTestingMocks } from '@/utils/test/utils';

import { ModelService } from '../services/model.service';
import { PermissionService } from '../services/permission.service';

import { ModelController } from './model.controller';

describe('ModelController (TypeORM)', () => {
  let module: TestingModule;
  let modelController: ModelController;
  let modelService: ModelService;
  let permissionService: PermissionService;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers', 'providers'],
      controllers: [ModelController],
      providers: [PermissionService],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    module = testing.module;

    [modelController, modelService, permissionService] = await testing.getMocks(
      [ModelController, ModelService, PermissionService],
    );
  });

  afterEach(jest.clearAllMocks);

  describe('find', () => {
    it('should find models', async () => {
      jest.spyOn(modelService, 'findAndPopulate');
      const result = (await modelController.findModels(
        ['permissions'],
        {},
      )) as ModelFull[];
      expect(modelService.findAndPopulate).toHaveBeenCalledWith({});
      expect(result.length).toBeGreaterThan(0);
      result.forEach((model) => {
        expect(model.permissions).toBeDefined();
      });
    });

    it('should populate permissions for each model', async () => {
      jest.spyOn(modelService, 'findAndPopulate');
      const allPermissions = await permissionService.findAll();
      const result = (await modelController.findModels(
        ['permissions'],
        {},
      )) as ModelFull[];

      expect(modelService.findAndPopulate).toHaveBeenCalledWith({});

      result.forEach((model) => {
        const expectedPermissionIds = allPermissions
          .filter((permission) => permission.model === model.id)
          .map((permission) => permission.id)
          .sort();
        const permissionIds = (model.permissions ?? [])
          .map((permission) => permission.id)
          .sort();

        expect(permissionIds).toEqual(expectedPermissionIds);
      });
    });
  });
});

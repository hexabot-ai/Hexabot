/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { modelFixtureIds } from '@/utils/test/fixtures/model';
import {
  installPermissionFixturesTypeOrm,
  permissionOrmFixtures,
} from '@/utils/test/fixtures/permission';
import { buildTestingMocks } from '@/utils/test/utils';

import { ModelOrmEntity as ModelEntity } from '../entities/model.entity';

import { ModelRepository } from './model.repository';
import { PermissionRepository } from './permission.repository';

describe('ModelRepository (TypeORM)', () => {
  let modelRepository: ModelRepository;
  let permissionRepository: PermissionRepository;
  let contentTypeModel: ModelEntity;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [ModelRepository, PermissionRepository],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    [modelRepository, permissionRepository] = await testing.getMocks([
      ModelRepository,
      PermissionRepository,
    ]);

    contentTypeModel = (await modelRepository.findOne(
      modelFixtureIds.contentType,
    )) as ModelEntity;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('findOneAndPopulate', () => {
    it('should find a model and populate its permissions', async () => {
      const expectedPermissions = permissionOrmFixtures.filter(
        (fixture) => fixture.model === modelFixtureIds.contentType,
      );
      const result = await modelRepository.findOneAndPopulate(
        contentTypeModel.id,
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe(contentTypeModel.id);
      const permissionIds = (result!.permissions ?? []).map(
        (permission) => permission.id,
      );
      expect(permissionIds.sort()).toEqual(
        expectedPermissions.map((permission) => permission.id).sort(),
      );
    });
  });

  describe('findAndPopulate', () => {
    it('should find models and populate permissions', async () => {
      const models = await modelRepository.findAll();
      const permissions = await permissionRepository.findAll();
      const result = await modelRepository.findAndPopulate({});

      expect(result).toHaveLength(models.length);

      result.forEach((model) => {
        const expectedPermissions = permissions.filter(
          (permission) => permission.model === model.id,
        );
        const resultPermissionIds = (model.permissions ?? []).map(
          (permission) => permission.id,
        );
        expect(resultPermissionIds.sort()).toEqual(
          expectedPermissions.map((permission) => permission.id).sort(),
        );
      });
    });
  });
});

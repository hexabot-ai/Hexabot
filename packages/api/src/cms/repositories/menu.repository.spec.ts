/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { TestingModule } from '@nestjs/testing';

import {
  installMenuFixturesTypeOrm,
  rootMenuFixtures,
} from '@/utils/test/fixtures/menu';
import { buildTestingMocks } from '@/utils/test/utils';

import { MenuType } from '../entities/menu.entity';

import { MenuRepository } from './menu.repository';

describe('MenuRepository (TypeORM)', () => {
  let module: TestingModule;
  let repository: MenuRepository;
  const createdMenuIds = new Set<string>();

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [MenuRepository],
      typeorm: {
        fixtures: installMenuFixturesTypeOrm,
      },
    });
    module = testingModule;
    [repository] = await getMocks([MenuRepository]);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of Array.from(createdMenuIds)) {
      await repository.deleteOne(id);
      createdMenuIds.delete(id);
    }
  });

  describe('preCreate validation', () => {
    it('allows nested menu without payload', async () => {
      const created = await repository.create({
        title: 'Nested allowed',
        type: MenuType.nested,
      });
      createdMenuIds.add(created.id);

      expect(created).toMatchObject({
        title: 'Nested allowed',
        type: MenuType.nested,
      });
    });

    it('requires payload for postback menu', async () => {
      await expect(
        repository.create({
          title: 'Missing payload',
          type: MenuType.postback,
        }),
      ).rejects.toThrow();
    });

    it('requires url for web_url menu', async () => {
      await expect(
        repository.create({
          title: 'Missing url',
          type: MenuType.web_url,
        }),
      ).rejects.toThrow();
    });

    it('requires parent to be of type nested', async () => {
      const parent = await repository.create({
        title: 'Parent web url',
        type: MenuType.web_url,
        url: 'https://example.com',
      });
      createdMenuIds.add(parent.id);

      await expect(
        repository.create({
          title: 'Child with non-nested parent',
          type: MenuType.nested,
          parent: { id: parent.id } as any,
        }),
      ).rejects.toThrow(
        'Menu Validation Error: parent should be of type \"nested\"',
      );
    });

    it('rejects updating a menu that references itself as parent', async () => {
      const createdMenu = await repository.create({
        title: 'Self parent create',
        type: MenuType.nested,
      });
      await expect(
        repository.updateOne(createdMenu.id, {
          title: 'Self parent create',
          type: MenuType.nested,
          parent: { id: createdMenu.id } as any,
        }),
      ).rejects.toThrow(
        'Menu Validation Error: parent should not reference itself',
      );
    });
  });

  describe('preUpdate validation', () => {
    it('prevents updating menu type after creation', async () => {
      const created = await repository.create({
        title: `${rootMenuFixtures[0].title}-type-lock`,
        type: MenuType.nested,
      });
      createdMenuIds.add(created.id);

      await expect(
        repository.updateOne(created.id, { type: MenuType.postback }),
      ).rejects.toThrow();
    });

    it('validates payload when updating postback menu', async () => {
      const created = await repository.create({
        title: 'Postback menu',
        type: MenuType.postback,
        payload: 'initial',
      });
      createdMenuIds.add(created.id);

      const updated = await repository.updateOne(created.id, {
        payload: 'updatedPayload',
      });

      expect(updated).not.toBeNull();
      if (!updated) {
        throw new Error('Expected menu update to succeed');
      }
      expect(updated.payload).toBe('updatedPayload');
    });

    it('rejects updating a menu to reference itself as parent', async () => {
      const created = await repository.create({
        title: 'Self parent update',
        type: MenuType.nested,
      });
      createdMenuIds.add(created.id);

      await expect(
        repository.updateOne(created.id, { parent: { id: created.id } as any }),
      ).rejects.toThrow(
        'Menu Validation Error: parent should not reference itself',
      );
    });
  });
});

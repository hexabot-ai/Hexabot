/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { TestingModule } from '@nestjs/testing';
import { Cache } from 'cache-manager';

import { MENU_CACHE_KEY } from '@/utils/constants/cache';
import {
  installMenuFixturesTypeOrm,
  offerMenuFixture,
  offersMenuFixtures,
  rootMenuFixtures,
} from '@/utils/test/fixtures/menu';
import { buildTestingMocks } from '@/utils/test/utils';

import { MenuType } from '../entities/menu.entity';

import { MenuService } from './menu.service';

describe('MenuService (TypeORM)', () => {
  let module: TestingModule;
  let menuService: MenuService;
  let cacheManager: Cache;
  const createdIds = new Set<string>();

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [MenuService],
      typeorm: {
        fixtures: installMenuFixturesTypeOrm,
      },
    });
    module = testingModule;
    [menuService, cacheManager] = await getMocks([MenuService, CACHE_MANAGER]);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of Array.from(createdIds)) {
      await menuService.deleteOne(id);
      createdIds.delete(id);
    }
    if (cacheManager) {
      await cacheManager.del(MENU_CACHE_KEY);
    }
  });

  describe('create', () => {
    it('creates menu when parent is nested', async () => {
      const [parent] = await menuService.find({
        where: { title: offerMenuFixture.title },
        take: 1,
      });
      expect(parent).toBeDefined();

      const payload = {
        title: 'Child menu',
        parent: parent.id,
        type: MenuType.nested,
      } as const;
      const created = await menuService.create(payload);
      createdIds.add(created.id);

      expect(created).toMatchObject({
        title: payload.title,
        parent: payload.parent,
        type: payload.type,
      });
    });

    it('throws when parent is not nested', async () => {
      const [parent] = await menuService.find({
        where: { title: offersMenuFixtures[0].title },
        take: 1,
      });
      expect(parent).toBeDefined();
      expect(parent?.type).toBe(MenuType.postback);

      await expect(
        menuService.create({
          title: 'Invalid child',
          parent: parent!.id,
          type: MenuType.nested,
        }),
      ).rejects.toThrow();
    });

    it('throws when parent does not exist', async () => {
      await expect(
        menuService.create({
          title: 'Orphan menu',
          parent: randomUUID(),
          type: MenuType.nested,
        }),
      ).rejects.toThrow();
    });
  });

  describe('updateOne', () => {
    it('reassigns a menu to a different nested parent', async () => {
      const parentA = await menuService.create({
        title: 'Parent A',
        type: MenuType.nested,
      });
      const parentB = await menuService.create({
        title: 'Parent B',
        type: MenuType.nested,
      });
      const child = await menuService.create({
        title: 'Child',
        type: MenuType.postback,
        payload: 'payload',
        parent: parentA.id,
      });
      createdIds.add(parentA.id);
      createdIds.add(parentB.id);
      createdIds.add(child.id);

      const updated = await menuService.updateOne(child.id, {
        parent: parentB.id,
      });

      expect(updated.parent).toBe(parentB.id);
    });

    it('rejects reassignment to a non-nested parent', async () => {
      const parentNested = await menuService.create({
        title: 'Nested parent',
        type: MenuType.nested,
      });
      const parentPostback = await menuService.create({
        title: 'Postback parent',
        type: MenuType.postback,
        payload: 'payload',
      });
      const child = await menuService.create({
        title: 'Child',
        type: MenuType.postback,
        payload: 'child',
        parent: parentNested.id,
      });
      [parentNested.id, parentPostback.id, child.id].forEach((id) =>
        createdIds.add(id),
      );

      await expect(
        menuService.updateOne(child.id, { parent: parentPostback.id }),
      ).rejects.toThrow();
    });

    it('rejects assigning a menu as its own parent', async () => {
      const parent = await menuService.create({
        title: 'Self parent candidate',
        type: MenuType.nested,
      });
      createdIds.add(parent.id);

      await expect(
        menuService.updateOne(parent.id, { parent: parent.id }),
      ).rejects.toThrow(/parent should not reference itself/i);
    });
  });

  describe('deleteOne', () => {
    it('removes a menu and its descendants using cascade', async () => {
      const root = await menuService.create({
        title: 'Root to delete',
        type: MenuType.nested,
      });
      const child = await menuService.create({
        title: 'Child to delete',
        type: MenuType.nested,
        parent: root.id,
      });
      const leaf = await menuService.create({
        title: 'Leaf to delete',
        type: MenuType.postback,
        payload: 'leaf',
        parent: child.id,
      });
      [root.id, child.id, leaf.id].forEach((id) => createdIds.add(id));

      const result = await menuService.deleteOne(root.id);
      const foundRoot = await menuService.findOne(root.id);
      const childMenus = await menuService.find({
        where: { parent: { id: root.id } },
      });

      expect(result.deletedCount).toBe(1);
      expect(foundRoot).toBeNull();
      expect(childMenus).toHaveLength(0);
    });
  });

  describe('getTree', () => {
    it('returns hierarchical menu tree', async () => {
      const tree = await menuService.getTree();

      expect(tree).toHaveLength(rootMenuFixtures.length);
      const rootTitles = tree.map((node) => node.title);

      expect(rootTitles).toEqual(
        expect.arrayContaining(rootMenuFixtures.map((menu) => menu.title)),
      );
      const nestedNode = tree.find(
        (node) => node.title === offerMenuFixture.title,
      );
      expect(nestedNode?.call_to_actions?.length).toBeGreaterThan(0);
    });
  });

  describe('handleMenuUpdateEvent', () => {
    it('invalidates cached menu tree', async () => {
      const delSpy = jest.spyOn(cacheManager, 'del');

      await menuService.handleMenuUpdateEvent();

      expect(delSpy).toHaveBeenCalledWith(MENU_CACHE_KEY);
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

import { LoggerService } from '@/logger/logger.service';
import {
  installMenuFixturesTypeOrm,
  offerMenuFixture,
  rootMenuFixtures,
} from '@/utils/test/fixtures/menu';
import { buildTestingMocks } from '@/utils/test/utils';

import { MenuType } from '../entities/menu.entity';
import { MenuService } from '../services/menu.service';

import { MenuController } from './menu.controller';

describe('MenuController (TypeORM)', () => {
  let module: TestingModule;
  let controller: MenuController;
  let menuService: MenuService;
  let logger: LoggerService;
  const createdMenuIds = new Set<string>();

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [MenuController],
      typeorm: {
        fixtures: installMenuFixturesTypeOrm,
      },
    });
    module = testingModule;
    [controller, menuService] = await getMocks([MenuController, MenuService]);
    logger = controller.logger;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of Array.from(createdMenuIds)) {
      await menuService.deleteOne(id);
      createdMenuIds.delete(id);
    }
    if (menuService) {
      await menuService.handleMenuUpdateEvent();
    }
  });

  describe('find', () => {
    it('returns paginated menus when pagination provided', async () => {
      const result = await controller.findPage({ take: 5, skip: 0 });

      expect(result.length).toBeGreaterThan(0);
    });

    it('returns filtered results when where is provided', async () => {
      const [parent] = await menuService.find({
        where: { title: offerMenuFixture.title },
        take: 1,
      });
      expect(parent).toBeDefined();

      const result = await controller.findPage({
        where: { parent: { id: parent!.id } },
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((menu) => menu.parent === parent!.id)).toBe(true);
    });

    it('returns all menus when no pagination or filters', async () => {
      const result = await controller.findPage({});

      expect(result.length).toBeGreaterThan(rootMenuFixtures.length);
    });
  });

  describe('create', () => {
    it('creates a new menu item', async () => {
      const [parent] = await menuService.find({
        where: { title: offerMenuFixture.title },
        take: 1,
      });
      expect(parent).toBeDefined();

      const payload = {
        title: 'New nested item',
        type: MenuType.nested,
        parent: parent!.id,
      };
      const created = await controller.create(payload);
      createdMenuIds.add(created.id);

      expect(created).toMatchObject(payload);
    });
  });

  describe('findOne', () => {
    it('returns existing menu', async () => {
      const [existing] = await menuService.find({ take: 1 });
      expect(existing).toBeDefined();

      const result = await controller.findOne(existing!.id);

      expect(result).toMatchObject({ id: existing!.id });
    });

    it('wraps not found menu in InternalServerErrorException', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.findOne('00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundException);

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('getTree', () => {
    it('returns cached menu tree', async () => {
      const tree = await controller.getTree();

      expect(tree).toHaveLength(rootMenuFixtures.length);
    });
  });

  describe('updateOne', () => {
    it('creates a menu when id is empty', async () => {
      const payload = {
        title: 'Quick create',
        type: MenuType.postback,
        payload: 'quick',
      };
      const created = await controller.updateOne(payload, '');
      createdMenuIds.add(created.id);

      expect(created).toMatchObject(payload);
    });

    it('updates existing menu', async () => {
      const created = await controller.create({
        title: 'To update',
        type: MenuType.postback,
        payload: 'update',
      });
      createdMenuIds.add(created.id);

      const updated = await controller.updateOne(
        { title: 'Updated title' },
        created.id,
      );

      expect(updated.title).toBe('Updated title');
    });
  });

  describe('delete', () => {
    it('returns empty string when deletion succeeds', async () => {
      const root = await controller.create({
        title: 'Root Delete',
        type: MenuType.nested,
      });
      const child = await controller.create({
        title: 'Child Delete',
        type: MenuType.postback,
        payload: 'child',
        parent: root.id,
      });
      createdMenuIds.add(child.id);

      const result = await controller.deleteMenuItem(root.id);

      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      const found = await menuService.findOne(root.id);
      const orphan = await menuService.findOne(child.id);
      expect(found).toBeNull();
      expect(orphan).toBeNull();
    });

    it('wraps not found deletion in NotFoundException', async () => {
      const id = '00000000-0000-4000-8000-000000000001';
      const deleteSpy = jest.spyOn(menuService, 'deleteOne');
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(controller.deleteOne(id)).rejects.toThrow(
        new NotFoundException(`Menu with ID ${id} not found`),
      );
      expect(deleteSpy).toHaveBeenCalledWith(id);
      expect(warnSpy).toHaveBeenCalledWith(`Unable to delete Menu by id ${id}`);
    });
  });
});

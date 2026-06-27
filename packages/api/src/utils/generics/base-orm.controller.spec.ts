/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';

import { LoggerService } from '@/logger/logger.service';
import { DummyOrmEntity } from '@/utils/test/dummy/entities/dummy.entity';
import { DummyService } from '@/utils/test/dummy/services/dummy.service';
import {
  dummyFixtures,
  installDummyFixturesTypeOrm,
} from '@/utils/test/fixtures/dummy';
import { buildTestingMocks } from '@/utils/test/utils';

import { DummyController } from '../test/dummy/controllers/dummy.controller';

describe('BaseOrmController', () => {
  let controller: DummyController;
  let dummyService: DummyService;
  let logger: LoggerService;
  const createdIds = new Set<string>();

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [DummyController],
      typeorm: {
        entities: [DummyOrmEntity],
        fixtures: installDummyFixturesTypeOrm,
      },
    });

    [controller, dummyService] = await testing.getMocks([
      DummyController,
      DummyService,
    ]);
    logger = controller.logger;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of Array.from(createdIds)) {
      await dummyService.deleteOne(id);
      createdIds.delete(id);
    }
  });
  describe('count', () => {
    it('should count all records', async () => {
      const countSpy = jest.spyOn(dummyService, 'count');
      const result = await controller.count({});

      expect(countSpy).toHaveBeenCalledWith({});
      expect(result).toEqual({ count: dummyFixtures.length });
    });

    it('should count records with filter options', async () => {
      const countSpy = jest.spyOn(dummyService, 'count');
      const options = { where: { dummy: 'dummy test 1' } };
      const result = await controller.count(options);

      expect(countSpy).toHaveBeenCalledWith(options);
      expect(result).toEqual({ count: 1 });
    });
  });

  describe('deleteOne', () => {
    it('removes an existing entity', async () => {
      const created = await dummyService.create({ dummy: 'new dummy' });
      createdIds.add(created.id);
      const deleteSpy = jest.spyOn(dummyService, 'deleteOne');
      const result = await controller.deleteOne(created.id);

      expect(deleteSpy).toHaveBeenCalledWith(created.id);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      expect(await dummyService.findOne(created.id)).toBeNull();
    });

    it('throws NotFoundException when deletion does not remove anything', async () => {
      const id = randomUUID();
      const deleteSpy = jest.spyOn(dummyService, 'deleteOne');
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(controller.deleteOne(id)).rejects.toThrow(
        new NotFoundException(`Dummy with ID ${id} not found`),
      );
      expect(deleteSpy).toHaveBeenCalledWith(id);
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to delete Dummy by id ${id}`,
      );
    });
  });

  describe('deleteMany', () => {
    it('deletes multiple entities', async () => {
      const created = await dummyService.createMany([
        { dummy: 'dummy 1' },
        { dummy: 'dummy 2' },
      ]);
      const ids = created.map(({ id }) => id);
      ids.forEach((id) => createdIds.add(id));

      const result = await controller.deleteMany(ids);

      expect(result).toEqualPayload({
        acknowledged: true,
        deletedCount: ids.length,
      });

      const remaining = await dummyService.find({ where: { id: In(ids) } });
      expect(remaining.length).toBe(0);
    });

    it('throws NotFoundException when provided IDs do not exist', async () => {
      const ids = [randomUUID(), randomUUID()];

      await expect(controller.deleteMany(ids)).rejects.toThrow(
        new NotFoundException('Dummys with provided IDs not found'),
      );
    });

    it('throws BadRequestException when no IDs are provided', async () => {
      await expect(controller.deleteMany([])).rejects.toThrow(
        new BadRequestException('No IDs provided for deletion.'),
      );
    });
  });
});

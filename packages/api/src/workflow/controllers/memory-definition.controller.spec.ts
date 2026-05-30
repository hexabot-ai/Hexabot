/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { JSONSchema7 as JsonSchema } from 'json-schema';
import { In } from 'typeorm';

import { LoggerService } from '@/logger/logger.service';
import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import {
  installMemoryDefinitionFixturesTypeOrm,
  memoryDefinitionFixtureIds,
  memoryDefinitionOrmFixtures,
} from '@/utils/test/fixtures/memory-definition';
import { buildTestingMocks } from '@/utils/test/utils';

import { MemoryDefinitionService } from '../services/memory-definition.service';
import { MemoryScope } from '../types';

import { MemoryDefinitionController } from './memory-definition.controller';

describe('MemoryDefinitionController (TypeORM)', () => {
  let module: TestingModule;
  let controller: MemoryDefinitionController;
  let service: MemoryDefinitionService;
  let logger: LoggerService;
  const createdIds = new Set<string>();
  let counter = 0;

  const buildPayload = () => {
    counter += 1;
    const schema = {
      type: 'object',
      properties: {
        step: { type: 'string' },
      },
      additionalProperties: true,
    } satisfies JsonSchema;

    return {
      name: `Session Context ${counter}`,
      slug: `session_context_${counter}`,
      scope: MemoryScope.workflow,
      schema,
      ttlSeconds: 600,
    };
  };

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [MemoryDefinitionController],
      typeorm: {
        fixtures: installMemoryDefinitionFixturesTypeOrm,
      },
    });
    module = testingModule;
    [controller, service] = await getMocks([
      MemoryDefinitionController,
      MemoryDefinitionService,
    ]);
    logger = controller.logger;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of Array.from(createdIds)) {
      await service.deleteOne(id);
      createdIds.delete(id);
    }
  });

  describe('create', () => {
    it('creates a memory definition', async () => {
      const payload = buildPayload();
      const createSpy = jest.spyOn(service, 'create');
      const created = await controller.create(payload);
      createdIds.add(created.id);

      expect(createSpy).toHaveBeenCalledWith(payload);
      expect(created).toEqualPayload(payload, [...IGNORED_TEST_FIELDS]);
    });
  });

  describe('find', () => {
    it('returns memory definitions matching the provided filters', async () => {
      const [fixture] = memoryDefinitionOrmFixtures;
      const options = { where: { slug: fixture.slug } };
      const findSpy = jest.spyOn(service, 'find');
      const result = await controller.findPage(options);

      expect(findSpy).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload([fixture], [...IGNORED_TEST_FIELDS]);
    });
  });

  describe('filterCount', () => {
    it('returns the filtered count', async () => {
      const result = await controller.filterCount({
        where: { scope: MemoryScope.global },
      });

      expect(result).toEqual({ count: 1 });
    });
  });

  describe('findOne', () => {
    it('returns a memory definition when it exists', async () => {
      const id = memoryDefinitionFixtureIds.global;
      const findSpy = jest.spyOn(service, 'findOne');
      const result = await controller.findOne(id);

      expect(findSpy).toHaveBeenCalledWith(id);
      expect(result).toEqualPayload(memoryDefinitionOrmFixtures[0], [
        ...IGNORED_TEST_FIELDS,
      ]);
    });

    it('throws NotFoundException when memory definition is missing', async () => {
      const id = randomUUID();
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(controller.findOne(id)).rejects.toThrow(
        new NotFoundException(`Memory Definition with ID ${id} not found`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to find Memory Definition by id ${id}`,
      );
    });
  });

  describe('updateOne', () => {
    it('updates an existing memory definition', async () => {
      const created = await service.create(buildPayload());
      createdIds.add(created.id);
      const updates = { name: 'Updated Definition', ttlSeconds: 900 };
      const findSpy = jest.spyOn(service, 'findOne');
      const updateSpy = jest.spyOn(service, 'updateOne');
      const result = await controller.updateOne(created.id, updates);

      expect(findSpy).toHaveBeenCalledWith(created.id);
      expect(updateSpy).toHaveBeenCalledWith(created.id, updates);
      expect(result).toEqualPayload({ ...created, ...updates }, [
        ...IGNORED_TEST_FIELDS,
      ]);
    });

    it('throws NotFoundException when attempting to update a missing definition', async () => {
      const id = randomUUID();
      const updateSpy = jest.spyOn(service, 'updateOne');
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.updateOne(id, { name: 'Missing Definition' }),
      ).rejects.toThrow(
        new NotFoundException(`Memory Definition with ID ${id} not found`),
      );

      expect(updateSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to update Memory Definition by id ${id}`,
      );
    });
  });

  describe('deleteOne', () => {
    it('removes an existing memory definition', async () => {
      const created = await service.create(buildPayload());
      createdIds.add(created.id);
      const deleteSpy = jest.spyOn(service, 'deleteOne');
      const result = await controller.deleteOne(created.id);

      expect(deleteSpy).toHaveBeenCalledWith(created.id);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      expect(await service.findOne(created.id)).toBeNull();
    });

    it('throws NotFoundException when deletion does not remove anything', async () => {
      const id = randomUUID();
      const deleteSpy = jest.spyOn(service, 'deleteOne');
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(controller.deleteOne(id)).rejects.toThrow(
        new NotFoundException(`MemoryDefinition with ID ${id} not found`),
      );
      expect(deleteSpy).toHaveBeenCalledWith(id);
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to delete MemoryDefinition by id ${id}`,
      );
    });
  });

  describe('deleteMany', () => {
    it('deletes multiple memory definitions', async () => {
      const created = await service.createMany([
        buildPayload(),
        buildPayload(),
      ]);
      const ids = created.map(({ id }) => id);
      ids.forEach((id) => createdIds.add(id));

      const result = await controller.deleteMemoryDefinitions(ids);

      expect(result).toEqualPayload({
        acknowledged: true,
        deletedCount: ids.length,
      });
      const remaining = await service.find({ where: { id: In(ids) } });
      expect(remaining).toHaveLength(0);
    });

    it('throws NotFoundException when provided IDs do not exist', async () => {
      const ids = [randomUUID(), randomUUID()];

      await expect(controller.deleteMany(ids)).rejects.toThrow(
        new NotFoundException('MemoryDefinitions with provided IDs not found'),
      );
    });

    it('throws BadRequestException when no IDs are provided', async () => {
      await expect(controller.deleteMany([])).rejects.toThrow(
        new BadRequestException('No IDs provided for deletion.'),
      );
    });
  });
});

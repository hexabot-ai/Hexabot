/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

import { LoggerService } from '@/logger/logger.service';
import {
  contentTypeOrmFixtures,
  installContentTypeFixturesTypeOrm,
} from '@/utils/test/fixtures/contenttype';
import { buildTestingMocks } from '@/utils/test/utils';

import { ContentTypeCreateDto } from '../dto/contentType.dto';
import { ContentTypeService } from '../services/content-type.service';

import { ContentTypeController } from './content-type.controller';

describe('ContentTypeController (TypeORM)', () => {
  let module: TestingModule;
  let controller: ContentTypeController;
  let service: ContentTypeService;
  let logger: LoggerService;
  const createdIds = new Set<string>();

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [ContentTypeController],
      providers: [],
      typeorm: {
        fixtures: installContentTypeFixturesTypeOrm,
      },
    });
    module = testingModule;
    [controller, service] = await getMocks([
      ContentTypeController,
      ContentTypeService,
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
    it('creates a new content type', async () => {
      const payload = {
        name: 'Articles',
        schema: {
          type: 'object',
          properties: {
            body: { type: 'string', title: 'Body' },
          },
        },
      } as ContentTypeCreateDto;
      const created = await controller.create(payload);
      createdIds.add(created.id);

      expect(created).toMatchObject(payload);
    });
  });

  describe('find', () => {
    it('returns content types using find options', async () => {
      const result = await controller.findContentTypes({ take: 5, skip: 0 });

      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('findOne', () => {
    it('returns an existing content type', async () => {
      const [fixture] = contentTypeOrmFixtures;
      const existing = await service.findOne({
        where: { name: fixture.name },
      });
      expect(existing).toBeDefined();

      const found = await controller.findContentType(existing!.id);

      expect(found).toMatchObject({ id: existing!.id });
    });

    it('throws when not found', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.findContentType('00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundException);

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('updateOne', () => {
    it('updates an existing content type', async () => {
      const created = await controller.create({
        name: 'Docs',
        schema: {
          properties: {
            description: { type: 'string', title: 'Description' },
          },
        },
      });
      createdIds.add(created.id);

      const updated = await controller.updateOne(
        { name: 'Docs Updated' },
        created.id,
      );

      expect(updated.name).toBe('Docs Updated');
    });
  });

  describe('deleteOne', () => {
    it('removes an existing content type', async () => {
      const created = await controller.create({
        name: 'Temporary',
        schema: {},
      });
      const result = await controller.deleteOne(created.id);

      expect(result).toEqual({ acknowledged: true, deletedCount: 1 });
      const found = await service.findOne(created.id);
      expect(found).toBeNull();
    });

    it('throws when deletion removes nothing', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.deleteOne('00000000-0000-4000-8000-000000000001'),
      ).rejects.toThrow(NotFoundException);

      expect(warnSpy).toHaveBeenCalled();
    });
  });
});

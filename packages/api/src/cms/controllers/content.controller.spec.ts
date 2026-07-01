/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { NotFoundException } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';
import {
  contentFixtures,
  installContentFixturesTypeOrm,
} from '@/utils/test/fixtures/content';
import { installContentTypeFixturesTypeOrm } from '@/utils/test/fixtures/contenttype';
import { buildTestingMocks } from '@/utils/test/utils';

import { ContentTypeService } from '../services/content-type.service';
import { ContentService } from '../services/content.service';
import { RagService } from '../services/rag.service';

import { ContentController } from './content.controller';

describe('ContentController (TypeORM)', () => {
  let controller: ContentController;
  let contentService: ContentService;
  let contentTypeService: ContentTypeService;
  let contentRagService: RagService;
  let logger: LoggerService;
  const createdContentIds = new Set<string>();

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [ContentController],
      providers: [],
      typeorm: [
        {
          fixtures: [
            installContentTypeFixturesTypeOrm,
            installContentFixturesTypeOrm,
          ],
        },
      ],
    });
    [controller, contentService, contentTypeService, contentRagService] =
      await getMocks([
        ContentController,
        ContentService,
        ContentTypeService,
        RagService,
      ]);
    logger = controller.logger;
  });
  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of Array.from(createdContentIds)) {
      await contentService.deleteOne(id);
      createdContentIds.delete(id);
    }
  });

  describe('create', () => {
    it('creates content when content type exists', async () => {
      const contentType = await contentTypeService.findOne({
        where: { name: 'Product' },
      });
      expect(contentType).toBeDefined();

      const created = await controller.create({
        title: 'New content',
        contentType: contentType!.id,
        status: true,
        properties: { subtitle: 'Test' },
      });
      createdContentIds.add(created.id);

      expect(created).toMatchObject({
        title: 'New content',
        contentType: contentType!.id,
        status: true,
        properties: { subtitle: 'Test' },
      });
    });

    it('throws when content type is invalid', async () => {
      await expect(
        controller.create({
          title: 'Invalid',
          contentType: randomUUID(),
          status: true,
          properties: {},
        }),
      ).rejects.toThrow();
    });
  });

  describe('find', () => {
    it('retrieves content without populate', async () => {
      const result = await controller.findContents([], { take: 5, skip: 0 });

      expect(result.length).toBeGreaterThan(0);
    });

    it('retrieves populated content when requested', async () => {
      const findAndPopulateSpy = jest.spyOn(contentService, 'findAndPopulate');
      const result = await controller.findContents(['contentType'], {
        take: 5,
        skip: 0,
      });

      expect(result.length).toBeGreaterThan(0);
      expect(findAndPopulateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 0 }),
      );
      expect(findAndPopulateSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('findOne', () => {
    it('returns content without populate', async () => {
      const [existing] = await contentService.find({ take: 1 });
      expect(existing).toBeDefined();

      const found = await controller.findContent(existing.id, []);

      expect(found).toMatchObject({ id: existing.id });
    });

    it('returns populated content when allowed', async () => {
      const [existing] = await contentService.find({ take: 1 });
      expect(existing).toBeDefined();

      const findOneAndPopulateSpy = jest.spyOn(
        contentService,
        'findOneAndPopulate',
      );
      const found = await controller.findContent(existing.id, ['contentType']);

      expect(found).toMatchObject({ id: existing.id });
      expect(findOneAndPopulateSpy).toHaveBeenCalledWith(existing.id);
    });

    it('throws when content is missing', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.findContent('00000000-0000-4000-8000-000000000000', []),
      ).rejects.toThrow(NotFoundException);

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('findByType', () => {
    it('returns contents for a given content type', async () => {
      const [fixture] = contentFixtures;
      const type = await contentTypeService.findOne({
        where: { name: 'Product' },
      });
      expect(type).toBeDefined();

      const result = await controller.findByType(type!.id, {
        take: 10,
        skip: 0,
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((content) => content.title === fixture.title)).toBe(
        true,
      );
    });

    it('throws when content type does not exist', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.findByType('00000000-0000-4000-8000-000000000001', {
          take: 10,
          skip: 0,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('updateOne', () => {
    it('updates existing content', async () => {
      const contentType = await contentTypeService.findOne({
        where: { name: 'Product' },
      });
      const created = await controller.create({
        title: 'To update',
        contentType: contentType!.id,
        status: true,
        properties: {},
      });
      createdContentIds.add(created.id);

      const updated = await controller.updateOne(
        { title: 'Updated title' },
        created.id,
      );

      expect(updated.title).toBe('Updated title');
    });
  });

  describe('deleteOne', () => {
    it('deletes existing content', async () => {
      const contentType = await contentTypeService.findOne({
        where: { name: 'Product' },
      });
      const created = await controller.create({
        title: 'To delete',
        contentType: contentType!.id,
        status: true,
        properties: {},
      });
      const result = await controller.deleteOne(created.id);

      expect(result).toEqual({ acknowledged: true, deletedCount: 1 });
      const found = await contentService.findOne(created.id);
      expect(found).toBeNull();
    });

    it('throws when nothing is deleted', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.deleteOne('00000000-0000-4000-8000-000000000002'),
      ).rejects.toThrow(NotFoundException);

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('searchRag', () => {
    it('parses rag search options and forwards mode', async () => {
      const retrieveSpy = jest
        .spyOn(contentService, 'retrieve')
        .mockResolvedValue([]);

      await controller.searchRag('culture', 'lexical', '7', 'ct-1', '1');

      expect(retrieveSpy).toHaveBeenCalledWith('culture', {
        mode: 'lexical',
        limit: 7,
        contentTypeId: 'ct-1',
        includeInactive: true,
      });
    });

    it('ignores invalid optional query params in rag search', async () => {
      const retrieveSpy = jest
        .spyOn(contentService, 'retrieve')
        .mockResolvedValue([]);

      await controller.searchRag('culture', undefined, 'bad-limit');

      expect(retrieveSpy).toHaveBeenCalledWith('culture', {});
    });
  });

  describe('reindexRag', () => {
    it('queues rag reindex and returns acceptance response', async () => {
      const reindexSpy = jest
        .spyOn(contentRagService, 'scheduleReindexAll')
        .mockImplementation();
      const response = await controller.reindexRag();

      expect(reindexSpy).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ accepted: true });
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { OutgoingMessageType, ContentOptions } from '@hexabot-ai/types';

import { LoggerService } from '@/logger/logger.service';
import {
  contentFixtures,
  installContentFixturesTypeOrm,
} from '@/utils/test/fixtures/content';
import { installContentTypeFixturesTypeOrm } from '@/utils/test/fixtures/contenttype';
import { buildTestingMocks } from '@/utils/test/utils';

import { ContentTypeService } from './content-type.service';
import { ContentService } from './content.service';

describe('ContentService (TypeORM)', () => {
  let contentService: ContentService;
  let contentTypeService: ContentTypeService;
  let logger: LoggerService;
  const createdContentIds: string[] = [];

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [ContentService, ContentTypeService],
      typeorm: [
        {
          fixtures: [
            installContentTypeFixturesTypeOrm,
            installContentFixturesTypeOrm,
          ],
        },
      ],
    });
    [contentService, contentTypeService] = await getMocks([
      ContentService,
      ContentTypeService,
    ]);
    logger = contentService.logger;
  });
  afterEach(async () => {
    jest.clearAllMocks();
    if (createdContentIds.length > 0) {
      await Promise.all(
        createdContentIds.map(async (id) => {
          await contentService.deleteOne(id);
        }),
      );
      createdContentIds.length = 0;
    }
  });

  describe('findOneAndPopulate', () => {
    it('returns a content with its content type', async () => {
      const targetTitle = contentFixtures[0].title;
      const [target] = await contentService.find({
        where: { title: targetTitle },
        take: 1,
      });
      expect(target).toBeDefined();

      const result = await contentService.findOneAndPopulate(target.id);

      expect(result).toBeDefined();
      expect(result?.title).toBe(targetTitle);
      expect(result?.contentType?.id).toBe(target.contentType);
    });

    it('returns null when content is missing', async () => {
      const result = await contentService.findOneAndPopulate(
        '00000000-0000-4000-8000-000000000000',
      );

      expect(result).toBeNull();
    });
  });

  describe('findAndPopulate', () => {
    it('returns contents with their types', async () => {
      const results = await contentService.findAndPopulate({
        take: 5,
        skip: 0,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(
        results.every(
          (content) =>
            typeof content.contentType === 'object' &&
            content.contentType !== null &&
            typeof content.contentType.id === 'string',
        ),
      ).toBe(true);
    });
  });

  describe('textSearch', () => {
    it('matches content by keyword', async () => {
      const keyword =
        contentFixtures[0].title?.split(' ')[0].toLowerCase() || '';
      const results = await contentService.textSearch(keyword);

      expect(
        results.some((content) => content.title === contentFixtures[0].title),
      ).toBe(true);
      expect(
        results.every(
          (content) =>
            typeof content.contentType === 'object' &&
            content.contentType !== null &&
            typeof content.contentType.id === 'string',
        ),
      ).toBe(true);
    });
  });

  describe('getContent', () => {
    const baseOptions: ContentOptions = {
      display: OutgoingMessageType.list,
      buttons: [],
      fields: {
        title: 'title',
        subtitle: 'subtitle',
        image_url: 'image_url',
      },
      limit: 3,
    };

    it('returns paginated content list ordered by creation date', async () => {
      const total = await contentService.count({ where: { status: true } });
      const result = await contentService.getContent(baseOptions, 0);

      expect(result.elements.length).toBeGreaterThan(0);
      expect(result.pagination).toEqual({
        total,
        skip: 0,
        limit: baseOptions.limit,
      });
    });

    it('throws when no content matches the query', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');
      const errorSpy = jest.spyOn(logger, 'error');

      await expect(
        contentService.getContent(
          {
            ...baseOptions,
            contentType: '00000000-0000-4000-8000-000000000001',
          },
          0,
        ),
      ).rejects.toThrow('No content found');

      expect(warnSpy).toHaveBeenCalledWith('No content found', {
        status: true,
        contentType: { id: '00000000-0000-4000-8000-000000000001' },
      });
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('parseAndSaveDataset', () => {
    it('stores rows parsed from CSV as content records', async () => {
      const [existingContentType] = await contentTypeService.find({ take: 1 });
      expect(existingContentType).toBeDefined();

      const csv =
        'title,status,description,subtitle\nDemo,true,Description,Subtitle';
      const created = await contentService.parseAndSaveDataset(
        csv,
        existingContentType,
      );

      expect(created).toBeDefined();
      if (!created) {
        throw new Error('Expected dataset parsing to create content records');
      }

      createdContentIds.push(...created.map((content) => content.id));
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        title: 'Demo',
        contentType: existingContentType.id,
        status: true,
        properties: {
          description: 'Description',
          subtitle: 'Subtitle',
        },
      });
    });
  });
});

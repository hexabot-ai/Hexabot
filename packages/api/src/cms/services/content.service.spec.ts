/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ContentOptions,
  ContentType,
  DEFAULT_CONTENT_TYPE_SCHEMA,
  OutgoingMessageType,
} from '@hexabot-ai/types';
import { BadRequestException } from '@nestjs/common';

import { HelperService } from '@/helper/helper.service';
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
  let helperService: HelperService;
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
    [contentService, contentTypeService, helperService] = await getMocks([
      ContentService,
      ContentTypeService,
      HelperService,
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

  describe('retrieve', () => {
    it('reports an unavailable configured helper as a configuration error', async () => {
      jest
        .spyOn(helperService, 'getDefaultHelper')
        .mockRejectedValue(new Error('missing helper'));

      await expect(contentService.retrieve('query')).rejects.toThrow(
        'The configured default RAG helper is unavailable. missing helper',
      );
    });

    it('does not swallow helper retrieval failures', async () => {
      const retrieve = jest.fn().mockRejectedValue(new Error('SQL failed'));
      jest
        .spyOn(helperService, 'getDefaultHelper')
        .mockResolvedValue({ retrieve } as never);

      await expect(contentService.retrieve('query')).rejects.toThrow(
        'SQL failed',
      );
    });

    describe('properties', () => {
      const toHit = ({ id, title }: { id: string; title: string }) => ({
        contentId: id,
        title,
        text: 'a chunk without properties',
        source: 'test-helper',
      });

      it('attaches the requested properties without passing them to the helper', async () => {
        const [jean] = await contentService.find({ where: { title: 'Jean' } });
        const [adapter] = await contentService.find({
          where: { title: 'Adaptateur' },
        });
        const hits = [toHit(jean), toHit(adapter)];
        const retrieve = jest.fn().mockResolvedValue(hits);
        jest
          .spyOn(helperService, 'getDefaultHelper')
          .mockResolvedValue({ retrieve } as never);

        const result = await contentService.retrieve('query', {
          limit: 2,
          properties: ['subtitle', 'image', 'missing'],
        });

        expect(retrieve).toHaveBeenCalledWith('query', { limit: 2 });
        expect(result).toEqual([
          {
            ...hits[0],
            properties: {
              subtitle: jean.properties?.subtitle,
              image: jean.properties?.image,
            },
          },
          {
            ...hits[1],
            properties: {
              subtitle: adapter.properties?.subtitle,
              image: adapter.properties?.image,
            },
          },
        ]);
      });

      it('attaches no properties to a hit whose content no longer exists', async () => {
        const hit = toHit({
          id: '00000000-0000-4000-8000-000000000000',
          title: 'Deleted',
        });
        jest.spyOn(helperService, 'getDefaultHelper').mockResolvedValue({
          retrieve: jest.fn().mockResolvedValue([hit]),
        } as never);

        await expect(
          contentService.retrieve('query', { properties: ['subtitle'] }),
        ).resolves.toEqual([{ ...hit, properties: {} }]);
      });

      it('does not read the contents when no property is requested', async () => {
        const hits = [toHit({ id: 'content-1', title: 'Content' })];
        jest.spyOn(helperService, 'getDefaultHelper').mockResolvedValue({
          retrieve: jest.fn().mockResolvedValue(hits),
        } as never);
        const find = jest.spyOn(contentService, 'find');

        await expect(
          contentService.retrieve('query', { properties: [] }),
        ).resolves.toBe(hits);
        expect(find).not.toHaveBeenCalled();
        find.mockRestore();
      });
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

  describe('properties validation', () => {
    let article: ContentType;
    const image = { type: 'image', payload: { id: 'attachment-id' } };

    beforeAll(async () => {
      article = await contentTypeService.create({
        name: 'Article',
        schema: {
          ...DEFAULT_CONTENT_TYPE_SCHEMA,
          properties: {
            ...DEFAULT_CONTENT_TYPE_SCHEMA.properties,
            body: { type: 'textarea', title: 'Body' },
            link: { type: 'uri', title: 'Link' },
            featured: { type: 'boolean', title: 'Featured' },
            image: { type: 'file', title: 'Image' },
          },
          required: ['link'],
        } as any,
      });
    });
    afterAll(async () => {
      await contentTypeService.deleteOne(article.id);
    });

    it('creates contents whose properties match their content type', async () => {
      const created = await contentService.create({
        contentType: article.id,
        title: 'Valid',
        properties: { link: 'https://hexabot.ai', body: '', image },
      });

      createdContentIds.push(created.id);
      expect(created.properties).toEqual({
        link: 'https://hexabot.ai',
        body: '',
        image,
      });
    });

    it('refuses properties that do not match the content type', async () => {
      await expect(
        contentService.create({
          contentType: article.id,
          title: 'Invalid',
          properties: { link: 'hexabot.ai', featured: 'yes', extra: 'value' },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Invalid properties for content type "Article": link: Invalid URL; featured: Invalid input: expected boolean, received string; Unknown field(s) "extra": the content type has "body", "link", "featured", "image" ("title" and "status" are not properties)',
        ),
      );
      await expect(
        contentService.create({ contentType: article.id, title: 'Empty' }),
      ).rejects.toThrow(/link: Invalid input: expected string/);
    });

    it('refuses an unknown content type', async () => {
      await expect(
        contentService.create({
          contentType: '9b2b7a52-4d35-4c43-9a8f-0c0b9c0f5a10',
          title: 'Orphan',
        }),
      ).rejects.toThrow(
        'Content type "9b2b7a52-4d35-4c43-9a8f-0c0b9c0f5a10" does not exist',
      );
    });

    it('names the content that failed in createMany', async () => {
      await expect(
        contentService.createMany([
          {
            contentType: article.id,
            title: 'First',
            properties: { link: 'https://hexabot.ai' },
          },
          { contentType: article.id, title: 'Second', properties: {} },
        ]),
      ).rejects.toThrow(/^Content 2: Invalid properties/);
    });

    it('checks the properties on update only when they or the content type change', async () => {
      // Stored before the properties were checked.
      const stored = await contentService.repository.create({
        contentType: article.id,
        title: 'Legacy',
        properties: { link: 'hexabot.ai' },
      });
      createdContentIds.push(stored.id);
      const [product] = await contentTypeService.find({
        where: { name: 'Product' },
      });

      await expect(
        contentService.updateOne(stored.id, { status: false }),
      ).resolves.toMatchObject({ status: false });
      await expect(
        contentService.updateOne(stored.id, {
          properties: { link: 'still-not-a-url' },
        }),
      ).rejects.toThrow(/link: Invalid URL/);
      await expect(
        contentService.updateOne(stored.id, { contentType: product.id }),
      ).rejects.toThrow(/content type "Product": Unknown field\(s\) "link"/);
      await expect(
        contentService.updateOne(stored.id, {
          properties: { link: 'https://hexabot.ai' },
        }),
      ).resolves.toMatchObject({ properties: { link: 'https://hexabot.ai' } });
    });

    it('reads CSV cells as the values of their fields', async () => {
      const created = await contentService.parseAndSaveDataset(
        'title,status,link,featured,image,body\nDemo,true,https://hexabot.ai,1,https://hexabot.ai/a.png,',
        article,
      );

      createdContentIds.push(...(created ?? []).map(({ id }) => id));
      expect(created?.[0]?.properties).toEqual({
        link: 'https://hexabot.ai',
        featured: true,
        image: {
          type: 'unknown',
          payload: { url: 'https://hexabot.ai/a.png' },
        },
      });
    });

    it('reports the CSV rows whose properties are invalid', async () => {
      await expect(
        contentService.parseAndSaveDataset(
          'title,status,link,featured\nDemo,true,https://hexabot.ai,true\nBroken,true,,maybe',
          article,
        ),
      ).rejects.toThrow(
        'Row 3: Invalid properties for content type "Article": link: Invalid input: expected string, received undefined; featured: Invalid input: expected boolean, received string',
      );
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

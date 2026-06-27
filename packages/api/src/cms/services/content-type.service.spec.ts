/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  contentTypeOrmFixtures,
  installContentTypeFixturesTypeOrm,
} from '@/utils/test/fixtures/contenttype';
import { buildTestingMocks } from '@/utils/test/utils';

import { ContentTypeDto } from '../dto/contentType.dto';

import { ContentTypeService } from './content-type.service';

describe('ContentTypeService (TypeORM)', () => {
  let service: ContentTypeService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [ContentTypeService],
      typeorm: {
        fixtures: installContentTypeFixturesTypeOrm,
      },
    });
    [service] = await getMocks([ContentTypeService]);
  });
  afterEach(async () => {
    jest.clearAllMocks();
    if (createdIds.length > 0) {
      await Promise.all(
        createdIds.map(async (id) => {
          await service.deleteOne(id);
        }),
      );
      createdIds.length = 0;
    }
  });

  describe('create', () => {
    it('applies default fields when none are provided', async () => {
      const payload = {
        name: 'Blog posts',
        schema: {},
      } as ContentTypeDto['actions']['create'];
      const created = await service.create(payload);
      createdIds.push(created.id);

      expect(created).toMatchObject({
        id: expect.any(String),
        name: payload.name,
      });
      expect(created.schema.properties).toEqual(
        expect.objectContaining({
          title: { type: 'string', title: 'Title' },
          status: { type: 'boolean', title: 'Status' },
        }),
      );
    });
  });

  describe('deleteCascadeOne', () => {
    it('removes the requested content type', async () => {
      const baseName = `${contentTypeOrmFixtures[0].name}-to-delete`;
      const created = await service.create({
        name: baseName,
        schema: {
          type: 'object',
          properties: {},
        },
      });
      createdIds.push(created.id);

      const deleted = await service.deleteOne(created.id);
      createdIds.splice(createdIds.indexOf(created.id), 1);
      const found = await service.findOne(created.id);

      expect(deleted).toEqual({ acknowledged: true, deletedCount: 1 });
      expect(found).toBeNull();
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { TestingModule } from '@nestjs/testing';

import { buildTestingMocks } from '@/utils/test/utils';

import { ContentTypeRepository } from './content-type.repository';
import { ContentRepository } from './content.repository';

describe('ContentTypeRepository (TypeORM)', () => {
  let module: TestingModule;
  let repository: ContentTypeRepository;
  let contentRepository: ContentRepository;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      providers: [ContentRepository, ContentTypeRepository],
    });

    module = testing.module;
    [repository, contentRepository] = await testing.getMocks([
      ContentTypeRepository,
      ContentRepository,
    ]);
  });

  describe('deleteOne cascade', () => {
    it('removes related contents when deleting a content type', async () => {
      const created = await repository.create({
        name: `cascade-${randomUUID()}`,
        schema: {
          properties: {
            title: { type: 'string', title: 'Title' },
            status: { type: 'boolean', title: 'Status' },
          },
        },
      });

      await contentRepository.create({
        title: 'related-content-a',
        contentType: created.id,
        status: true,
        properties: {},
      });
      await contentRepository.create({
        title: 'related-content-b',
        contentType: created.id,
        status: true,
        properties: {},
      });

      const result = await repository.deleteOne(created.id);

      expect(result.deletedCount).toBe(1);

      const remainingContents = await contentRepository.find({
        where: { contentType: { id: created.id } },
      });
      expect(remainingContents).toHaveLength(0);

      const deletedType = await repository.findOne({
        where: { id: created.id },
      });
      expect(deletedType).toBeNull();
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  installMemoryDefinitionFixturesTypeOrm,
  memoryDefinitionFixtureIds,
  memoryDefinitionOrmFixtures,
} from '@/utils/test/fixtures/memory-definition';
import { installMemoryRecordFixturesTypeOrm } from '@/utils/test/fixtures/memory-record';
import { buildTestingMocks } from '@/utils/test/utils';

import { MemoryScope } from '../types';

import { MemoryDefinitionService } from './memory-definition.service';

const globalDefinition = memoryDefinitionOrmFixtures.find(
  (fixture) => fixture.id === memoryDefinitionFixtureIds.global,
)!;
const workflowDefinition = memoryDefinitionOrmFixtures.find(
  (fixture) => fixture.id === memoryDefinitionFixtureIds.workflow,
)!;
const runDefinition = memoryDefinitionOrmFixtures.find(
  (fixture) => fixture.id === memoryDefinitionFixtureIds.run,
)!;

describe('MemoryDefinitionService (TypeORM)', () => {
  let memoryDefinitionService: MemoryDefinitionService;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [MemoryDefinitionService],
      typeorm: {
        fixtures: [
          installMemoryDefinitionFixturesTypeOrm,
          installMemoryRecordFixturesTypeOrm,
        ],
      },
    });

    [memoryDefinitionService] = await testing.getMocks([
      MemoryDefinitionService,
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });
  describe('findBySlug', () => {
    it('returns the matching definition', async () => {
      const result = await memoryDefinitionService.findBySlug(
        globalDefinition.slug,
      );

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        id: globalDefinition.id,
        name: globalDefinition.name,
        slug: globalDefinition.slug,
        scope: globalDefinition.scope,
      });
    });

    it('returns null when no definition matches the slug', async () => {
      const result = await memoryDefinitionService.findBySlug('missing_slug');

      expect(result).toBeNull();
    });
  });

  describe('buildDefinitionCache', () => {
    it('returns only global definitions when workflowId is omitted', async () => {
      const cache = await memoryDefinitionService.buildDefinitionCache();

      expect(cache.get(globalDefinition.slug)?.id).toBe(globalDefinition.id);
      const scopes = new Set(
        Array.from(cache.values()).map((definition) => definition.scope),
      );
      expect(scopes).toEqual(new Set([MemoryScope.global]));
    });

    it('includes requested definitions when ids are provided', async () => {
      const cache = await memoryDefinitionService.buildDefinitionCache([
        memoryDefinitionFixtureIds.workflow,
        memoryDefinitionFixtureIds.run,
      ]);

      expect(cache.get(globalDefinition.slug)?.id).toBe(globalDefinition.id);
      expect(cache.get(workflowDefinition.slug)?.id).toBe(
        workflowDefinition.id,
      );
      expect(cache.get(runDefinition.slug)?.id).toBe(runDefinition.id);
      expect(cache.size).toBe(3);
    });

    it('fails when one or more requested definitions are missing', async () => {
      await expect(
        memoryDefinitionService.buildDefinitionCache([
          memoryDefinitionFixtureIds.workflow,
          'dddddddd-dddd-dddd-dddd-dddddddddddd',
        ]),
      ).rejects.toThrow(
        'Unable to find memory definition(s): dddddddd-dddd-dddd-dddd-dddddddddddd',
      );
    });
  });
});

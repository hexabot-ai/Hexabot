/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  installMemoryDefinitionFixturesTypeOrm,
  memoryDefinitionFixtureIds,
  memoryDefinitionOrmFixtures,
} from '@/utils/test/fixtures/memory-definition';
import {
  installMemoryRecordFixturesTypeOrm,
  memoryRecordFixtureIds,
  memoryRecordOrmFixtures,
  memoryRunFixtureId,
  memoryWorkflowFixtureId,
} from '@/utils/test/fixtures/memory-record';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import { getLastTypeOrmDataSource } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';

import { MemoryDefinitionOrmEntity } from '../entities/memory-definition.entity';
import { MemoryScope } from '../types';

import { MemoryRecordService } from './memory-record.service';

const globalDefinition = memoryDefinitionOrmFixtures.find(
  (fixture) => fixture.id === memoryDefinitionFixtureIds.global,
)!;
const activeGlobalRecord = memoryRecordOrmFixtures.find(
  (fixture) => fixture.id === memoryRecordFixtureIds.globalActive,
)!;
const workflowRecord = memoryRecordOrmFixtures.find(
  (fixture) => fixture.id === memoryRecordFixtureIds.workflow,
)!;
const runRecord = memoryRecordOrmFixtures.find(
  (fixture) => fixture.id === memoryRecordFixtureIds.run,
)!;

describe('MemoryRecordService (TypeORM)', () => {
  let memoryRecordService: MemoryRecordService;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [MemoryRecordService],
      typeorm: {
        fixtures: [
          installMemoryDefinitionFixturesTypeOrm,
          installMemoryRecordFixturesTypeOrm,
        ],
      },
    });

    [memoryRecordService] = await testing.getMocks([MemoryRecordService]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });
  describe('findActiveByScope', () => {
    it('throws when ownerId is missing', async () => {
      await expect(
        memoryRecordService.findActiveByScope({
          ownerId: undefined as unknown as string,
        }),
      ).rejects.toThrow('An owner id is required to build memory store.');
    });

    it('returns active global records when workflowId and runId are omitted', async () => {
      const records = await memoryRecordService.findActiveByScope({
        ownerId: userFixtureIds.admin,
      });

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(memoryRecordFixtureIds.globalActive);
      expect(records[0].definition.scope).toBe(MemoryScope.global);
      expect(records[0].value).toEqual(activeGlobalRecord.value);
    });

    it('returns active scoped records when workflowId and runId are provided', async () => {
      const records = await memoryRecordService.findActiveByScope({
        ownerId: userFixtureIds.admin,
        workflowId: memoryWorkflowFixtureId,
        runId: memoryRunFixtureId,
      });
      const ids = records.map((record) => record.id);
      const globalEntry = records.find(
        (record) => record.id === memoryRecordFixtureIds.globalActive,
      );
      const workflowEntry = records.find(
        (record) => record.id === memoryRecordFixtureIds.workflow,
      );
      const runEntry = records.find(
        (record) => record.id === memoryRecordFixtureIds.run,
      );

      expect(ids).toEqual([
        memoryRecordFixtureIds.globalActive,
        memoryRecordFixtureIds.workflow,
        memoryRecordFixtureIds.run,
      ]);
      expect(ids).not.toContain(memoryRecordFixtureIds.globalExpired);
      expect(globalEntry?.definition.scope).toBe(MemoryScope.global);
      expect(workflowEntry?.definition.scope).toBe(MemoryScope.workflow);
      expect(runEntry?.definition.scope).toBe(MemoryScope.run);
      expect(workflowEntry?.value).toEqual(workflowRecord.value);
      expect(runEntry?.value).toEqual(runRecord.value);
    });

    it('builds thread-scoped filters when thread id is provided', async () => {
      const findAndPopulateSpy = jest
        .spyOn(memoryRecordService, 'findAndPopulate')
        .mockResolvedValue([]);

      await memoryRecordService.findActiveByScope({
        ownerId: userFixtureIds.admin,
        threadId: 'thread-1',
      });

      expect(findAndPopulateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({
              owner: { id: userFixtureIds.admin },
              definition: { scope: MemoryScope.thread },
              thread: { id: 'thread-1' },
            }),
          ]),
        }),
      );
    });
  });

  describe('upsertScopedRecord', () => {
    it('updates the most recent scoped record and refreshes TTL metadata', async () => {
      const now = new Date('2024-07-01T10:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      const updatedValue = { name: 'Updated Global' };
      const existing = await memoryRecordService.findOne({
        where: {
          definition: { id: globalDefinition.id },
          owner: { id: userFixtureIds.admin },
        },
        order: {
          updatedAt: 'DESC',
          createdAt: 'DESC',
        },
      });

      expect(existing).not.toBeNull();

      await memoryRecordService.upsertScopedRecord({
        definition: {
          id: globalDefinition.id,
          scope: globalDefinition.scope,
          ttlSeconds: globalDefinition.ttlSeconds ?? null,
        },
        ownerId: userFixtureIds.admin,
        value: updatedValue,
      });

      const stored = await memoryRecordService.findOne(existing!.id);
      const ttlSeconds = globalDefinition.ttlSeconds ?? null;
      const expectedExpiresAt =
        ttlSeconds && ttlSeconds > 0
          ? new Date(now.getTime() + ttlSeconds * 1000)
          : null;

      expect(stored).not.toBeNull();
      expect(stored!.id).toBe(existing!.id);
      expect(stored!.definition).toBe(globalDefinition.id);
      expect(stored!.value).toEqual(updatedValue);
      expect(stored!.ttlSeconds ?? null).toBe(ttlSeconds);
      expect(stored!.expiresAt?.getTime()).toBe(expectedExpiresAt?.getTime());
    });

    it('creates a new record when no match exists', async () => {
      const now = new Date('2024-07-02T10:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      const dataSource = getLastTypeOrmDataSource();
      const definitionRepository = dataSource.getRepository(
        MemoryDefinitionOrmEntity,
      );
      const rawId = randomUUID();
      const slug = `test_memory_${rawId.replace(/-/g, '_')}`;
      const definition = await definitionRepository.save(
        definitionRepository.create({
          id: rawId,
          name: `Test Memory ${slug}`,
          slug,
          scope: MemoryScope.global,
          schema: {
            type: 'object',
            properties: { flag: { type: 'boolean' } },
            additionalProperties: true,
          },
          ttlSeconds: 90,
        }),
      );
      const value = { flag: true };

      await memoryRecordService.upsertScopedRecord({
        definition: {
          id: definition.id,
          scope: definition.scope,
          ttlSeconds: definition.ttlSeconds ?? null,
        },
        ownerId: userFixtureIds.admin,
        value,
      });

      const stored = await memoryRecordService.findOne({
        where: {
          definition: { id: definition.id },
          owner: { id: userFixtureIds.admin },
        },
        order: {
          createdAt: 'DESC',
        },
      });
      const ttlSeconds = definition.ttlSeconds ?? null;
      const expectedExpiresAt =
        ttlSeconds && ttlSeconds > 0
          ? new Date(now.getTime() + ttlSeconds * 1000)
          : null;

      expect(stored).not.toBeNull();
      expect(stored!.definition).toBe(definition.id);
      expect(stored!.value).toEqual(value);
      expect(stored!.ttlSeconds ?? null).toBe(ttlSeconds);
      expect(stored!.expiresAt?.getTime()).toBe(expectedExpiresAt?.getTime());
      expect(stored!.workflow).toBeUndefined();
      expect(stored!.run).toBeUndefined();
    });

    it('creates thread-scoped record with thread relation', async () => {
      const createSpy = jest
        .spyOn(memoryRecordService, 'create')
        .mockResolvedValue({} as any);
      jest.spyOn(memoryRecordService, 'findOne').mockResolvedValue(null);

      await memoryRecordService.upsertScopedRecord({
        definition: {
          id: globalDefinition.id,
          scope: MemoryScope.thread,
          ttlSeconds: null,
        },
        ownerId: userFixtureIds.admin,
        threadId: 'thread-1',
        value: { step: 'threaded' },
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: userFixtureIds.admin,
          workflow: null,
          thread: 'thread-1',
          run: null,
          value: { step: 'threaded' },
        }),
      );
    });
  });
});

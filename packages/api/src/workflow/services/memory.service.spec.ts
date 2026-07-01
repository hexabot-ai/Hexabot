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
import {
  installMemoryRecordFixturesTypeOrm,
  memoryRecordFixtureIds,
  memoryRecordOrmFixtures,
  memoryRunFixtureId,
  memoryWorkflowFixtureId,
} from '@/utils/test/fixtures/memory-record';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';

import type { WorkflowRuntimeContext } from '../contexts/workflow-runtime.context';
import { SchemaInstance } from '../utils/schema-instance';

import { MemoryRecordService } from './memory-record.service';
import { MemoryService } from './memory.service';

const globalDefinition = memoryDefinitionOrmFixtures.find(
  (fixture) => fixture.id === memoryDefinitionFixtureIds.global,
)!;
const workflowDefinition = memoryDefinitionOrmFixtures.find(
  (fixture) => fixture.id === memoryDefinitionFixtureIds.workflow,
)!;
const runDefinition = memoryDefinitionOrmFixtures.find(
  (fixture) => fixture.id === memoryDefinitionFixtureIds.run,
)!;
const expiredGlobalRecord = memoryRecordOrmFixtures.find(
  (fixture) => fixture.id === memoryRecordFixtureIds.globalExpired,
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
const createContext = (): WorkflowRuntimeContext =>
  ({ state: {} as any }) as WorkflowRuntimeContext;

describe('MemoryService (TypeORM)', () => {
  let memoryService: MemoryService;
  let memoryRecordService: MemoryRecordService;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [MemoryService],
      typeorm: {
        fixtures: [
          installMemoryDefinitionFixturesTypeOrm,
          installMemoryRecordFixturesTypeOrm,
        ],
      },
    });

    [memoryService, memoryRecordService] = await testing.getMocks([
      MemoryService,
      MemoryRecordService,
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });
  it('throws when ownerId is missing', async () => {
    const findSpy = jest.spyOn(memoryRecordService, 'findAndPopulate');
    const context = createContext();
    await expect(
      memoryService.buildStore(
        { ownerId: undefined as unknown as string },
        context,
      ),
    ).rejects.toThrow('An owner id is required to build memory store.');
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('returns only global memory when workflowId and runId are omitted', async () => {
    const context = createContext();
    const store = await memoryService.buildStore(
      {
        ownerId: userFixtureIds.admin,
      },
      context,
    );

    expect(store.raw).toEqual({
      [globalDefinition.slug]: activeGlobalRecord.value,
    });
    expect(store.instances[globalDefinition.slug]).toBeInstanceOf(
      SchemaInstance,
    );
    expect(store.instances[globalDefinition.slug].data).toEqual(
      activeGlobalRecord.value,
    );
  });

  it('includes workflow/run memory and skips expired records', async () => {
    const context = createContext();
    const store = await memoryService.buildStore(
      {
        ownerId: userFixtureIds.admin,
        workflowId: memoryWorkflowFixtureId,
        runId: memoryRunFixtureId,
        memoryDefinitionIds: [
          memoryDefinitionFixtureIds.workflow,
          memoryDefinitionFixtureIds.run,
        ],
      },
      context,
    );

    expect(store.raw[globalDefinition.slug]).toEqual(activeGlobalRecord.value);
    expect(store.raw[workflowDefinition.slug]).toEqual(workflowRecord.value);
    expect(store.raw[runDefinition.slug]).toEqual(runRecord.value);
    expect(store.raw[globalDefinition.slug]).not.toEqual(
      expiredGlobalRecord.value,
    );
    expect(store.instances[workflowDefinition.slug]).toBeInstanceOf(
      SchemaInstance,
    );
    expect(store.instances[runDefinition.slug]).toBeInstanceOf(SchemaInstance);
  });

  it('passes threadId when loading scoped memory records', async () => {
    const findScopedSpy = jest.spyOn(memoryRecordService, 'findActiveByScope');
    const context = createContext();

    await memoryService.buildStore(
      {
        ownerId: userFixtureIds.admin,
        workflowId: memoryWorkflowFixtureId,
        threadId: 'thread-1',
      },
      context,
    );

    expect(findScopedSpy).toHaveBeenCalledWith({
      ownerId: userFixtureIds.admin,
      workflowId: memoryWorkflowFixtureId,
      threadId: 'thread-1',
      runId: undefined,
    });
  });

  it('updates memory and persists it through the store proxy', async () => {
    const context = createContext();
    const store = await memoryService.buildStore(
      {
        ownerId: userFixtureIds.admin,
      },
      context,
    );
    const updatedValue = { name: 'Updated' };
    const result = await store.updateRecord(
      globalDefinition.slug,
      updatedValue,
    );

    expect(result).toEqual(updatedValue);
    expect(store.raw[globalDefinition.slug]).toEqual(updatedValue);
    expect(store.instances[globalDefinition.slug]).toBeInstanceOf(
      SchemaInstance,
    );
    expect(store.instances[globalDefinition.slug].data).toEqual(updatedValue);

    const saved = await memoryRecordService.findOne({
      where: {
        definition: { id: globalDefinition.id },
        owner: { id: userFixtureIds.admin },
      },
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });

    expect(saved?.value).toEqual(updatedValue);
  });

  it('updates multiple memory records and persists them through the store proxy', async () => {
    const context = createContext();
    const store = await memoryService.buildStore(
      {
        ownerId: userFixtureIds.admin,
        workflowId: memoryWorkflowFixtureId,
        runId: memoryRunFixtureId,
        memoryDefinitionIds: [
          memoryDefinitionFixtureIds.workflow,
          memoryDefinitionFixtureIds.run,
        ],
      },
      context,
    );
    const updatedValues = {
      [globalDefinition.slug]: { name: 'Bulk Global' },
      [workflowDefinition.slug]: { step: 'bulk' },
      [runDefinition.slug]: { count: 9 },
    };
    const results = await store.update(updatedValues);

    expect(results).toEqual(updatedValues);
    expect(store.raw[globalDefinition.slug]).toEqual(
      updatedValues[globalDefinition.slug],
    );
    expect(store.raw[workflowDefinition.slug]).toEqual(
      updatedValues[workflowDefinition.slug],
    );
    expect(store.raw[runDefinition.slug]).toEqual(
      updatedValues[runDefinition.slug],
    );

    const savedGlobal = await memoryRecordService.findOne({
      where: {
        definition: { id: globalDefinition.id },
        owner: { id: userFixtureIds.admin },
      },
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });
    const savedWorkflow = await memoryRecordService.findOne({
      where: {
        definition: { id: workflowDefinition.id },
        owner: { id: userFixtureIds.admin },
        workflow: { id: memoryWorkflowFixtureId },
      },
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });
    const savedRun = await memoryRecordService.findOne({
      where: {
        definition: { id: runDefinition.id },
        owner: { id: userFixtureIds.admin },
        run: { id: memoryRunFixtureId },
      },
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });

    expect(savedGlobal?.value).toEqual(updatedValues[globalDefinition.slug]);
    expect(savedWorkflow?.value).toEqual(
      updatedValues[workflowDefinition.slug],
    );
    expect(savedRun?.value).toEqual(updatedValues[runDefinition.slug]);
  });
});

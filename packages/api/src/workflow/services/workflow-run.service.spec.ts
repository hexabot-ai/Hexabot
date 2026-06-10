/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  WorkflowDefinition,
  Workflow as WorkflowHelper,
  WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import { Workflow, WorkflowRun, WorkflowRunFull } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import { WorkflowVersionOrmEntity } from '../entities/workflow-version.entity';
import { WorkflowOrmEntity } from '../entities/workflow.entity';
import { WorkflowRunRepository } from '../repositories/workflow-run.repository';
import { WorkflowRepository } from '../repositories/workflow.repository';
import { WorkflowType, WorkflowVersionAction } from '../types';

import { WorkflowRunService } from './workflow-run.service';
import { WorkflowVersionService } from './workflow-version.service';
import { WorkflowService } from './workflow.service';

describe('WorkflowRunService (TypeORM)', () => {
  let module: TestingModule;
  let workflowService: WorkflowService;
  let workflowRepository: WorkflowRepository;
  let workflowRunService: WorkflowRunService;
  let workflowRunRepository: WorkflowRunRepository;
  let workflowVersionService: WorkflowVersionService;
  let workflow: Workflow;
  let workflowRun: WorkflowRun;
  let workflowVersionId: string | null;
  let counter = 0;
  let creatorId: string;
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  };
  const buildWorkflowDefinition = (): WorkflowDefinition => ({
    defs: {
      greet: { kind: 'task', action: 'greet' },
    },
    flow: [{ do: 'greet' }],
    outputs: { result: '=1' },
  });
  const snapshot: WorkflowSnapshot = {
    status: 'running',
    actions: {
      greet: {
        id: 'greet',
        name: 'Greet',
        status: 'running',
      },
    },
  };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WorkflowService,
        WorkflowRepository,
        WorkflowRunService,
        WorkflowRunRepository,
        WorkflowVersionService,
        { provide: WEBSOCKET_GATEWAY, useValue: websocketGatewayMock },
      ],
      typeorm: {
        entities: [
          WorkflowOrmEntity,
          WorkflowRunOrmEntity,
          WorkflowVersionOrmEntity,
        ],
        fixtures: [installUserFixturesTypeOrm],
      },
    });

    module = testing.module;
    [
      workflowService,
      workflowRepository,
      workflowRunService,
      workflowRunRepository,
      workflowVersionService,
    ] = await testing.getMocks([
      WorkflowService,
      WorkflowRepository,
      WorkflowRunService,
      WorkflowRunRepository,
      WorkflowVersionService,
    ]);
  });

  beforeEach(async () => {
    await workflowRunRepository.deleteMany();
    await workflowRepository.deleteMany();
    creatorId = userFixtureIds.admin;

    workflow = await workflowService.create({
      name: `Run workflow ${++counter}`,
      description: 'Workflow for run tests',
      type: WorkflowType.conversational,
      schedule: null,
      createdBy: creatorId,
    });

    const definition = buildWorkflowDefinition();
    await workflowVersionService.commit({
      workflow: workflow.id,
      definitionYml: WorkflowHelper.stringifyDefinition(definition),
      action: WorkflowVersionAction.create,
      createdBy: creatorId,
    });

    workflow = (await workflowService.findOne(workflow.id))!;
    workflowVersionId = workflow.currentVersion ?? null;

    workflowRun = await workflowRunService.create({
      workflow: workflow.id,
      workflowVersion: workflowVersionId,
      status: 'idle',
      input: { foo: 'bar' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  describe('state transitions', () => {
    it('marks a run as running and forwards state', async () => {
      const payload = {
        snapshot,
        context: { user: 'demo' },
        lastResumeData: { resumed: true },
      };
      const updateSpy = jest.spyOn(workflowRunRepository, 'updateOne');
      const updated = await workflowRunService.markRunning(
        workflowRun.id,
        payload,
      );
      const stored = await workflowRunService.findOne(workflowRun.id);

      expect(updateSpy).toHaveBeenCalledWith(
        workflowRun.id,
        {
          status: 'running',
          ...payload,
        },
        undefined,
      );
      expect(updated.status).toBe('running');
      expect(updated.snapshot).toEqual(payload.snapshot);
      expect(updated.context).toEqual(payload.context);
      expect(updated.lastResumeData).toEqual(payload.lastResumeData);
      expect(stored?.status).toBe('running');
    });

    it('marks a run as suspended with metadata and timestamps', async () => {
      const now = new Date('2024-10-10T10:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      const payload = {
        stepId: 'greet',
        reason: 'awaiting input',
        data: { question: 'name' },
        stepExecId: 'greet#1',
        suspendIndex: 2,
        suspendKey: 'index:2',
        awaitResults: { 'index:1': { answer: 'Alice' } },
        lastResumeData: { source: 'suspend' },
        snapshot,
        context: { lang: 'en' },
      };
      const updateSpy = jest.spyOn(workflowRunRepository, 'updateOne');
      const updated = await workflowRunService.markSuspended(
        workflowRun.id,
        payload,
      );

      expect(updateSpy).toHaveBeenCalledWith(
        workflowRun.id,
        {
          status: 'suspended',
          suspendedStep: payload.stepId,
          suspensionReason: payload.reason,
          suspensionData: payload.data,
          suspensionStepExecId: payload.stepExecId,
          suspensionIndex: payload.suspendIndex,
          suspensionKey: payload.suspendKey,
          suspensionAwaitResults: payload.awaitResults,
          lastResumeData: payload.lastResumeData,
          suspendedAt: now,
          snapshot,
          context: payload.context,
        },
        undefined,
      );
      expect(updated.status).toBe('suspended');
      expect(updated.suspendedStep).toBe(payload.stepId);
      expect(updated.suspensionReason).toBe(payload.reason);
      expect(updated.suspensionData).toEqual(payload.data);
      expect(updated.suspensionStepExecId).toBe(payload.stepExecId);
      expect(updated.suspensionIndex).toBe(payload.suspendIndex);
      expect(updated.suspensionKey).toBe(payload.suspendKey);
      expect(updated.suspensionAwaitResults).toEqual(payload.awaitResults);
      expect(updated.lastResumeData).toEqual(payload.lastResumeData);
      expect(updated.suspendedAt?.getTime()).toBe(now.getTime());
    });

    it('marks a run as finished with outputs', async () => {
      const now = new Date('2024-11-11T09:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      const payload = {
        snapshot,
        context: { total: 1 },
        output: { message: 'complete' },
      };
      const updateSpy = jest.spyOn(workflowRunRepository, 'updateOne');
      const updated = await workflowRunService.markFinished(
        workflowRun.id,
        payload,
      );
      const stored = await workflowRunService.findOne(workflowRun.id);

      expect(updateSpy).toHaveBeenCalledWith(
        workflowRun.id,
        {
          status: 'finished',
          finishedAt: now,
          ...payload,
        },
        undefined,
      );
      expect(updated.status).toBe('finished');
      expect(updated.finishedAt?.getTime()).toBe(now.getTime());
      expect(updated.output).toEqual(payload.output);
      expect(stored?.status).toBe('finished');
      expect(stored?.finishedAt?.getTime()).toBe(now.getTime());
    });

    it('marks a run as failed and captures errors', async () => {
      const now = new Date('2024-12-12T08:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      const payload = {
        snapshot,
        context: { attempt: 1 },
        error: 'Unexpected failure',
      };
      const updateSpy = jest.spyOn(workflowRunRepository, 'updateOne');
      const updated = await workflowRunService.markFailed(
        workflowRun.id,
        payload,
      );
      const stored = await workflowRunService.findOne(workflowRun.id);

      expect(updateSpy).toHaveBeenCalledWith(
        workflowRun.id,
        {
          status: 'failed',
          failedAt: now,
          ...payload,
        },
        undefined,
      );
      expect(updated.status).toBe('failed');
      expect(updated.failedAt?.getTime()).toBe(now.getTime());
      expect(updated.error).toBe(payload.error);
      expect(stored?.status).toBe('failed');
      expect(stored?.failedAt?.getTime()).toBe(now.getTime());
    });
  });

  describe('population helpers', () => {
    it('populates workflow relations on findOneAndPopulate', async () => {
      const populated = await workflowRunService.findOneAndPopulate(
        workflowRun.id,
      );

      expect(populated).not.toBeNull();
      expect(populated!.workflow.id).toBe(workflow.id);
      expect(populated!.workflow.name).toBe(workflow.name);
      expect(populated!.workflowVersion?.id ?? null).toBe(workflowVersionId);
    });

    it('populates workflow relations for bulk queries', async () => {
      const populated = await workflowRunService.findAndPopulate();

      expect(populated).toHaveLength(1);
      expect(populated[0]!.workflow.id).toBe(workflow.id);
      expect(populated[0]!.workflowVersion?.id ?? null).toBe(workflowVersionId);
    });
  });

  describe('findSuspendedRunByInitiator', () => {
    const activeWorkflowRunStatuses = [
      EWorkflowRunStatus.IDLE,
      EWorkflowRunStatus.RUNNING,
      EWorkflowRunStatus.SUSPENDED,
    ];
    const buildSuspendedRun = (
      id: string,
      workflowId: string,
      options: {
        parentRun?: { id: string } | string | null;
        status?: EWorkflowRunStatus;
        suspendedAt?: string;
        createdAt?: string;
      } = {},
    ): WorkflowRunFull =>
      ({
        id,
        workflow: { id: workflowId },
        parentRun: options.parentRun ?? null,
        status: options.status ?? EWorkflowRunStatus.SUSPENDED,
        suspendedAt: new Date(
          options.suspendedAt ?? '2026-01-01T00:00:00.000Z',
        ),
        createdAt: new Date(options.createdAt ?? '2026-01-01T00:00:00.000Z'),
      }) as unknown as WorkflowRunFull;
    const expectActiveRunLookup = (
      mockedRepo: WorkflowRunRepository,
      extraWhere: Record<string, unknown> = {},
    ) => {
      expect(mockedRepo.findAndPopulate).toHaveBeenCalledWith({
        where: {
          triggeredBy: { id: 'sub-1' },
          ...extraWhere,
          status: expect.objectContaining({
            _type: 'in',
            _value: activeWorkflowRunStatuses,
          }),
        },
        order: { suspendedAt: 'DESC', createdAt: 'DESC' },
      });
    };

    it('loads suspended runs for the initiator and picks the deepest leaf', async () => {
      const mockedRepo = {
        findAndPopulate: jest.fn(),
      } as unknown as WorkflowRunRepository;
      const service = new WorkflowRunService(mockedRepo);
      const parentRun = buildSuspendedRun('parent-run', 'parent-workflow', {
        suspendedAt: '2026-01-01T00:00:00.000Z',
      });
      const childRun = buildSuspendedRun('child-run', 'child-workflow', {
        parentRun: { id: parentRun.id },
        suspendedAt: '2026-01-01T00:01:00.000Z',
      });

      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        parentRun,
        childRun,
      ]);

      const result = await service.findSuspendedRunByInitiator('sub-1');

      expectActiveRunLookup(mockedRepo);
      expect(result).toBe(childRun);
    });

    it('does not treat a suspended parent as resumable while its child is running', async () => {
      const mockedRepo = {
        findAndPopulate: jest.fn(),
      } as unknown as WorkflowRunRepository;
      const service = new WorkflowRunService(mockedRepo);
      const parentRun = buildSuspendedRun('parent-run', 'parent-workflow');
      const childRun = buildSuspendedRun('child-run', 'child-workflow', {
        parentRun: { id: parentRun.id },
        status: EWorkflowRunStatus.RUNNING,
      });

      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        parentRun,
        childRun,
      ]);

      const result = await service.findSuspendedRunByInitiator(
        'sub-1',
        undefined,
        'parent-workflow',
      );

      expectActiveRunLookup(mockedRepo);
      expect(result).toBeNull();
    });

    it('resolves a requested parent workflow to its suspended child leaf', async () => {
      const mockedRepo = {
        findAndPopulate: jest.fn(),
      } as unknown as WorkflowRunRepository;
      const service = new WorkflowRunService(mockedRepo);
      const parentRun = buildSuspendedRun('parent-run', 'parent-workflow');
      const childRun = buildSuspendedRun('child-run', 'child-workflow', {
        parentRun: parentRun.id,
      });

      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        parentRun,
        childRun,
      ]);

      const result = await service.findSuspendedRunByInitiator(
        'sub-1',
        undefined,
        'parent-workflow',
      );

      expectActiveRunLookup(mockedRepo);
      expect(result).toBe(childRun);
    });

    it('keeps thread scoping in the repository query without filtering out child stacks by workflow id', async () => {
      const mockedRepo = {
        findAndPopulate: jest.fn(),
      } as unknown as WorkflowRunRepository;
      const service = new WorkflowRunService(mockedRepo);
      const parentRun = buildSuspendedRun('parent-run', 'parent-workflow');
      const childRun = buildSuspendedRun('child-run', 'child-workflow', {
        parentRun: { id: parentRun.id },
      });

      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        parentRun,
        childRun,
      ]);

      const result = await service.findSuspendedRunByInitiator(
        'sub-1',
        'thread-1',
        'parent-workflow',
      );

      expectActiveRunLookup(mockedRepo, {
        thread: { id: 'thread-1' },
      });
      expect(result).toBe(childRun);
    });

    it('returns null when the requested workflow is not in any suspended stack', async () => {
      const mockedRepo = {
        findAndPopulate: jest.fn(),
      } as unknown as WorkflowRunRepository;
      const service = new WorkflowRunService(mockedRepo);

      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        buildSuspendedRun('run-1', 'workflow-1'),
      ]);

      const result = await service.findSuspendedRunByInitiator(
        'sub-1',
        undefined,
        'workflow-2',
      );

      expect(result).toBeNull();
    });
  });
});

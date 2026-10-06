/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  StepType,
  WaitInfo,
  WorkflowCheckpoint,
  WorkflowDefinition,
  Workflow as WorkflowHelper,
  WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import { Workflow, WorkflowRun, WorkflowRunFull } from '@hexabot-ai/types';

import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
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
  const wait: WaitInfo = {
    waitId: '0:greet@index:1',
    step: { id: '0:greet', name: 'greet', type: StepType.Task },
    suspendKey: 'index:1',
    reason: 'awaiting input',
    data: { question: 'name' },
  };
  const checkpoint: WorkflowCheckpoint = {
    version: 1,
    fingerprint: 'fingerprint',
    input: { foo: 'bar' },
    output: { previous: { ok: true } },
    root: {
      kind: 'sequence',
      index: 0,
      child: {
        kind: 'task',
        stepId: '0:greet',
        inputs: { name: 'Alice' },
        awaitResults: {},
        wait,
      },
    },
    waits: [wait],
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
  describe('state transitions', () => {
    it('marks a run as running with its context', async () => {
      const payload = { context: { user: 'demo' } };
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
      expect(updated.context).toEqual(payload.context);
      expect(stored?.status).toBe('running');
    });

    it('marks a run as suspended with its checkpoint', async () => {
      const now = new Date('2024-10-10T10:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      const payload = {
        checkpoint,
        snapshot,
        context: { lang: 'en' },
        output: checkpoint.output,
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
          suspendedAt: now,
          ...payload,
        },
        undefined,
      );
      expect(updated.status).toBe('suspended');
      expect(updated.checkpoint).toEqual(checkpoint);
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
          checkpoint: null,
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
          checkpoint: null,
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

  describe('suspension claims', () => {
    const suspend = async () =>
      await workflowRunService.markSuspended(workflowRun.id, {
        checkpoint,
      });

    it('clears the checkpoint once a run finishes or fails', async () => {
      await suspend();
      expect(
        (await workflowRunService.markFinished(workflowRun.id, {})).checkpoint,
      ).toBeNull();

      await suspend();
      expect(
        (await workflowRunService.markFailed(workflowRun.id, {})).checkpoint,
      ).toBeNull();
    });

    it('claims a suspension exactly once', async () => {
      const suspended = await suspend();
      const claims = await Promise.all([
        workflowRunService.claimSuspended(
          workflowRun.id,
          suspended.suspendedAt,
        ),
        workflowRunService.claimSuspended(
          workflowRun.id,
          suspended.suspendedAt,
        ),
      ]);

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await workflowRunService.findOne(workflowRun.id))?.status).toBe(
        'running',
      );
    });

    it('refuses to claim a run that is not suspended', async () => {
      expect(
        await workflowRunService.claimSuspended(workflowRun.id, null),
      ).toBe(false);
    });

    it('refuses to claim a later suspension of the same run', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-10-10T10:00:00Z'));
      const first = await suspend();
      jest.setSystemTime(new Date('2024-10-10T10:05:00Z'));
      await suspend();
      jest.useRealTimers();

      expect(
        await workflowRunService.claimSuspended(
          workflowRun.id,
          first.suspendedAt,
        ),
      ).toBe(false);
    });

    it('releases a claim back to the same suspension', async () => {
      const suspended = await suspend();
      await workflowRunService.claimSuspended(
        workflowRun.id,
        suspended.suspendedAt,
      );

      const released = await workflowRunService.releaseClaim(workflowRun.id, {
        context: { restored: true },
      });

      expect(released.status).toBe('suspended');
      expect(released.context).toEqual({ restored: true });
      expect(released.checkpoint).toEqual(checkpoint);
      expect(released.suspendedAt?.getTime()).toBe(
        suspended.suspendedAt?.getTime(),
      );
      expect(
        await workflowRunService.claimSuspended(
          workflowRun.id,
          released.suspendedAt,
        ),
      ).toBe(true);
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

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
          awaitingOperator: false,
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
          awaitingOperator: false,
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
          awaitingOperator: false,
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

  describe('awaiting operator flag', () => {
    const approvalWait: WaitInfo = {
      ...wait,
      waitId: '0:greet@key:approval',
      suspendKey: 'key:approval',
      reason: 'awaiting_approval',
    };
    const operatorCheckpoint: WorkflowCheckpoint = {
      ...checkpoint,
      waits: [wait, approvalWait],
    };

    it('flags a run suspended on an operator wait', async () => {
      const suspended = await workflowRunService.markSuspended(workflowRun.id, {
        checkpoint: operatorCheckpoint,
      });

      expect(suspended.awaitingOperator).toBe(true);
    });

    it('does not flag a run suspended on other waits', async () => {
      const suspended = await workflowRunService.markSuspended(workflowRun.id, {
        checkpoint,
      });

      expect(suspended.awaitingOperator).toBe(false);
    });

    it('keeps the flag while the run is claimed and clears it once the run ends', async () => {
      const suspended = await workflowRunService.markSuspended(workflowRun.id, {
        checkpoint: operatorCheckpoint,
      });
      await workflowRunService.claimSuspended(
        workflowRun.id,
        suspended.suspendedAt,
      );
      const released = await workflowRunService.releaseClaim(workflowRun.id, {
        context: {},
      });

      expect(released.awaitingOperator).toBe(true);
      expect(
        (await workflowRunService.markFinished(workflowRun.id, {}))
          .awaitingOperator,
      ).toBe(false);

      await workflowRunService.markSuspended(workflowRun.id, {
        checkpoint: operatorCheckpoint,
      });
      expect(
        (await workflowRunService.markFailed(workflowRun.id, {}))
          .awaitingOperator,
      ).toBe(false);
    });

    it('scopes find options to the runs waiting on an admin', async () => {
      await workflowRunService.markSuspended(workflowRun.id, {
        checkpoint: operatorCheckpoint,
      });
      const other = await workflowRunService.create({
        workflow: workflow.id,
        workflowVersion: workflowVersionId,
        status: 'idle',
      });
      await workflowRunService.markSuspended(other.id, { checkpoint });

      const scoped = workflowRunService.withAwaitingOperatorScope({
        where: { workflow: { id: workflow.id }, status: 'failed' },
      });

      expect(scoped.where).toEqual({
        workflow: { id: workflow.id },
        status: EWorkflowRunStatus.SUSPENDED,
        awaitingOperator: true,
      });
      expect(
        (await workflowRunService.find(scoped)).map((run) => run.id),
      ).toEqual([workflowRun.id]);
      expect(
        workflowRunService.withAwaitingOperatorScope({
          where: [{ thread: { id: 't-1' } }, { parentRun: { id: 'p-1' } }],
          take: 5,
        }),
      ).toEqual({
        where: [
          {
            thread: { id: 't-1' },
            status: EWorkflowRunStatus.SUSPENDED,
            awaitingOperator: true,
          },
          {
            parentRun: { id: 'p-1' },
            status: EWorkflowRunStatus.SUSPENDED,
            awaitingOperator: true,
          },
        ],
        take: 5,
      });
      expect(workflowRunService.withAwaitingOperatorScope().where).toEqual({
        status: EWorkflowRunStatus.SUSPENDED,
        awaitingOperator: true,
      });
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
        waitReasons?: string[];
      } = {},
    ): WorkflowRunFull =>
      ({
        id,
        workflow: { id: workflowId },
        parentRun: options.parentRun ?? null,
        checkpoint: options.waitReasons
          ? {
              waits: options.waitReasons.map((reason, index) => ({
                waitId: `${id}-wait-${index}`,
                reason,
              })),
            }
          : null,
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

    it('skips leaves that only an admin can resume when asked to', async () => {
      const mockedRepo = {
        findAndPopulate: jest.fn(),
      } as unknown as WorkflowRunRepository;
      const service = new WorkflowRunService(mockedRepo);
      // The parent waits on its child, which waits on an approval.
      const parentRun = buildSuspendedRun('parent-run', 'parent-workflow', {
        waitReasons: ['awaiting_child_workflow'],
      });
      const childRun = buildSuspendedRun('child-run', 'child-workflow', {
        parentRun: { id: parentRun.id },
        waitReasons: ['awaiting_approval'],
      });
      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        parentRun,
        childRun,
      ]);

      expect(
        await service.findSuspendedRunByInitiator(
          'sub-1',
          undefined,
          'parent-workflow',
          { skipBlockedOnOperator: true },
        ),
      ).toBeNull();
      expect(
        await service.findSuspendedRunByInitiator(
          'sub-1',
          undefined,
          'parent-workflow',
        ),
      ).toBe(childRun);
    });

    it('keeps leaves that an event can still resume', async () => {
      const mockedRepo = {
        findAndPopulate: jest.fn(),
      } as unknown as WorkflowRunRepository;
      const service = new WorkflowRunService(mockedRepo);
      const approvalOnly = buildSuspendedRun('approval-only', 'workflow-1', {
        suspendedAt: '2026-01-01T00:02:00.000Z',
        waitReasons: ['awaiting_approval'],
      });
      const mixed = buildSuspendedRun('mixed', 'workflow-1', {
        suspendedAt: '2026-01-01T00:01:00.000Z',
        waitReasons: ['awaiting_approval', 'awaiting_user_response'],
      });
      const childOnly = buildSuspendedRun('child-only', 'workflow-1', {
        waitReasons: ['awaiting_child_workflow'],
      });
      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        approvalOnly,
        mixed,
        childOnly,
      ]);

      expect(
        await service.findSuspendedRunByInitiator(
          'sub-1',
          undefined,
          undefined,
          {
            skipBlockedOnOperator: true,
          },
        ),
      ).toBe(mixed);

      (mockedRepo.findAndPopulate as jest.Mock).mockResolvedValue([
        approvalOnly,
        childOnly,
      ]);
      expect(
        await service.findSuspendedRunByInitiator(
          'sub-1',
          undefined,
          undefined,
          {
            skipBlockedOnOperator: true,
          },
        ),
      ).toBe(childOnly);
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

  describe('call stacks', () => {
    const createWorkflow = async () =>
      await workflowService.create({
        name: `Called workflow ${++counter}`,
        description: 'Workflow called by another one',
        type: WorkflowType.conversational,
        schedule: null,
        createdBy: creatorId,
      });
    const createSuspendedRun = async (
      workflowId: string,
      parentRun: string | null = null,
    ) =>
      await workflowRunService.create({
        workflow: workflowId,
        parentRun,
        status: 'suspended',
        checkpoint,
        snapshot,
        suspendedAt: new Date('2026-01-01T10:00:00.000Z'),
      });
    const loadRun = async (runId: string) =>
      (await workflowRunService.findOneAndPopulate(runId))!;

    it('cancels the suspended descendants of a run and leaves running ones alone', async () => {
      const calledWorkflow = await createWorkflow();
      const rootRun = await createSuspendedRun(workflow.id);
      const child = await createSuspendedRun(calledWorkflow.id, rootRun.id);
      const grandchild = await createSuspendedRun(calledWorkflow.id, child.id);
      const runningChild = await workflowRunService.create({
        workflow: calledWorkflow.id,
        parentRun: rootRun.id,
        status: 'running',
      });

      await workflowRunService.cancelSuspendedDescendants(
        rootRun.id,
        'Parent was cancelled',
      );

      for (const run of [child, grandchild]) {
        expect(await workflowRunService.findOne(run.id)).toEqual(
          expect.objectContaining({
            status: 'failed',
            error: 'Parent was cancelled',
            checkpoint: null,
          }),
        );
      }
      expect((await workflowRunService.findOne(runningChild.id))?.status).toBe(
        'running',
      );
      expect((await workflowRunService.findOne(rootRun.id))?.status).toBe(
        'suspended',
      );
    });

    it('leaves a run another caller claimed first', async () => {
      const run = await loadRun((await createSuspendedRun(workflow.id)).id);
      const emitSpy = jest.spyOn(workflowRunService.eventEmitter, 'emit');

      await expect(
        workflowRunService.cancelSuspended(
          { ...run, suspendedAt: new Date('2025-01-01T00:00:00.000Z') },
          'Cancelled',
        ),
      ).resolves.toBe(false);
      expect((await workflowRunService.findOne(run.id))?.status).toBe(
        'suspended',
      );
      expect(emitSpy).not.toHaveBeenCalledWith(
        'hook:workflow:failure',
        expect.anything(),
      );
    });

    it('cancels the runs called by the runs of a deleted workflow and returns their callers', async () => {
      const deletedWorkflow = await createWorkflow();
      const grandchildWorkflow = await createWorkflow();
      const parentRun = await createSuspendedRun(workflow.id);
      const childRun = await createSuspendedRun(
        deletedWorkflow.id,
        parentRun.id,
      );
      const grandchildRun = await createSuspendedRun(
        grandchildWorkflow.id,
        childRun.id,
      );
      // A run of the deleted workflow that no run called.
      await createSuspendedRun(deletedWorkflow.id);

      await expect(
        workflowRunService.prepareWorkflowDeletion(deletedWorkflow),
      ).resolves.toEqual([parentRun.id]);
      expect(await workflowRunService.findOne(grandchildRun.id)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: `Workflow "${deletedWorkflow.name}" was deleted`,
          checkpoint: null,
        }),
      );
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'suspended',
      );
      expect((await workflowRunService.findOne(childRun.id))?.status).toBe(
        'suspended',
      );
    });

    it('refuses a call to a workflow already in the call stack', async () => {
      const calledWorkflow = await createWorkflow();
      const parentRun = await createSuspendedRun(workflow.id);
      const childRun = await loadRun(
        (await createSuspendedRun(calledWorkflow.id, parentRun.id)).id,
      );

      await expect(
        workflowRunService.assertCanCallWorkflow(childRun, workflow.id),
      ).rejects.toThrow(
        `Workflow call cycle detected for workflow ${workflow.id}`,
      );
      await expect(
        workflowRunService.assertCanCallWorkflow(
          childRun,
          (await createWorkflow()).id,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('thread closing', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('aborts the active runs of a thread once it is closed', async () => {
      const abortSpy = jest
        .spyOn(workflowRunService, 'abortActiveRunsForThread')
        .mockResolvedValue();

      await workflowRunService.handleThreadClosed({
        entity: { id: 'thread-1', status: 'closed' },
        databaseEntity: { id: 'thread-1', status: 'open' },
      });

      expect(abortSpy).toHaveBeenCalledWith('thread-1');
    });

    it('ignores thread updates that do not close it', async () => {
      const abortSpy = jest
        .spyOn(workflowRunService, 'abortActiveRunsForThread')
        .mockResolvedValue();

      await workflowRunService.handleThreadClosed({
        entity: { id: 'thread-1', status: 'closed' },
        databaseEntity: { id: 'thread-1', status: 'closed' },
      });
      await workflowRunService.handleThreadClosed({
        entity: { id: 'thread-1', status: 'open' },
        databaseEntity: { id: 'thread-1', status: 'open' },
      });

      expect(abortSpy).not.toHaveBeenCalled();
    });

    // Runs are stored without a thread, so the thread lookup is stubbed with
    // the loaded runs: the cancellation itself goes through the database.
    const loadSuspendedRun = async () => {
      const run = await workflowRunService.create({
        workflow: workflow.id,
        status: 'suspended',
        checkpoint,
        snapshot,
        suspendedAt: new Date('2026-01-01T10:00:00.000Z'),
      });

      return (await workflowRunService.findOneAndPopulate(run.id))!;
    };

    it('cancels the suspended runs of a thread and fails the others', async () => {
      const suspendedRun = await loadSuspendedRun();
      const runningRun = (await workflowRunService.findOneAndPopulate(
        (
          await workflowRunService.create({
            workflow: workflow.id,
            status: 'running',
          })
        ).id,
      ))!;
      const findSpy = jest
        .spyOn(workflowRunService, 'findAndPopulate')
        .mockResolvedValueOnce([suspendedRun, runningRun]);
      const emitSpy = jest.spyOn(workflowRunService.eventEmitter, 'emit');

      await workflowRunService.abortActiveRunsForThread('thread-1');

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          thread: { id: 'thread-1' },
          status: expect.objectContaining({
            _type: 'in',
            _value: [
              EWorkflowRunStatus.IDLE,
              EWorkflowRunStatus.RUNNING,
              EWorkflowRunStatus.SUSPENDED,
            ],
          }),
        },
      });
      const storedRun = await workflowRunService.findOne(suspendedRun.id);
      expect(storedRun).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Thread was closed',
          checkpoint: null,
        }),
      );
      expect(storedRun?.snapshot?.actions?.[wait.step.id]).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          reason: 'Thread was closed',
        }),
      );
      expect(storedRun?.stepLog?.[wait.step.id]).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          error: { message: 'Thread was closed' },
        }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        'hook:step:cancelled',
        expect.objectContaining({ runId: suspendedRun.id, wait }),
      );
      expect(emitSpy).toHaveBeenCalledWith('hook:workflow:failure', {
        runId: suspendedRun.id,
        error: expect.any(Error),
      });
      expect(await workflowRunService.findOne(runningRun.id)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Thread was closed',
        }),
      );
    });

    it('leaves a suspended run of a thread another caller claimed first', async () => {
      const run = await loadSuspendedRun();
      // A resume claimed the run after it was loaded.
      await workflowRunService.claimSuspended(run.id, run.suspendedAt ?? null);
      jest
        .spyOn(workflowRunService, 'findAndPopulate')
        .mockResolvedValueOnce([run]);
      const emitSpy = jest.spyOn(workflowRunService.eventEmitter, 'emit');

      await workflowRunService.abortActiveRunsForThread('thread-1');

      expect((await workflowRunService.findOne(run.id))?.status).toBe(
        'running',
      );
      expect(emitSpy).not.toHaveBeenCalledWith(
        'hook:workflow:failure',
        expect.anything(),
      );
    });
  });
});

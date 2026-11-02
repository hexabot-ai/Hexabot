/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  StepType,
  WaitInfo,
  WorkflowCheckpoint,
  WorkflowDefinition,
  Workflow as WorkflowHelper,
} from '@hexabot-ai/agentic';
import { Workflow } from '@hexabot-ai/types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { config } from '@/config';
import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import { WorkflowVersionOrmEntity } from '../entities/workflow-version.entity';
import { WorkflowOrmEntity } from '../entities/workflow.entity';
import {
  failedValues,
  finishedValues,
  putBackValues,
  RunLease,
  runningValues,
  suspendedValues,
} from '../lib/run-lease';
import { WorkflowRunRepository } from '../repositories/workflow-run.repository';
import { WorkflowRepository } from '../repositories/workflow.repository';
import {
  AWAITING_APPROVAL_REASON,
  AWAITING_CHILD_WORKFLOW_REASON,
  WorkflowType,
  WorkflowVersionAction,
} from '../types';

import { AgenticService } from './agentic.service';
import { WorkflowCallStackService } from './workflow-call-stack.service';
import { WorkflowRunRecoveryService } from './workflow-run-recovery.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowVersionService } from './workflow-version.service';
import { WorkflowService } from './workflow.service';

const INTERRUPTED_ERROR =
  'Workflow run was interrupted: the process running it stopped';

describe('WorkflowRunRecoveryService (TypeORM)', () => {
  let recoveryService: WorkflowRunRecoveryService;
  let workflowService: WorkflowService;
  let workflowRepository: WorkflowRepository;
  let workflowRunService: WorkflowRunService;
  let workflowRunRepository: WorkflowRunRepository;
  let workflowVersionService: WorkflowVersionService;
  let eventEmitter: EventEmitter2;
  let dataSource: DataSource;
  let workflow: Workflow;
  let counter = 0;
  const agenticServiceMock = { cancelRun: jest.fn() };
  const callStackMock = { reconcile: jest.fn() };
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  };
  const definition: WorkflowDefinition = {
    defs: { greet: { kind: 'task', action: 'greet' } },
    flow: [{ do: 'greet' }],
    outputs: { result: '=1' },
  };
  const approvalWait: WaitInfo = {
    waitId: 'approve@index:1',
    step: { id: 'approve', name: 'approve', type: StepType.Task },
    suspendKey: 'index:1',
    reason: AWAITING_APPROVAL_REASON,
    data: { message: 'Refund 42 EUR?' },
  };
  const childWait = (childRunId: string): WaitInfo => ({
    waitId: 'call_child@index:1',
    step: { id: 'call_child', name: 'call_child', type: StepType.Task },
    suspendKey: 'index:1',
    reason: AWAITING_CHILD_WORKFLOW_REASON,
    data: { workflow_id: workflow.id, workflow_run_id: childRunId },
  });
  const buildCheckpoint = (waits: WaitInfo[]): WorkflowCheckpoint => ({
    version: 1,
    fingerprint: 'fingerprint',
    input: {},
    output: {},
    root: {
      kind: 'sequence',
      index: 0,
      child: {
        kind: 'task',
        stepId: waits[0].step.id,
        inputs: {},
        awaitResults: {},
        wait: waits[0],
      },
    },
    waits,
  });
  const context = () => ({
    initiatorId: userFixtureIds.admin,
    workflowId: workflow.id,
  });
  /** A time at which every claim the tests take has lapsed. */
  const later = () => new Date(Date.now() + 10 * 60_000);
  /** Create an idle run held under a claim lapsing at `expiresAt`. */
  const createRun = async ({
    parentRun = null,
    expiresAt = new Date(Date.now() + config.workflow.runClaimTtl),
  }: { parentRun?: string | null; expiresAt?: Date } = {}) => {
    const claimId = randomUUID();
    const run = await workflowRunRepository.createClaimed(
      { workflow: workflow.id, parentRun, input: {} },
      { claimId, expiresAt },
    );

    return { run, claimId };
  };
  /**
   * The lease of a claim another process took, such as the claim of a run
   * created by `createRun`: it writes the run under that claim, but this
   * process does not renew it.
   */
  const leaseOn = (runId: string, claimId: string) =>
    new RunLease(runId, claimId, workflowRunRepository, () => undefined);
  /**
   * Claim the current suspension of a run for a resume whose process then
   * stops: nothing holds or renews its claim.
   */
  const interruptResume = async (runId: string) => {
    const loaded = (await workflowRunService.findOne(runId))!;
    const lease = (await workflowRunService.claimSuspended(
      runId,
      loaded.suspendedAt ?? null,
    ))!;
    lease.end();
  };
  /** Create a run suspended on `waits`, under no claim. */
  const createSuspendedRun = async (
    waits: WaitInfo[],
    options: { parentRun?: string | null } = {},
  ) => {
    const { run, claimId } = await createRun(options);
    await leaseOn(run.id, claimId).settle(
      suspendedValues({
        checkpoint: buildCheckpoint(waits),
        context: context(),
      }),
    );

    return (await workflowRunService.findOneAndPopulate(run.id))!;
  };
  /**
   * Create a run suspended on `waits`, then claimed by a resume whose
   * process stopped: nothing holds or renews its claim.
   */
  const createInterruptedResume = async (
    waits: WaitInfo[],
    options: { parentRun?: string | null } = {},
  ) => {
    const suspended = await createSuspendedRun(waits, options);
    await interruptResume(suspended.id);

    return { suspended };
  };
  const readRecoveryCount = async (runId: string) =>
    (
      await dataSource
        .getRepository(WorkflowRunOrmEntity)
        .findOneByOrFail({ id: runId })
    ).recoveryCount;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WorkflowRunRecoveryService,
        WorkflowService,
        WorkflowRepository,
        WorkflowRunService,
        WorkflowRunRepository,
        WorkflowVersionService,
        { provide: AgenticService, useValue: agenticServiceMock },
        { provide: WorkflowCallStackService, useValue: callStackMock },
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

    dataSource = testing.module.get(DataSource);
    [
      recoveryService,
      workflowService,
      workflowRepository,
      workflowRunService,
      workflowRunRepository,
      workflowVersionService,
      eventEmitter,
    ] = await testing.getMocks([
      WorkflowRunRecoveryService,
      WorkflowService,
      WorkflowRepository,
      WorkflowRunService,
      WorkflowRunRepository,
      WorkflowVersionService,
      EventEmitter2,
    ]);
  });

  beforeEach(async () => {
    await workflowRunRepository.deleteMany();
    await workflowRepository.deleteMany();
    workflow = await workflowService.create({
      name: `Recovered workflow ${++counter}`,
      description: 'Workflow for recovery tests',
      type: WorkflowType.manual,
      schedule: null,
      createdBy: userFixtureIds.admin,
    });
    await workflowVersionService.commit({
      workflow: workflow.id,
      definitionYml: WorkflowHelper.stringifyDefinition(definition),
      action: WorkflowVersionAction.create,
      createdBy: userFixtureIds.admin,
    });
    callStackMock.reconcile.mockResolvedValue(undefined);
    agenticServiceMock.cancelRun.mockResolvedValue({ status: 'cancelled' });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('puts a run whose approval resume died back on its wait', async () => {
    const { suspended } = await createInterruptedResume([approvalWait]);
    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    expect(await recoveryService.recoverExpiredRuns(later())).toBe(1);

    const recovered = (await workflowRunService.findOneAndPopulate(
      suspended.id,
    ))!;
    expect(recovered).toEqual(
      expect.objectContaining({
        status: 'suspended',
        checkpoint: suspended.checkpoint,
        context: suspended.context,
        awaitingOperator: true,
      }),
    );
    expect(recovered.suspendedAt?.getTime()).toBe(
      suspended.suspendedAt?.getTime(),
    );
    // Pending again, and an admin can cancel it.
    expect(
      (
        await workflowRunService.find(
          workflowRunService.withAwaitingOperatorScope(),
        )
      ).map(({ id }) => id),
    ).toEqual([suspended.id]);
    expect(emitSpy).toHaveBeenCalledWith('hook:workflow:suspended', {
      runId: suspended.id,
      waits: [approvalWait],
    });
    expect(callStackMock.reconcile).toHaveBeenCalledWith([suspended.id]);
    expect(agenticServiceMock.cancelRun).not.toHaveBeenCalled();
    expect(
      await workflowRunService.cancelSuspended(recovered, 'Cancelled'),
    ).toBe(true);
  });

  it('delivers the result of a child run that ended while its parent was held', async () => {
    const parent = await createSuspendedRun([approvalWait]);
    const { run: child, claimId: childClaimId } = await createRun({
      parentRun: parent.id,
    });
    await leaseOn(child.id, childClaimId).settle(finishedValues({}));
    await workflowRunService.updateOne(parent.id, {
      checkpoint: buildCheckpoint([childWait(child.id)]),
    });
    await interruptResume(parent.id);

    expect(await recoveryService.recoverExpiredRuns(later())).toBe(1);

    expect((await workflowRunService.findOne(parent.id))?.status).toBe(
      'suspended',
    );
    expect(callStackMock.reconcile).toHaveBeenCalledWith([parent.id]);
  });

  it('fails the runs whose first pass died, and lets a waiting parent know', async () => {
    const parent = await createSuspendedRun([approvalWait]);
    const { run: idle } = await createRun({ parentRun: parent.id });
    const { run: running, claimId: runningClaimId } = await createRun();
    await leaseOn(running.id, runningClaimId).update(
      runningValues({
        context: context(),
      }),
    );
    const grandChild = await createSuspendedRun([approvalWait], {
      parentRun: running.id,
    });
    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    expect(await recoveryService.recoverExpiredRuns(later())).toBe(2);

    for (const run of [idle, running]) {
      expect(await workflowRunService.findOne(run.id)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: INTERRUPTED_ERROR,
          checkpoint: null,
        }),
      );
    }
    // Only a run that started has the context its broadcast needs.
    expect(emitSpy).toHaveBeenCalledWith('hook:workflow:failure', {
      runId: running.id,
      error: expect.any(Error),
    });
    expect(emitSpy).not.toHaveBeenCalledWith(
      'hook:workflow:failure',
      expect.objectContaining({ runId: idle.id }),
    );
    expect(await workflowRunService.findOne(grandChild.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: `Parent workflow run ${running.id} was interrupted`,
      }),
    );
    expect(callStackMock.reconcile).toHaveBeenCalledWith([parent.id]);
  });

  it('leaves live claims, and the claims this process holds', async () => {
    const { run: live } = await createRun({
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const held = await createSuspendedRun([approvalWait]);
    const lease = (await workflowRunService.claimSuspended(
      held.id,
      held.suspendedAt ?? null,
    ))!;

    expect(await recoveryService.recoverExpiredRuns(later())).toBe(0);
    lease.end();

    expect((await workflowRunService.findOne(live.id))?.status).toBe('idle');
    expect((await workflowRunService.findOne(held.id))?.status).toBe('running');
  });

  it('recovers a run once when two nodes sweep together', async () => {
    const { suspended } = await createInterruptedResume([approvalWait]);
    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const now = later();
    const recovered = await Promise.all([
      recoveryService.recoverExpiredRuns(now),
      recoveryService.recoverExpiredRuns(now),
    ]);

    expect(recovered[0] + recovered[1]).toBe(1);
    expect(
      emitSpy.mock.calls.filter(
        ([name, payload]) =>
          name === 'hook:workflow:suspended' &&
          (payload as { runId: string }).runId === suspended.id,
      ),
    ).toHaveLength(1);
  });

  it('goes on with the other runs once one cannot be recovered', async () => {
    const { suspended } = await createInterruptedResume([approvalWait]);
    const { run: other } = await createRun();
    callStackMock.reconcile.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    expect(await recoveryService.recoverExpiredRuns(later())).toBe(1);

    expect((await workflowRunService.findOne(suspended.id))?.status).toBe(
      'suspended',
    );
    expect((await workflowRunService.findOne(other.id))?.status).toBe('failed');
  });

  /**
   * Make `reconcile` cancel the runs nothing waits on any more, as it does
   * before it delivers anything.
   */
  const cancelAbandonedOnReconcile = () =>
    callStackMock.reconcile.mockImplementation(
      async (runIds: (string | null)[]) => {
        for (const runId of runIds) {
          if (runId) {
            await workflowRunService.cancelAbandonedRuns(runId);
          }
        }
      },
    );

  it('cancels the suspended runs the interrupted pass called', async () => {
    cancelAbandonedOnReconcile();
    const parent = await createSuspendedRun([approvalWait]);
    const waitedOn = await createSuspendedRun([approvalWait], {
      parentRun: parent.id,
    });
    const orphan = await createSuspendedRun([approvalWait], {
      parentRun: parent.id,
    });
    await workflowRunService.updateOne(parent.id, {
      checkpoint: buildCheckpoint([childWait(waitedOn.id)]),
    });
    await interruptResume(parent.id);

    await recoveryService.recoverExpiredRuns(later());

    expect((await workflowRunService.findOne(parent.id))?.status).toBe(
      'suspended',
    );
    expect((await workflowRunService.findOne(waitedOn.id))?.status).toBe(
      'suspended',
    );
    expect(await workflowRunService.findOne(orphan.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: `Calling workflow run ${parent.id} no longer waits on this run`,
      }),
    );
  });

  it('cancels a run put back on its wait once its caller has ended', async () => {
    cancelAbandonedOnReconcile();
    const { run: parent, claimId: parentClaimId } = await createRun();
    const { suspended } = await createInterruptedResume([approvalWait], {
      parentRun: parent.id,
    });
    await leaseOn(parent.id, parentClaimId).settle(
      failedValues({ error: 'Cancelled' }),
    );

    await recoveryService.recoverExpiredRuns(later());

    expect(callStackMock.reconcile).toHaveBeenCalledWith([suspended.id]);
    expect(await workflowRunService.findOne(suspended.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: `Calling workflow run ${parent.id} no longer waits on this run`,
        awaitingOperator: false,
      }),
    );
  });

  it('cancels a run interrupted three times in a row', async () => {
    const { suspended } = await createInterruptedResume([approvalWait]);
    const interrupt = () => interruptResume(suspended.id);

    await recoveryService.recoverExpiredRuns(later());
    await interrupt();
    await recoveryService.recoverExpiredRuns(later());
    expect(agenticServiceMock.cancelRun).not.toHaveBeenCalled();
    expect(await readRecoveryCount(suspended.id)).toBe(2);

    await interrupt();
    await recoveryService.recoverExpiredRuns(later());

    expect(agenticServiceMock.cancelRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ id: suspended.id }),
        message:
          'Workflow run was interrupted 3 times in a row: the process resuming it stopped',
      }),
    );
  });

  it('counts interruptions in a row only', async () => {
    const { suspended } = await createInterruptedResume([approvalWait]);
    await recoveryService.recoverExpiredRuns(later());
    expect(await readRecoveryCount(suspended.id)).toBe(1);

    // A pass that settles the run resets the count.
    const loaded = (await workflowRunService.findOne(suspended.id))!;
    const lease = (await workflowRunService.claimSuspended(
      suspended.id,
      loaded.suspendedAt ?? null,
    ))!;
    await lease.settle(putBackValues());

    expect(await readRecoveryCount(suspended.id)).toBe(0);
  });

  describe('sweeps', () => {
    const ttl = config.workflow.runClaimTtl;

    it('recovers only after a whole TTL of successful queries', async () => {
      const start = Date.now();
      const { run } = await createRun({ expiresAt: new Date(start - 1) });
      const findSpy = jest.spyOn(workflowRunService, 'findExpiredClaims');
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const sweepAt = async (offset: number) => {
        jest.setSystemTime(start + offset);
        await recoveryService.sweep();
      };

      await sweepAt(0);
      await sweepAt(ttl / 2);
      expect((await workflowRunService.findOne(run.id))?.status).toBe('idle');

      findSpy.mockRejectedValueOnce(new Error('Database unavailable'));
      await sweepAt(ttl);
      await sweepAt(2 * ttl);
      expect((await workflowRunService.findOne(run.id))?.status).toBe('idle');

      await sweepAt(3 * ttl);
      expect((await workflowRunService.findOne(run.id))?.status).toBe('failed');
    });

    it('starts no timer outside of the API', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      recoveryService.onApplicationBootstrap();

      expect(setIntervalSpy).not.toHaveBeenCalled();
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

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
  let claimId: string;
  let dataSource: DataSource;
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
  /** Create an idle run held under a fresh claim, as `createFromEvent` does. */
  const createClaimedRun = async () => {
    const runClaimId = randomUUID();
    const run = await workflowRunRepository.createClaimed(
      {
        workflow: workflow.id,
        workflowVersion: workflowVersionId,
        input: { foo: 'bar' },
      },
      { claimId: runClaimId, expiresAt: new Date(Date.now() + 60_000) },
    );

    return { run, claimId: runClaimId };
  };
  /** Read the claim columns of a run, which the run schemas strip. */
  const readClaim = async (runId: string) => {
    const entity = await dataSource
      .getRepository(WorkflowRunOrmEntity)
      .findOneByOrFail({ id: runId });

    return {
      claimId: entity.claimId ?? null,
      claimExpiresAt: entity.claimExpiresAt ?? null,
      recoveryCount: entity.recoveryCount,
    };
  };
  const released = {
    claimId: null,
    claimExpiresAt: null,
    recoveryCount: 0,
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

    dataSource = testing.module.get(DataSource);
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

    ({ run: workflowRun, claimId } = await createClaimedRun());
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });
  describe('state transitions', () => {
    it('marks a claimed run as running with its context and keeps the claim', async () => {
      const payload = { context: { user: 'demo' } };

      expect(
        await workflowRunService.markRunning(workflowRun.id, claimId, payload),
      ).toBe(true);

      const stored = await workflowRunService.findOne(workflowRun.id);
      expect(stored?.status).toBe('running');
      expect(stored?.context).toEqual(payload.context);
      expect((await readClaim(workflowRun.id)).claimId).toBe(claimId);
    });

    it('marks a run as suspended with its checkpoint and releases its claim', async () => {
      const now = new Date('2024-10-10T10:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      const payload = {
        checkpoint,
        snapshot,
        context: { lang: 'en' },
        output: checkpoint.output,
      };

      expect(
        await workflowRunService.markSuspended(
          workflowRun.id,
          payload,
          claimId,
        ),
      ).toBe(true);

      const stored = await workflowRunService.findOne(workflowRun.id);
      expect(stored).toEqual(
        expect.objectContaining({
          status: 'suspended',
          checkpoint,
          context: payload.context,
          awaitingOperator: false,
        }),
      );
      expect(stored?.suspendedAt?.getTime()).toBe(now.getTime());
      expect(stored?.updatedAt?.getTime()).toBe(now.getTime());
      expect(await readClaim(workflowRun.id)).toEqual(released);
    });

    it('marks a run as finished with outputs', async () => {
      const now = new Date('2024-11-11T09:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      const payload = {
        snapshot,
        context: { total: 1 },
        output: { message: 'complete' },
      };

      expect(
        await workflowRunService.markFinished(workflowRun.id, payload, claimId),
      ).toBe(true);

      const stored = await workflowRunService.findOne(workflowRun.id);
      expect(stored).toEqual(
        expect.objectContaining({
          status: 'finished',
          checkpoint: null,
          awaitingOperator: false,
          output: payload.output,
        }),
      );
      expect(stored?.finishedAt?.getTime()).toBe(now.getTime());
      expect(await readClaim(workflowRun.id)).toEqual(released);
    });

    it('marks a run as failed and captures errors', async () => {
      const now = new Date('2024-12-12T08:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      const payload = {
        snapshot,
        context: { attempt: 1 },
        error: 'Unexpected failure',
      };

      expect(
        await workflowRunService.markFailed(workflowRun.id, payload, claimId),
      ).toBe(true);

      const stored = await workflowRunService.findOne(workflowRun.id);
      expect(stored).toEqual(
        expect.objectContaining({
          status: 'failed',
          checkpoint: null,
          awaitingOperator: false,
          error: payload.error,
        }),
      );
      expect(stored?.failedAt?.getTime()).toBe(now.getTime());
      expect(await readClaim(workflowRun.id)).toEqual(released);
    });

    it('broadcasts the runs it writes, as updateOne does', async () => {
      const emitSpy = jest.spyOn(workflowRunService.eventEmitter, 'emitAsync');

      await workflowRunService.markFailed(
        workflowRun.id,
        { error: 'boom' },
        claimId,
      );

      expect(emitSpy).toHaveBeenCalledWith(
        'hook:workflowRun:postUpdate',
        expect.objectContaining({
          entity: expect.objectContaining({
            id: workflowRun.id,
            status: 'failed',
          }),
        }),
      );
    });
  });

  describe('suspension claims', () => {
    /** Suspend the run under its claim, then load it. */
    const suspend = async () => {
      await workflowRunService.markSuspended(
        workflowRun.id,
        { checkpoint },
        claimId,
      );

      return (await workflowRunService.findOne(workflowRun.id))!;
    };

    it('clears the checkpoint once a run finishes or fails', async () => {
      for (const end of ['finished', 'failed'] as const) {
        const { run, claimId: startClaimId } = await createClaimedRun();
        await workflowRunService.markSuspended(
          run.id,
          { checkpoint },
          startClaimId,
        );
        const suspended = (await workflowRunService.findOne(run.id))!;
        const resumeClaimId = (await workflowRunService.claimSuspended(
          run.id,
          suspended.suspendedAt ?? null,
        ))!;

        expect(
          end === 'finished'
            ? await workflowRunService.markFinished(run.id, {}, resumeClaimId)
            : await workflowRunService.markFailed(run.id, {}, resumeClaimId),
        ).toBe(true);
        expect(await workflowRunService.findOne(run.id)).toEqual(
          expect.objectContaining({ status: end, checkpoint: null }),
        );
      }
    });

    it('claims a suspension exactly once, under a token and a lease', async () => {
      const suspended = await suspend();
      const claimedAfter = Date.now();
      const claims = await Promise.all([
        workflowRunService.claimSuspended(
          workflowRun.id,
          suspended.suspendedAt ?? null,
        ),
        workflowRunService.claimSuspended(
          workflowRun.id,
          suspended.suspendedAt ?? null,
        ),
      ]);
      const won = claims.filter((claim): claim is string => !!claim);

      expect(won).toHaveLength(1);
      const stored = await workflowRunService.findOne(workflowRun.id);
      expect(stored?.status).toBe('running');
      // The claim writes nothing else, so the run can be put back as it was.
      expect(stored?.context).toEqual(suspended.context);
      expect(stored?.checkpoint).toEqual(checkpoint);
      const claim = await readClaim(workflowRun.id);
      expect(claim.claimId).toBe(won[0]);
      expect(claim.claimExpiresAt!.getTime()).toBeGreaterThanOrEqual(
        claimedAfter + config.workflow.runClaimTtl,
      );
    });

    it('refuses to claim a run that is not suspended', async () => {
      expect(
        await workflowRunService.claimSuspended(workflowRun.id, null),
      ).toBeNull();
    });

    it('refuses to claim a later suspension of the same run', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-10-10T10:00:00Z'));
      const first = await suspend();
      const resumeClaimId = await workflowRunService.claimSuspended(
        workflowRun.id,
        first.suspendedAt ?? null,
      );
      jest.setSystemTime(new Date('2024-10-10T10:05:00Z'));
      await workflowRunService.markSuspended(
        workflowRun.id,
        { checkpoint },
        resumeClaimId,
      );
      jest.useRealTimers();

      expect(
        await workflowRunService.claimSuspended(
          workflowRun.id,
          first.suspendedAt ?? null,
        ),
      ).toBeNull();
    });

    it('releases a claim back to the same suspension, as it was', async () => {
      const suspended = await suspend();
      const resumeClaimId = (await workflowRunService.claimSuspended(
        workflowRun.id,
        suspended.suspendedAt ?? null,
      ))!;

      expect(
        await workflowRunService.releaseClaim(workflowRun.id, resumeClaimId),
      ).toBe(true);

      const stored = (await workflowRunService.findOne(workflowRun.id))!;
      expect(stored.status).toBe('suspended');
      expect(stored.context).toEqual(suspended.context);
      expect(stored.checkpoint).toEqual(checkpoint);
      expect(stored.suspendedAt?.getTime()).toBe(
        suspended.suspendedAt?.getTime(),
      );
      expect(await readClaim(workflowRun.id)).toEqual(released);
      expect(
        await workflowRunService.claimSuspended(
          workflowRun.id,
          stored.suspendedAt ?? null,
        ),
      ).toEqual(expect.any(String));
    });

    it('drops the writes of a pass whose run was taken over', async () => {
      // The thread of the run was closed while its pass ran.
      expect(
        await workflowRunService.markFailed(
          workflowRun.id,
          { error: 'Thread was closed' },
          null,
        ),
      ).toBe(true);

      expect(
        await workflowRunService.markRunning(workflowRun.id, claimId, {
          context: {},
        }),
      ).toBe(false);
      expect(
        await workflowRunService.markSuspended(
          workflowRun.id,
          { checkpoint },
          claimId,
        ),
      ).toBe(false);
      expect(
        await workflowRunService.markFinished(workflowRun.id, {}, claimId),
      ).toBe(false);
      expect(
        await workflowRunService.releaseClaim(workflowRun.id, claimId),
      ).toBe(false);
      expect(await workflowRunService.findOne(workflowRun.id)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Thread was closed',
        }),
      );
    });

    it('refuses to settle a run under another claim', async () => {
      expect(
        await workflowRunService.markFinished(workflowRun.id, {}, randomUUID()),
      ).toBe(false);

      expect((await workflowRunService.findOne(workflowRun.id))?.status).toBe(
        'idle',
      );
      expect((await readClaim(workflowRun.id)).claimId).toBe(claimId);
    });

    it('refuses to take over a run that is not active', async () => {
      await suspend();

      expect(
        await workflowRunService.markFailed(
          workflowRun.id,
          { error: 'Thread was closed' },
          null,
        ),
      ).toBe(false);
      expect((await workflowRunService.findOne(workflowRun.id))?.status).toBe(
        'suspended',
      );
    });
  });

  describe('claim leases', () => {
    const operatorCheckpoint: WorkflowCheckpoint = {
      ...checkpoint,
      waits: [{ ...wait, reason: 'awaiting_approval' }],
    };
    /** Time at which every claim taken by the tests has lapsed. */
    const later = () => new Date(Date.now() + 10 * 60_000);

    it('holds a claim only while its pass runs, however it ends', async () => {
      await expect(
        workflowRunService.withHeldClaim(workflowRun.id, claimId, async () => {
          expect(workflowRunService.holdsClaim(claimId)).toBe(true);
          throw new Error('pass-crash');
        }),
      ).rejects.toThrow('pass-crash');

      expect(workflowRunService.holdsClaim(claimId)).toBe(false);
    });

    it('renews only the claims held in this process', async () => {
      const { run: other } = await createClaimedRun();
      const before = await readClaim(workflowRun.id);
      const otherBefore = await readClaim(other.id);
      const updatedAt = (await workflowRunService.findOne(workflowRun.id))
        ?.updatedAt;
      jest.useFakeTimers().setSystemTime(Date.now() + 30_000);

      expect(
        await workflowRunService.withHeldClaim(workflowRun.id, claimId, () =>
          workflowRunService.renewHeldClaims(),
        ),
      ).toBe(1);

      expect(
        (await readClaim(workflowRun.id)).claimExpiresAt!.getTime(),
      ).toBeGreaterThan(before.claimExpiresAt!.getTime());
      expect(
        (await workflowRunService.findOne(workflowRun.id))?.updatedAt,
      ).toEqual(updatedAt);
      expect(await readClaim(other.id)).toEqual(otherBefore);
      expect(await workflowRunService.renewHeldClaims()).toBe(0);
    });

    it('finds the active runs whose claim lapsed', async () => {
      const { run: other, claimId: otherClaimId } = await createClaimedRun();
      await workflowRunService.markSuspended(
        other.id,
        { checkpoint },
        otherClaimId,
      );
      const suspended = (await workflowRunService.findOne(other.id))!;
      const resumeClaimId = (await workflowRunService.claimSuspended(
        other.id,
        suspended.suspendedAt ?? null,
      ))!;

      expect(await workflowRunService.findExpiredClaims(new Date())).toEqual(
        [],
      );
      expect(await workflowRunService.findExpiredClaims(later())).toEqual(
        expect.arrayContaining([
          {
            id: workflowRun.id,
            claimId,
            hasCheckpoint: false,
            recoveryCount: 0,
          },
          {
            id: other.id,
            claimId: resumeClaimId,
            hasCheckpoint: true,
            recoveryCount: 0,
          },
        ]),
      );
    });

    it('puts a run whose resume died back on the suspension it was claimed from', async () => {
      await workflowRunService.markSuspended(
        workflowRun.id,
        { checkpoint: operatorCheckpoint, snapshot, context: { lang: 'en' } },
        claimId,
      );
      const suspended = (await workflowRunService.findOne(workflowRun.id))!;
      const resumeClaimId = (await workflowRunService.claimSuspended(
        workflowRun.id,
        suspended.suspendedAt ?? null,
      ))!;
      const now = later();
      const [expired] = await workflowRunService.findExpiredClaims(now);

      expect(expired.claimId).toBe(resumeClaimId);
      expect(await workflowRunService.putBackExpired(expired, now)).toBe(true);

      const recovered = (await workflowRunService.findOne(workflowRun.id))!;
      expect(recovered).toEqual(
        expect.objectContaining({
          status: 'suspended',
          checkpoint: operatorCheckpoint,
          snapshot,
          context: { lang: 'en' },
          awaitingOperator: true,
        }),
      );
      expect(recovered.suspendedAt?.getTime()).toBe(
        suspended.suspendedAt?.getTime(),
      );
      expect(await readClaim(workflowRun.id)).toEqual({
        claimId: null,
        claimExpiresAt: null,
        recoveryCount: 1,
      });
      expect(
        (
          await workflowRunService.find(
            workflowRunService.withAwaitingOperatorScope(),
          )
        ).map(({ id }) => id),
      ).toEqual([workflowRun.id]);
      // Another node finds nothing left to recover.
      expect(await workflowRunService.putBackExpired(expired, now)).toBe(false);
    });

    it('fails a run whose claim lapsed before it ever suspended', async () => {
      await workflowRunService.markRunning(workflowRun.id, claimId, {
        context: { user: 'demo' },
      });
      const now = later();
      const [expired] = await workflowRunService.findExpiredClaims(now);

      expect(
        await workflowRunService.failExpired(expired, now, 'Interrupted'),
      ).toBe(true);

      const recovered = (await workflowRunService.findOne(workflowRun.id))!;
      expect(recovered).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Interrupted',
          checkpoint: null,
          awaitingOperator: false,
          context: { user: 'demo' },
        }),
      );
      expect(recovered.failedAt?.getTime()).toBe(now.getTime());
      expect((await readClaim(workflowRun.id)).claimId).toBeNull();
    });

    it('leaves a run whose claim was renewed after it was found lapsed', async () => {
      const now = later();
      const [expired] = await workflowRunService.findExpiredClaims(now);
      jest.useFakeTimers().setSystemTime(now.getTime() + 1);
      await workflowRunService.withHeldClaim(workflowRun.id, claimId, () =>
        workflowRunService.renewHeldClaims(),
      );
      jest.useRealTimers();

      expect(
        await workflowRunService.failExpired(expired, now, 'Interrupted'),
      ).toBe(false);
      expect((await workflowRunService.findOne(workflowRun.id))?.status).toBe(
        'idle',
      );
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
    const isAwaitingOperator = async (runId: string) =>
      (await workflowRunService.findOne(runId))?.awaitingOperator;
    /** Claim the current suspension of a run. */
    const claim = async (runId: string) => {
      const suspended = (await workflowRunService.findOne(runId))!;

      return (await workflowRunService.claimSuspended(
        runId,
        suspended.suspendedAt ?? null,
      ))!;
    };

    it('flags a run suspended on an operator wait', async () => {
      await workflowRunService.markSuspended(
        workflowRun.id,
        { checkpoint: operatorCheckpoint },
        claimId,
      );

      expect(await isAwaitingOperator(workflowRun.id)).toBe(true);
    });

    it('does not flag a run suspended on other waits', async () => {
      await workflowRunService.markSuspended(
        workflowRun.id,
        { checkpoint },
        claimId,
      );

      expect(await isAwaitingOperator(workflowRun.id)).toBe(false);
    });

    it('keeps the flag while the run is claimed and clears it once the run ends', async () => {
      await workflowRunService.markSuspended(
        workflowRun.id,
        { checkpoint: operatorCheckpoint },
        claimId,
      );
      const refusedClaimId = await claim(workflowRun.id);
      expect(await isAwaitingOperator(workflowRun.id)).toBe(true);
      await workflowRunService.releaseClaim(workflowRun.id, refusedClaimId);
      expect(await isAwaitingOperator(workflowRun.id)).toBe(true);

      await workflowRunService.markFinished(
        workflowRun.id,
        {},
        await claim(workflowRun.id),
      );
      expect(await isAwaitingOperator(workflowRun.id)).toBe(false);

      const { run: other, claimId: otherClaimId } = await createClaimedRun();
      await workflowRunService.markSuspended(
        other.id,
        { checkpoint: operatorCheckpoint },
        otherClaimId,
      );
      await workflowRunService.markFailed(other.id, {}, await claim(other.id));
      expect(await isAwaitingOperator(other.id)).toBe(false);
    });

    it('scopes find options to the runs waiting on an admin', async () => {
      await workflowRunService.markSuspended(
        workflowRun.id,
        { checkpoint: operatorCheckpoint },
        claimId,
      );
      const { run: other, claimId: otherClaimId } = await createClaimedRun();
      await workflowRunService.markSuspended(
        other.id,
        { checkpoint },
        otherClaimId,
      );

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

    it('fails a suspended run of a thread claimed meanwhile, and drops the outcome of its pass', async () => {
      const run = await loadSuspendedRun();
      // A resume claimed the run after it was loaded.
      const resumeClaimId = (await workflowRunService.claimSuspended(
        run.id,
        run.suspendedAt ?? null,
      ))!;
      jest
        .spyOn(workflowRunService, 'findAndPopulate')
        .mockResolvedValueOnce([run]);

      await workflowRunService.abortActiveRunsForThread('thread-1');

      expect(await workflowRunService.findOne(run.id)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Thread was closed',
        }),
      );
      // The resume ends afterwards: it cannot write over the failure.
      expect(
        await workflowRunService.markFinished(
          run.id,
          { output: { done: true } },
          resumeClaimId,
        ),
      ).toBe(false);
      expect((await workflowRunService.findOne(run.id))?.status).toBe('failed');
    });

    it('cancels a running run of a thread put back on its wait meanwhile', async () => {
      const suspended = await loadSuspendedRun();
      const resumeClaimId = (await workflowRunService.claimSuspended(
        suspended.id,
        suspended.suspendedAt ?? null,
      ))!;
      const running = (await workflowRunService.findOneAndPopulate(
        suspended.id,
      ))!;
      // Its resume let go of it after it was loaded.
      await workflowRunService.releaseClaim(suspended.id, resumeClaimId);
      jest
        .spyOn(workflowRunService, 'findAndPopulate')
        .mockResolvedValueOnce([running]);

      await workflowRunService.abortActiveRunsForThread('thread-1');

      const stored = await workflowRunService.findOne(suspended.id);
      expect(stored).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Thread was closed',
          checkpoint: null,
        }),
      );
      expect(stored?.snapshot?.actions?.[wait.step.id]).toEqual(
        expect.objectContaining({ status: 'cancelled' }),
      );
    });
  });
});

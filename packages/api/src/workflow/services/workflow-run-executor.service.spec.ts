/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  WaitInfo,
  WorkflowCheckpoint,
  WorkflowCheckpointInvalidError,
  WorkflowResumeRejectedError,
  WorkflowRunResult,
  WorkflowWaitNotFoundError,
} from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { LoggerService } from '@/logger/logger.service';

import { WorkflowContextFactory } from '../contexts/workflow-context-factory';
import { RunLease } from '../lib/run-lease';
import { ManualEventWrapper } from '../lib/trigger-event-wrapper';
import type { ClaimedResume } from '../types';

import { WorkflowCompiler } from './workflow-compiler.service';
import { WorkflowRunExecutor } from './workflow-run-executor.service';
import { WorkflowRunService } from './workflow-run.service';

const wait: WaitInfo = {
  waitId: 'ask@index:1',
  step: { id: 'ask', name: 'ask', type: StepType.Task },
  suspendKey: 'index:1',
  reason: 'awaiting_user_response',
};
const checkpoint = { waits: [wait] } as unknown as WorkflowCheckpoint;
const suspendedAt = new Date('2026-01-01T10:00:00.000Z');
const run = {
  id: 'run-1',
  status: 'suspended',
  input: { text: 'hi' },
  snapshot: { status: 'suspended', actions: {} },
  checkpoint,
  suspendedAt,
  workflow: { id: 'workflow-1' },
  triggeredBy: { id: 'user-1' },
} as unknown as WorkflowRunFull;
const finished: WorkflowRunResult = {
  status: 'finished',
  output: { done: true },
  snapshot: { status: 'finished', actions: {} },
};
const refusal = new WorkflowResumeRejectedError('Payload refused');
/** A resume whose step refused the payload, back on its wait. */
const refused: WorkflowRunResult = {
  status: 'suspended',
  waits: [wait],
  checkpoint,
  snapshot: { status: 'suspended', actions: {} },
  rejection: { waitId: wait.waitId, error: refusal },
};

describe('WorkflowRunExecutor', () => {
  const workflowRunService = {
    persistResult: jest.fn(),
    persistCrash: jest.fn(),
    claimSuspended: jest.fn(),
  };
  /** Writes of the lease the run is held under. */
  const leaseWrites = { updateClaimed: jest.fn(), settle: jest.fn() };
  /** Called once the lease ends, its claim no longer renewed. */
  const endLease = jest.fn();
  let lease: RunLease;
  const runner = { start: jest.fn(), resume: jest.fn() };
  const workflow = {
    buildAsyncRunner: jest.fn(),
    buildRunnerFromCheckpoint: jest.fn(),
    validateCheckpoint: jest.fn(),
  };
  const definition = { flow: [] };
  const workflowCompiler = { compile: jest.fn() };
  const context = { state: { saved: true } };
  const contextFactory = { create: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const logger = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const event = new ManualEventWrapper({ text: 'hi' }, 'user-1');
  let executor: WorkflowRunExecutor;
  const claimOptions = (resumeData: unknown = { text: 'reply' }) => ({
    run,
    event,
    resumeData,
    selectWait: (waits: WaitInfo[]) => waits[0],
  });
  const claimed = (): ClaimedResume => ({
    status: 'claimed',
    run,
    event,
    workflow: workflow as unknown as ClaimedResume['workflow'],
    checkpoint,
    context: context as unknown as ClaimedResume['context'],
    wait,
    resumeData: { text: 'reply' },
    lease,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    lease = new RunLease(run.id, 'claim-1', leaseWrites, endLease);
    leaseWrites.updateClaimed.mockResolvedValue(true);
    leaseWrites.settle.mockResolvedValue(true);
    workflowRunService.persistResult.mockResolvedValue(true);
    workflowRunService.persistCrash.mockResolvedValue(true);
    workflowRunService.claimSuspended.mockResolvedValue(lease);
    workflowCompiler.compile.mockReturnValue({ definition, workflow });
    workflow.buildAsyncRunner.mockResolvedValue(runner);
    workflow.buildRunnerFromCheckpoint.mockReturnValue(runner);
    workflow.validateCheckpoint.mockImplementation((stored) => ({
      ok: true,
      checkpoint: stored,
    }));
    contextFactory.create.mockResolvedValue(context);
    runner.start.mockImplementation(async () => {
      expect(endLease).not.toHaveBeenCalled();

      return finished;
    });
    runner.resume.mockImplementation(async () => {
      expect(endLease).not.toHaveBeenCalled();

      return finished;
    });
    executor = new WorkflowRunExecutor(
      workflowRunService as unknown as WorkflowRunService,
      workflowCompiler as unknown as WorkflowCompiler,
      contextFactory as unknown as WorkflowContextFactory,
      eventEmitter as unknown as EventEmitter2,
      logger as unknown as LoggerService,
    );
  });

  describe('start', () => {
    it('runs a new run under its claim and persists its result', async () => {
      await expect(executor.start(run, lease, event)).resolves.toEqual({
        status: 'settled',
        result: finished,
      });

      expect(contextFactory.create).toHaveBeenCalledWith(
        run,
        event,
        definition,
      );
      expect(leaseWrites.updateClaimed).toHaveBeenCalledWith(
        run.id,
        'claim-1',
        { status: 'running', context: context.state },
      );
      expect(runner.start).toHaveBeenCalledWith({
        inputData: run.input,
        context,
      });
      expect(workflowRunService.persistResult).toHaveBeenCalledWith(
        run,
        runner,
        finished,
        context.state,
        lease,
      );
    });

    it('drops a run whose claim was lost before its runner started', async () => {
      leaseWrites.updateClaimed.mockResolvedValue(false);

      await expect(executor.start(run, lease, event)).resolves.toEqual({
        status: 'claim_lost',
      });
      expect(runner.start).not.toHaveBeenCalled();
      expect(workflowRunService.persistCrash).not.toHaveBeenCalled();
    });

    it('drops the result of a run whose claim was lost while it ran', async () => {
      workflowRunService.persistResult.mockResolvedValue(false);

      await expect(executor.start(run, lease, event)).resolves.toEqual({
        status: 'claim_lost',
      });
    });

    it('fails a run whose runner throws', async () => {
      const crash = new Error('runner-crash');
      runner.start.mockRejectedValue(crash);

      await expect(executor.start(run, lease, event)).resolves.toEqual({
        status: 'crashed',
        error: crash,
      });
      expect(workflowRunService.persistCrash).toHaveBeenCalledWith(
        run,
        runner,
        context.state,
        crash,
        lease,
      );
    });

    it('fails a run that pins no definition before building anything', async () => {
      workflowCompiler.compile.mockReturnValue(undefined);

      await expect(executor.start(run, lease, event)).resolves.toEqual({
        status: 'crashed',
        error: new Error('Workflow definition is required to run the workflow'),
      });
      expect(workflowRunService.persistCrash).toHaveBeenCalledWith(
        run,
        undefined,
        undefined,
        expect.any(Error),
        lease,
      );
    });

    it('rethrows the error of the pass when its failure cannot be written', async () => {
      const crash = new Error('runner-crash');
      runner.start.mockRejectedValue(crash);
      workflowRunService.persistCrash.mockRejectedValue(
        new Error('database unavailable'),
      );

      await expect(executor.start(run, lease, event)).rejects.toBe(crash);
    });

    it('never persists an error writing the result as a crash', async () => {
      const writeError = new Error('database unavailable');
      workflowRunService.persistResult.mockRejectedValue(writeError);

      await expect(executor.start(run, lease, event)).rejects.toBe(writeError);
      expect(workflowRunService.persistCrash).not.toHaveBeenCalled();
    });
  });

  describe('claimResume', () => {
    it('validates the checkpoint and the payload, then claims the run', async () => {
      const options = claimOptions();

      await expect(executor.claimResume(options)).resolves.toEqual({
        ...claimed(),
        resumeData: options.resumeData,
      });

      expect(workflow.validateCheckpoint).toHaveBeenNthCalledWith(
        1,
        checkpoint,
      );
      expect(workflow.validateCheckpoint).toHaveBeenNthCalledWith(
        2,
        checkpoint,
        { waitId: wait.waitId, resumeData: options.resumeData },
      );
      expect(workflowRunService.claimSuspended).toHaveBeenCalledWith(
        run.id,
        suspendedAt,
      );
      expect(
        workflow.validateCheckpoint.mock.invocationCallOrder[1],
      ).toBeLessThan(
        workflowRunService.claimSuspended.mock.invocationCallOrder[0],
      );
    });

    it('refuses a payload without claiming the run', async () => {
      workflow.validateCheckpoint
        .mockReturnValueOnce({ ok: true, checkpoint })
        .mockReturnValueOnce({ ok: false, error: refusal });
      const options = claimOptions({ text: 42 });

      await expect(executor.claimResume(options)).resolves.toEqual({
        status: 'rejected',
        error: refusal,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'hook:workflow:resume_rejected',
        { runId: run.id, wait, resumeData: options.resumeData, error: refusal },
      );
      expect(contextFactory.create).not.toHaveBeenCalled();
      expect(workflowRunService.claimSuspended).not.toHaveBeenCalled();
    });

    it('leaves a run that has no wait the caller resolves', async () => {
      await expect(
        executor.claimResume({
          ...claimOptions(),
          selectWait: () => undefined,
        }),
      ).resolves.toEqual({ status: 'no_wait' });
      expect(workflowRunService.claimSuspended).not.toHaveBeenCalled();
    });

    it('throws, without claiming, when the picked wait cannot be checked', async () => {
      const error = new WorkflowWaitNotFoundError(wait.waitId, []);
      workflow.validateCheckpoint
        .mockReturnValueOnce({ ok: true, checkpoint })
        .mockReturnValueOnce({ ok: false, error });

      await expect(executor.claimResume(claimOptions())).rejects.toBe(error);
      expect(workflowRunService.claimSuspended).not.toHaveBeenCalled();
    });

    it('reports a run another caller claimed first', async () => {
      workflowRunService.claimSuspended.mockResolvedValue(null);

      await expect(executor.claimResume(claimOptions())).resolves.toEqual({
        status: 'claim_lost',
      });
    });

    it.each([
      [
        'pins no definition',
        () => workflowCompiler.compile.mockReturnValue(undefined),
        'Cannot resume workflow run: Workflow definition is required to run the workflow',
      ],
      [
        'holds an invalid checkpoint',
        () =>
          workflow.validateCheckpoint.mockReturnValue({
            ok: false,
            error: new WorkflowCheckpointInvalidError(
              'missing',
              'No checkpoint',
            ),
          }),
        'Cannot resume workflow run: No checkpoint',
      ],
    ])('fails a run that %s', async (_label, arrange, message) => {
      arrange();

      await expect(executor.claimResume(claimOptions())).resolves.toEqual({
        status: 'unresumable',
        error: message,
      });
      expect(leaseWrites.settle).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({
          status: 'failed',
          checkpoint: null,
          error: message,
        }),
        'claim-1',
      );
    });
  });

  describe('failUnresumable', () => {
    it('leaves a run another caller claimed first', async () => {
      workflowRunService.claimSuspended.mockResolvedValue(null);

      await expect(
        executor.failUnresumable(run, new Error('drift')),
      ).resolves.toEqual({ status: 'claim_lost' });
      expect(leaseWrites.settle).not.toHaveBeenCalled();
    });

    it('reports a run taken over while it was being failed', async () => {
      leaseWrites.settle.mockResolvedValue(false);

      await expect(
        executor.failUnresumable(run, new Error('drift')),
      ).resolves.toEqual({ status: 'claim_lost' });
    });
  });

  describe('resume', () => {
    it('restores the run from its checkpoint and persists its result', async () => {
      const claim = claimed();

      await expect(executor.resume(claim)).resolves.toEqual({
        status: 'settled',
        result: finished,
      });
      expect(workflow.buildRunnerFromCheckpoint).toHaveBeenCalledWith({
        checkpoint,
        context,
        snapshot: run.snapshot,
        runId: run.id,
      });
      expect(runner.resume).toHaveBeenCalledWith({
        waitId: wait.waitId,
        resumeData: claim.resumeData,
      });
      expect(workflowRunService.persistResult).toHaveBeenCalledWith(
        run,
        runner,
        finished,
        context.state,
        lease,
      );
    });

    it('puts the run back on its wait when a step refuses the payload', async () => {
      runner.resume.mockResolvedValue(refused);

      await expect(executor.resume(claimed())).resolves.toEqual({
        status: 'rejected',
        waits: [wait],
        error: refusal,
      });
      expect(leaseWrites.settle).toHaveBeenCalledWith(
        run.id,
        { status: 'suspended' },
        'claim-1',
      );
      expect(workflowRunService.persistResult).not.toHaveBeenCalled();
    });

    it('fails the run when its runner throws', async () => {
      const crash = new Error('runner-crash');
      runner.resume.mockRejectedValue(crash);

      await expect(executor.resume(claimed())).resolves.toEqual({
        status: 'crashed',
        error: crash,
      });
      expect(workflowRunService.persistCrash).toHaveBeenCalledWith(
        run,
        runner,
        context.state,
        crash,
        lease,
      );
    });

    it.each([
      [
        'its result',
        () => workflowRunService.persistResult.mockResolvedValue(false),
      ],
      [
        'its refusal',
        () => {
          runner.resume.mockResolvedValue(refused);
          leaseWrites.settle.mockResolvedValue(false);
        },
      ],
      [
        'its failure',
        () => {
          runner.resume.mockRejectedValue(new Error('runner-crash'));
          workflowRunService.persistCrash.mockResolvedValue(false);
        },
      ],
    ])('drops %s once the run was taken over', async (_label, arrange) => {
      arrange();

      await expect(executor.resume(claimed())).resolves.toEqual({
        status: 'claim_lost',
      });
    });

    it('rethrows the error of the pass when its failure cannot be written', async () => {
      const crash = new Error('runner-crash');
      runner.resume.mockRejectedValue(crash);
      workflowRunService.persistCrash.mockRejectedValue(
        new Error('database unavailable'),
      );

      await expect(executor.resume(claimed())).rejects.toBe(crash);
    });
  });

  describe('leases', () => {
    it.each([
      ['settles', () => undefined],
      [
        'loses its claim before its runner starts',
        () => leaseWrites.updateClaimed.mockResolvedValue(false),
      ],
      [
        'crashes',
        () => runner.start.mockRejectedValue(new Error('runner-crash')),
      ],
      [
        'cannot write how it ended',
        () =>
          workflowRunService.persistResult.mockRejectedValue(
            new Error('database unavailable'),
          ),
      ],
    ])('ends the lease of a first pass that %s', async (_label, arrange) => {
      arrange();

      await executor.start(run, lease, event).catch(() => undefined);

      expect(endLease).toHaveBeenCalledWith(lease);
    });

    it.each([
      ['settles', () => undefined],
      ['is refused', () => runner.resume.mockResolvedValue(refused)],
      [
        'crashes',
        () => runner.resume.mockRejectedValue(new Error('runner-crash')),
      ],
      [
        'cannot write how it ended',
        () =>
          workflowRunService.persistResult.mockRejectedValue(
            new Error('database unavailable'),
          ),
      ],
    ])('ends the lease of a resume that %s', async (_label, arrange) => {
      arrange();

      await executor.resume(claimed()).catch(() => undefined);

      expect(endLease).toHaveBeenCalledWith(lease);
    });

    it('ends the lease of a run it fails because it can never resume', async () => {
      workflowCompiler.compile.mockReturnValue(undefined);

      await executor.claimResume(claimOptions());

      expect(endLease).toHaveBeenCalledWith(lease);
    });
  });

  describe('with a run that stored nothing optional', () => {
    const bareRun = {
      ...run,
      input: null,
      snapshot: null,
      suspendedAt: null,
      triggeredBy: null,
    } as unknown as WorkflowRunFull;

    it('starts it with an empty input', async () => {
      await executor.start(bareRun, lease, event);

      expect(runner.start).toHaveBeenCalledWith({ inputData: {}, context });
    });

    it('claims it on its suspension, even undated, to fail it', async () => {
      workflowCompiler.compile.mockReturnValue(undefined);

      await executor.claimResume({ ...claimOptions(), run: bareRun });

      expect(workflowRunService.claimSuspended).toHaveBeenCalledWith(
        run.id,
        null,
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Workflow run can no longer be resumed',
        expect.any(Error),
        expect.objectContaining({ triggeredById: null }),
      );
    });

    it('restores it without a snapshot', async () => {
      const bareWait = { ...wait, reason: undefined };
      runner.resume.mockResolvedValue({
        ...refused,
        waits: [bareWait],
        rejection: { waitId: wait.waitId, error: refusal },
      });

      await executor.resume({ ...claimed(), run: bareRun, wait: bareWait });

      expect(workflow.buildRunnerFromCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: undefined }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Workflow run refused the resume payload',
        expect.objectContaining({ reason: null }),
      );
    });
  });
});

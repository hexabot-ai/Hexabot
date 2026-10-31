/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  WaitInfo,
  WorkflowResumeRejectedError,
  WorkflowRunResult,
} from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';

import { LoggerService } from '@/logger/logger.service';
import { stringifyError } from '@/utils/helpers/misc';

import {
  ManualEventWrapper,
  TriggerEventWrapper,
} from '../lib/trigger-event-wrapper';
import { getOpenWaits } from '../lib/workflow-run-waits';
import {
  AWAITING_CHILD_WORKFLOW_REASON,
  ClaimedResume,
  ResumeRunOptions,
  RunPass,
} from '../types';

import { WorkflowCallStackService } from './workflow-call-stack.service';
import { WorkflowEventRestorer } from './workflow-event-restorer.service';
import { WorkflowRunExecutor } from './workflow-run-executor.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

const childWait = (childRunId: string): WaitInfo => ({
  waitId: `call_${childRunId}@index:1`,
  step: { id: `call_${childRunId}`, name: 'call', type: StepType.Task },
  suspendKey: 'index:1',
  reason: AWAITING_CHILD_WORKFLOW_REASON,
  data: { workflow_id: 'workflow-child', workflow_run_id: childRunId },
});
const replyWait: WaitInfo = {
  waitId: 'ask@index:1',
  step: { id: 'ask', name: 'ask', type: StepType.Task },
  suspendKey: 'index:1',
  reason: 'awaiting_user_response',
};
const buildRun = (
  id: string,
  overrides: Omit<Partial<WorkflowRunFull>, 'parentRun'> & {
    /** Id of the calling run, as `resolveRunId` reads it. */
    parentRun?: string | null;
    waits?: WaitInfo[];
  } = {},
): WorkflowRunFull => {
  const { waits = [], ...rest } = overrides;

  return {
    id,
    status: 'suspended',
    workflow: { id: `workflow-${id}` },
    parentRun: null,
    checkpoint: waits.length > 0 ? { waits } : null,
    output: null,
    error: null,
    ...rest,
  } as unknown as WorkflowRunFull;
};
const finished: WorkflowRunResult = {
  status: 'finished',
  output: { done: true },
  snapshot: { status: 'finished', actions: {} },
};
const suspended = (waits: WaitInfo[]): RunPass => ({
  status: 'settled',
  result: {
    status: 'suspended',
    waits,
    checkpoint: { waits } as never,
    snapshot: { status: 'suspended', actions: {} },
  },
});
const refused = (
  waits: WaitInfo[],
  error: WorkflowResumeRejectedError,
): RunPass => ({ status: 'rejected', waits, error });
/** The `call_workflow` payload of a child run that finished. */
const finishedResult = (runId: string, output: Record<string, unknown>) => ({
  status: 'finished',
  workflow_id: `workflow-${runId}`,
  workflow_run_id: runId,
  output,
});
/** The `call_workflow` payload of a child run that failed. */
const failedResult = (runId: string, error: string) => ({
  status: 'failed',
  workflow_id: `workflow-${runId}`,
  workflow_run_id: runId,
  error,
});

describe('WorkflowCallStackService', () => {
  /** Runs as stored, by id. */
  let runs: Map<string, WorkflowRunFull>;
  /** How the next passes of each run end; a run finishes by default. */
  let passes: Map<string, RunPass[]>;
  const executor = {
    claimResume: jest.fn(),
    resume: jest.fn(),
    failUnresumable: jest.fn(),
  };
  const workflowRunService = {
    findOneAndPopulate: jest.fn(),
    cancelAbandonedRuns: jest.fn(),
  };
  const workflowService = { findOne: jest.fn() };
  const eventRestorer = { restore: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const event = new ManualEventWrapper({}, 'user-1');
  let service: WorkflowCallStackService;
  /** Store runs: a root waiting on `run-1`, which waits on `run-2`. */
  const storeCallStack = () => {
    runs = new Map(
      [
        buildRun('run-0', { waits: [childWait('run-1')] }),
        buildRun('run-1', { parentRun: 'run-0', waits: [childWait('run-2')] }),
        buildRun('run-2', { parentRun: 'run-1' }),
      ].map((run) => [run.id, run]),
    );
  };
  const store = (id: string, overrides: Parameters<typeof buildRun>[1]) =>
    runs.set(id, buildRun(id, overrides));
  /** Store how a pass left its run, as the executor does. */
  const storePass = (runId: string, pass: RunPass): RunPass => {
    const run = runs.get(runId)!;
    if (pass.status === 'crashed') {
      runs.set(runId, {
        ...run,
        status: 'failed',
        checkpoint: null,
        error: stringifyError(pass.error),
      });
    } else if (pass.status === 'settled') {
      const { result } = pass;
      runs.set(runId, {
        ...run,
        status: result.status,
        checkpoint: result.status === 'suspended' ? result.checkpoint : null,
        output: result.status === 'finished' ? result.output : run.output,
        error: result.status === 'failed' ? stringifyError(result.error) : null,
      } as WorkflowRunFull);
    }

    return pass;
  };
  /** The runs reconciled, in order. */
  const reconciled = () =>
    workflowRunService.cancelAbandonedRuns.mock.calls.map(
      ([runId]: [string]) => runId,
    );
  /** The runs resumed, in order, and what each was resumed with. */
  const resumes = () =>
    executor.resume.mock.calls.map(([claim]: [ClaimedResume]) => [
      claim.run.id,
      claim.resumeData,
    ]);
  const claimFor = (
    run: WorkflowRunFull,
    claimEvent: TriggerEventWrapper = event,
  ): ClaimedResume =>
    ({
      status: 'claimed',
      run,
      event: claimEvent,
      wait: replyWait,
      resumeData: { text: 'reply' },
    }) as unknown as ClaimedResume;

  beforeEach(() => {
    jest.resetAllMocks();
    storeCallStack();
    passes = new Map();
    workflowRunService.findOneAndPopulate.mockImplementation(
      async (id: string) => runs.get(id) ?? null,
    );
    // Nothing to cancel: each run is read as stored.
    workflowRunService.cancelAbandonedRuns.mockImplementation(
      async (id: string) => runs.get(id) ?? null,
    );
    // Claim the wait the caller picks, as the executor does.
    executor.claimResume.mockImplementation(
      async (options: ResumeRunOptions) => {
        const wait = options.selectWait(getOpenWaits(options.run));

        return wait
          ? {
              ...claimFor(options.run, options.event),
              wait,
              resumeData: options.resumeData,
            }
          : { status: 'no_wait' };
      },
    );
    executor.resume.mockImplementation(async ({ run }: ClaimedResume) =>
      storePass(
        run.id,
        passes.get(run.id)?.shift() ?? { status: 'settled', result: finished },
      ),
    );
    executor.failUnresumable.mockImplementation(
      async (run: WorkflowRunFull, error: unknown) => {
        const message = `Cannot resume workflow run: ${stringifyError(error)}`;
        runs.set(run.id, { ...run, status: 'failed', error: message });

        return { status: 'unresumable', error: message };
      },
    );
    service = new WorkflowCallStackService(
      executor as unknown as WorkflowRunExecutor,
      workflowRunService as unknown as WorkflowRunService,
      workflowService as unknown as WorkflowService,
      eventRestorer as unknown as WorkflowEventRestorer,
      logger as unknown as LoggerService,
    );
  });

  describe('continueResume', () => {
    it('carries the result of a run that ended up its call stack', async () => {
      await expect(
        service.continueResume(claimFor(runs.get('run-2')!)),
      ).resolves.toEqual({ status: 'settled', result: finished });

      expect(resumes()).toEqual([
        ['run-2', { text: 'reply' }],
        ['run-1', finishedResult('run-2', { done: true })],
        ['run-0', finishedResult('run-1', { done: true })],
      ]);
      // Each run that ended is reconciled before its parent, so the runs it
      // called that nothing waits on any more are cancelled.
      expect(reconciled()).toEqual([
        'run-2',
        'run-1',
        'run-1',
        'run-0',
        'run-0',
      ]);
    });

    it('catches up the children that ended while a run was not suspended', async () => {
      store('run-3', { parentRun: 'run-2', status: 'finished' });
      passes.set('run-2', [suspended([childWait('run-3')])]);

      await service.continueResume(claimFor(runs.get('run-2')!));

      expect(resumes()).toEqual([
        ['run-2', { text: 'reply' }],
        ['run-2', finishedResult('run-3', {})],
        ['run-1', finishedResult('run-2', { done: true })],
        ['run-0', finishedResult('run-1', { done: true })],
      ]);
    });

    it('leaves the parent of a suspended run waiting', async () => {
      passes.set('run-2', [suspended([replyWait])]);

      await service.continueResume(claimFor(runs.get('run-2')!));

      expect(executor.claimResume).not.toHaveBeenCalled();
    });

    it('catches up ended children of a run that refused the payload', async () => {
      store('run-3', { parentRun: 'run-2', status: 'failed', error: 'boom' });
      store('run-2', {
        parentRun: 'run-1',
        waits: [replyWait, childWait('run-3')],
      });
      const refusal = new WorkflowResumeRejectedError('Unknown order');
      const refusedPass = refused([replyWait, childWait('run-3')], refusal);
      passes.set('run-2', [refusedPass, suspended([replyWait])]);

      await expect(
        service.continueResume(claimFor(runs.get('run-2')!)),
      ).resolves.toEqual(refusedPass);
      expect(resumes()).toEqual([
        ['run-2', { text: 'reply' }],
        ['run-2', failedResult('run-3', 'boom')],
      ]);
    });

    it('sends the failure of a crashed run to its parent', async () => {
      const crash = new Error('runner-crash');
      passes.set('run-2', [{ status: 'crashed', error: crash }]);

      await expect(
        service.continueResume(claimFor(runs.get('run-2')!)),
      ).resolves.toEqual({ status: 'crashed', error: crash });
      expect(resumes()[1]).toEqual([
        'run-1',
        failedResult('run-2', 'runner-crash'),
      ]);
      expect(reconciled().slice(0, 2)).toEqual(['run-2', 'run-1']);
    });

    it('leaves the delivery of a run taken over to whoever settled it', async () => {
      passes.set('run-2', [{ status: 'claim_lost' }]);

      await expect(
        service.continueResume(claimFor(runs.get('run-2')!)),
      ).resolves.toEqual({ status: 'claim_lost' });
      expect(executor.claimResume).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it.each([
      ['does not exist', 'run-9'],
      ['is not suspended', 'run-1'],
    ])('leaves a run that %s', async (_label, runId) => {
      store('run-2', { parentRun: 'run-1', status: 'finished' });
      store('run-1', {
        parentRun: 'run-0',
        status: 'running',
        waits: [childWait('run-2')],
      });

      await service.reconcile([runId, null], event);

      expect(executor.claimResume).not.toHaveBeenCalled();
    });

    it('leaves a run nothing waits on any more', async () => {
      store('run-2', { parentRun: 'run-1', status: 'finished' });
      // Its caller no longer waits on it: it was cancelled.
      workflowRunService.cancelAbandonedRuns.mockResolvedValueOnce(null);

      await service.reconcile(['run-1'], event);

      expect(reconciled()).toEqual(['run-1']);
      expect(workflowRunService.findOneAndPopulate).not.toHaveBeenCalled();
      expect(executor.claimResume).not.toHaveBeenCalled();
    });

    it('resolves the ended children one at a time, skipping those still going', async () => {
      store('run-1', {
        parentRun: 'run-0',
        waits: [
          replyWait,
          childWait('run-2'),
          childWait('run-3'),
          childWait('run-4'),
        ],
      });
      store('run-3', {
        parentRun: 'run-1',
        status: 'finished',
        output: { c: 3 },
      });
      store('run-4', { parentRun: 'run-1', status: 'failed' });
      passes.set('run-1', [
        suspended([replyWait, childWait('run-2'), childWait('run-4')]),
        suspended([replyWait, childWait('run-2')]),
      ]);

      await service.reconcile(['run-1'], event);

      expect(resumes()).toEqual([
        ['run-1', finishedResult('run-3', { c: 3 })],
        ['run-1', failedResult('run-4', 'Child workflow run failed')],
      ]);
    });

    it('skips an ended run that another run called', async () => {
      store('run-2', { parentRun: 'run-0', status: 'finished' });

      await service.reconcile(['run-1'], event);

      expect(executor.claimResume).not.toHaveBeenCalled();
    });

    it.each([
      [
        'its run',
        { id: 'workflow-child' },
        'Called workflow run run-2 was deleted',
      ],
      ['its workflow', null, 'Called workflow workflow-child was deleted'],
    ])('fails a call once %s was deleted', async (_label, workflow, error) => {
      runs.delete('run-2');
      passes.set('run-1', [suspended([replyWait])]);
      workflowService.findOne.mockResolvedValue(workflow);

      await service.reconcile(['run-1'], event);

      expect(workflowService.findOne).toHaveBeenCalledWith('workflow-child');
      expect(resumes()).toEqual([
        [
          'run-1',
          {
            status: 'failed',
            workflow_id: 'workflow-child',
            workflow_run_id: 'run-2',
            error,
          },
        ],
      ]);
    });

    describe('when a run refuses the result of its child', () => {
      const refusal = new WorkflowResumeRejectedError('Unexpected result');

      beforeEach(() => {
        store('run-2', { parentRun: 'run-1', status: 'finished' });
      });

      it.each([
        [
          'before its pass',
          () =>
            executor.claimResume.mockResolvedValueOnce({
              status: 'rejected',
              error: refusal,
            }),
        ],
        [
          'during its pass',
          () => passes.set('run-1', [refused([childWait('run-2')], refusal)]),
        ],
      ])('fails it %s, and passes the failure on', async (_label, arrange) => {
        arrange();

        await service.reconcile(['run-1'], event);

        expect(executor.failUnresumable).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'run-1' }),
          refusal,
        );
        expect(resumes().at(-1)).toEqual([
          'run-0',
          failedResult(
            'run-1',
            'Cannot resume workflow run: Unexpected result',
          ),
        ]);
        expect(reconciled().slice(0, 3)).toEqual(['run-1', 'run-1', 'run-0']);
      });

      it('leaves its parent alone when it was taken over', async () => {
        executor.claimResume.mockResolvedValueOnce({
          status: 'rejected',
          error: refusal,
        });
        executor.failUnresumable.mockResolvedValueOnce({
          status: 'claim_lost',
        });

        await service.reconcile(['run-1'], event);

        expect(executor.claimResume).toHaveBeenCalledTimes(1);
      });
    });

    it('leaves a run claimed by another caller to it', async () => {
      store('run-2', { parentRun: 'run-1', status: 'finished' });
      executor.claimResume.mockResolvedValueOnce({ status: 'claim_lost' });

      await service.reconcile(['run-1'], event);

      expect(executor.resume).not.toHaveBeenCalled();
      expect(executor.failUnresumable).not.toHaveBeenCalled();
    });

    it('sends the failure of a run that can never resume to its parent', async () => {
      const error = 'Cannot resume workflow run: drift';
      store('run-2', { parentRun: 'run-1', status: 'finished' });
      executor.claimResume.mockImplementationOnce(
        async ({ run }: ResumeRunOptions) => {
          runs.set(run.id, { ...run, status: 'failed', error });

          return { status: 'unresumable', error };
        },
      );

      await service.reconcile(['run-1'], event);

      expect(resumes()).toEqual([['run-0', failedResult('run-1', error)]]);
      expect(reconciled()).toEqual(['run-1', 'run-1', 'run-0', 'run-0']);
    });

    it('rebuilds the trigger of the first run it resumes when given none', async () => {
      store('run-2', { parentRun: 'run-1', status: 'finished' });
      const restored = new ManualEventWrapper({}, 'user-2');
      eventRestorer.restore.mockResolvedValue(restored);

      await service.reconcile(['run-1']);

      expect(eventRestorer.restore).toHaveBeenCalledTimes(1);
      expect(eventRestorer.restore).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-1' }),
      );
      expect(
        executor.claimResume.mock.calls.map(
          ([options]: [ResumeRunOptions]) => options.event,
        ),
      ).toEqual([restored, restored]);
    });

    it('leaves a run whose trigger cannot be rebuilt, and goes on', async () => {
      store('run-2', { parentRun: 'run-1', status: 'finished' });
      store('run-5', { waits: [childWait('run-6')] });
      store('run-6', { parentRun: 'run-5', status: 'finished' });
      eventRestorer.restore
        .mockRejectedValueOnce(new Error('Thread is closed'))
        .mockResolvedValueOnce(event);

      await service.reconcile(['run-1', 'run-5']);

      expect(resumes()).toEqual([['run-5', finishedResult('run-6', {})]]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to rebuild the trigger'),
        { runId: 'run-1', error: 'Thread is closed' },
      );
    });

    it('goes on with the other runs once one cannot be resumed', async () => {
      store('run-2', { parentRun: 'run-1', status: 'finished' });
      store('run-5', { waits: [childWait('run-6')] });
      store('run-6', { parentRun: 'run-5', status: 'finished' });
      const compileError = new Error(
        'No action implementations provided for: x',
      );
      executor.claimResume.mockRejectedValueOnce(compileError);

      await expect(
        service.reconcile(['run-1', 'run-5'], event),
      ).resolves.toBeUndefined();

      expect(resumes()).toEqual([['run-5', finishedResult('run-6', {})]]);
      expect(logger.error).toHaveBeenCalledWith(
        'Unable to deliver a child result to a workflow run',
        compileError,
        { runId: 'run-1' },
      );
    });
  });
});

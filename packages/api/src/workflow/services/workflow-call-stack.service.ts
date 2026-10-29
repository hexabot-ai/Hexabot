/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WaitInfo, WorkflowResumeRejectedError } from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';
import { stringifyError } from '@/utils/helpers/misc';

import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import {
  followUps,
  getCalledWorkflowId,
  getChildRunId,
  resolveRunId,
  toDeletedCallWorkflowResult,
  toEndedCallWorkflowResult,
} from '../lib/workflow-call-stack';
import { getOpenWaits } from '../lib/workflow-run-waits';
import type { CallWorkflowResult, ClaimedResume, RunPass } from '../types';

import { WorkflowEventRestorer } from './workflow-event-restorer.service';
import { WorkflowRunExecutor } from './workflow-run-executor.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

/** The result of a child run, and the wait of its parent it resolves. */
type ChildResult = { wait: WaitInfo; payload: CallWorkflowResult };

/**
 * Carries the outcome of runs up their call stacks. A child run's result is
 * never handed to its parent: it is read from the child run as stored, and
 * delivered whenever the parent is suspended. A child that ends while its
 * parent is not suspended (still running, or held by another caller) is thus
 * delivered by whoever leaves the parent suspended, since every pass
 * reconciles the runs it leaves (see {@link followUps}).
 */
@Injectable()
export class WorkflowCallStackService {
  constructor(
    private readonly executor: WorkflowRunExecutor,
    private readonly workflowRunService: WorkflowRunService,
    private readonly workflowService: WorkflowService,
    private readonly eventRestorer: WorkflowEventRestorer,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Run the pass of a claimed resume, which ends its lease (see
   * {@link WorkflowRunExecutor.resume}), then reconcile the runs it leaves.
   *
   * @returns How the run's own pass ended.
   * @throws When how the pass ended could not be written (see
   * {@link WorkflowRunExecutor.resume}).
   */
  async continueResume(claim: ClaimedResume): Promise<RunPass> {
    const pass = await this.executor.resume(claim);
    await this.reconcile(followUps(claim.run, pass), claim.event);

    return pass;
  }

  /**
   * Deliver to each of these runs, while it is suspended, the results of
   * its child runs that ended, one at a time: each resume can suspend the
   * run again, on further results, or end it, whose own result goes to its
   * parent in turn. A run that cannot be resumed is logged and left as it
   * is; the others go on, so this never rejects.
   *
   * @param runIds - Runs to reconcile; `null` entries are skipped.
   * @param event - Trigger event the runs are resumed with; rebuilt from
   * the first run resumed when none is given. A run whose trigger cannot be
   * rebuilt gets its results on its next event or suspension.
   */
  async reconcile(
    runIds: (string | null)[],
    event?: TriggerEventWrapper,
  ): Promise<void> {
    const queue = [...runIds];
    let trigger = event;
    while (queue.length > 0) {
      const runId = queue.shift();
      if (!runId) {
        continue;
      }

      try {
        const run = await this.workflowRunService.findOneAndPopulate(runId);
        // A run not suspended is reconciled by whoever leaves it suspended.
        const result =
          run?.status === 'suspended'
            ? await this.findEndedChild(run)
            : undefined;
        if (!run || !result) {
          continue;
        }

        trigger ??= await this.restoreTrigger(run);
        if (trigger) {
          queue.push(...(await this.deliver(run, result, trigger)));
        }
      } catch (error) {
        this.logger.error(
          'Unable to deliver a child result to a workflow run',
          error,
          { runId },
        );
      }
    }
  }

  /**
   * Find the first open wait of a suspended run on a child run that ended,
   * in flow order. A child run that no longer exists, e.g. deleted along
   * with its workflow, will never end: it fails the call instead.
   */
  private async findEndedChild(
    run: WorkflowRunFull,
  ): Promise<ChildResult | undefined> {
    for (const wait of getOpenWaits(run)) {
      const childRunId = getChildRunId(wait);
      if (!childRunId) {
        continue;
      }

      const childRun =
        await this.workflowRunService.findOneAndPopulate(childRunId);
      if (!childRun) {
        const workflowId = getCalledWorkflowId(wait);
        const payload = toDeletedCallWorkflowResult(
          wait,
          childRunId,
          !!workflowId && !!(await this.workflowService.findOne(workflowId)),
        );
        this.logger.warn('Failing a call to a workflow run that was deleted', {
          runId: run.id,
          childRunId,
          error: payload.error,
        });

        return { wait, payload };
      }

      if (
        resolveRunId(childRun.parentRun) === run.id &&
        (childRun.status === 'finished' || childRun.status === 'failed')
      ) {
        return { wait, payload: toEndedCallWorkflowResult(childRun) };
      }
    }

    return undefined;
  }

  /**
   * Resume a suspended run with the result of one of its child runs.
   *
   * @returns The runs to reconcile next.
   */
  private async deliver(
    run: WorkflowRunFull,
    { wait, payload }: ChildResult,
    event: TriggerEventWrapper,
  ): Promise<(string | null)[]> {
    this.logger.log('Resuming a workflow run with the result of its child', {
      runId: run.id,
      childRunId: payload.workflow_run_id,
    });
    const claim = await this.executor.claimResume({
      run,
      event,
      selectWait: (waits) => waits.find(({ waitId }) => waitId === wait.waitId),
      resumeData: payload,
    });
    switch (claim.status) {
      case 'claimed': {
        const pass = await this.executor.resume(claim);

        return pass.status === 'rejected'
          ? await this.failRefusingRun(run, pass.error)
          : followUps(run, pass);
      }
      case 'rejected':
        return await this.failRefusingRun(run, claim.error);
      case 'unresumable':
        return [resolveRunId(run.parentRun)];
      default:
        // The run was claimed by another caller, which reconciles it.
        return [];
    }
  }

  /**
   * Fail a run that refused the result of its child: the result cannot be
   * sent again, so the run could never leave that wait.
   *
   * @returns The runs to reconcile next.
   */
  private async failRefusingRun(
    run: WorkflowRunFull,
    error: WorkflowResumeRejectedError,
  ): Promise<(string | null)[]> {
    const failed = await this.executor.failUnresumable(run, error);

    return failed.status === 'unresumable' ? [resolveRunId(run.parentRun)] : [];
  }

  /**
   * Rebuild the trigger event of a run to resume it.
   *
   * @returns The event, or `undefined` when it cannot be rebuilt (logged).
   */
  private async restoreTrigger(
    run: WorkflowRunFull,
  ): Promise<TriggerEventWrapper | undefined> {
    try {
      return await this.eventRestorer.restore(run);
    } catch (error) {
      this.logger.warn(
        'Unable to rebuild the trigger of a workflow run; it gets the results of its child runs on its next event',
        { runId: run.id, error: stringifyError(error) },
      );

      return undefined;
    }
  }
}

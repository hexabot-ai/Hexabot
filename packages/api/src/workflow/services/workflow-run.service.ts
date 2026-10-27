/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  type StepExecutionRecord,
  type WorkflowCheckpoint,
  type WorkflowRunner,
  type WorkflowRunResult,
  type WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import {
  Workflow,
  WorkflowFull,
  WorkflowRun,
  WorkflowRunFull,
} from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FindManyOptions, FindOptionsWhere, In, IsNull, Not } from 'typeorm';

import { BaseOrmService } from '@/utils/generics/base-orm.service';
import { stringifyError } from '@/utils/helpers/misc';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import { resolveRunId } from '../lib/workflow-call-stack';
import {
  cancelOpenWaits,
  getOpenWaits,
  hasOperatorWait,
  isBlockedOnOperator,
} from '../lib/workflow-run-waits';
import { WorkflowRunRepository } from '../repositories/workflow-run.repository';

/** Run state persisted when a runner pass ends. */
type RunStateUpdate = {
  snapshot?: WorkflowSnapshot | null;
  context?: Record<string, unknown> | null;
  stepLog?: Record<string, StepExecutionRecord> | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
};

const ACTIVE_WORKFLOW_RUN_STATUSES = [
  EWorkflowRunStatus.IDLE,
  EWorkflowRunStatus.RUNNING,
  EWorkflowRunStatus.SUSPENDED,
];
const MAX_CALL_STACK_DEPTH = 10;

@Injectable()
export class WorkflowRunService extends BaseOrmService<WorkflowRunOrmEntity> {
  /**
   * Creates the service with the underlying repository injected.
   *
   * @param repository - ORM repository used to persist workflow run entities.
   */
  constructor(readonly repository: WorkflowRunRepository) {
    super(repository);
  }

  /**
   * Create a run of a workflow for an event and load it with relations.
   *
   * Child calls inherit the same event metadata, initiator, and thread as the
   * parent, but store an explicit `parentRun` relation so future events can
   * resume the deepest suspended child before returning to the parent.
   *
   * @param workflow - Workflow to run, with its current version.
   * @param event - Event that triggers the run.
   * @param options.parentRun - Calling run, when the run is a child workflow call.
   * @param options.input - Start input override for child calls.
   * @returns The created run populated with relations.
   */
  async createFromEvent(
    workflow: WorkflowFull,
    event: TriggerEventWrapper,
    options: {
      parentRun?: WorkflowRunFull;
      input?: Record<string, unknown>;
    } = {},
  ): Promise<WorkflowRunFull> {
    const initiator = event.getInitiator();
    if (!workflow.definition) {
      throw new Error('Workflow definition is required to create a run');
    }
    const initialContext = {
      ...(workflow.definition.context ?? {}),
      ...event.getContextData(),
    };
    const run = await this.create({
      workflow: workflow.id,
      workflowVersion: workflow.currentVersion?.id ?? null,
      triggeredBy: initiator.id,
      thread: event.getThreadId() ?? null,
      parentRun: options.parentRun?.id ?? null,
      input: options.input ?? event.buildInput(),
      context: Object.keys(initialContext).length > 0 ? initialContext : null,
      metadata: event.getMetadata(),
    });
    const populated = await this.findOneAndPopulate(run.id);

    if (!populated) {
      throw new Error(`Unable to load workflow run ${run.id}`);
    }

    return populated;
  }

  /**
   * Mark a run as running and persist the context it runs with.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Hydrated context state of the run.
   * @returns Updated workflow run marked as `running`.
   */
  async markRunning(
    runId: string,
    payload: { context?: Record<string, unknown> | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'running',
      ...payload,
    });
  }

  /**
   * Claim a suspended run before resuming it. Only one caller wins a given
   * suspension; see {@link WorkflowRunRepository.claimSuspended}.
   *
   * @param runId - Identifier of the run to claim.
   * @param suspendedAt - Suspension timestamp of the run as it was loaded.
   * @returns `true` when the run was claimed and is now `running`.
   */
  async claimSuspended(
    runId: string,
    suspendedAt: Date | null,
  ): Promise<boolean> {
    return await this.repository.claimSuspended(runId, suspendedAt);
  }

  /**
   * Put a claimed run back to `suspended` after its resume payload was
   * refused. The checkpoint and `suspendedAt` are left unchanged, so the run
   * stays on the same suspension.
   *
   * @param runId - Identifier of the run to release.
   * @param payload - Context state the run had before it was claimed.
   * @returns Updated workflow run marked as `suspended`.
   */
  async releaseClaim(
    runId: string,
    payload: { context?: Record<string, unknown> | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'suspended',
      ...payload,
    });
  }

  /**
   * Mark a run as suspended and persist its checkpoint.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Checkpoint to resume from, and the run state.
   * @returns Updated workflow run marked as `suspended`.
   */
  async markSuspended(
    runId: string,
    payload: { checkpoint: WorkflowCheckpoint } & RunStateUpdate,
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'suspended',
      suspendedAt: new Date(),
      awaitingOperator: hasOperatorWait(payload.checkpoint.waits),
      ...payload,
    });
  }

  /**
   * Mark a run as finished and store final state/output.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Final state changes and optional output payload.
   * @returns Updated workflow run marked as `finished`.
   */
  async markFinished(
    runId: string,
    payload: RunStateUpdate,
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'finished',
      checkpoint: null,
      awaitingOperator: false,
      finishedAt: new Date(),
      ...payload,
    });
  }

  /**
   * Mark a run as failed and persist the failure reason and state.
   *
   * @param runId - Identifier of the run to update.
   * @param payload - Optional error message and state changes.
   * @returns Updated workflow run marked as `failed`.
   */
  async markFailed(
    runId: string,
    payload: RunStateUpdate & { error?: string | null },
  ): Promise<WorkflowRun> {
    return await this.updateOne(runId, {
      status: 'failed',
      checkpoint: null,
      awaitingOperator: false,
      failedAt: new Date(),
      ...payload,
    });
  }

  /**
   * Persist the outcome of a runner pass and the run state it left.
   *
   * @param run - Run the runner went through.
   * @param runner - Runner of the pass.
   * @param result - Outcome of the pass.
   * @param contextState - Context state the run was left with.
   */
  async persistResult(
    run: WorkflowRunFull,
    runner: WorkflowRunner,
    result: WorkflowRunResult,
    contextState: Record<string, unknown> | null,
  ): Promise<void> {
    const state = runner.getState();
    const runState = {
      snapshot: result.snapshot,
      context: contextState,
      stepLog: this.buildStepLog(runner, run.stepLog),
      input: state?.input ?? run.input ?? {},
    };
    this.logger.debug('Persisting workflow result', {
      runId: run.id,
      status: result.status,
    });

    switch (result.status) {
      case 'suspended':
        this.logger.log('Workflow run suspended', {
          runId: run.id,
          waits: result.waits.map(({ waitId, reason }) => ({
            waitId,
            reason,
          })),
        });
        await this.markSuspended(run.id, {
          ...runState,
          checkpoint: result.checkpoint,
          output: result.checkpoint.output,
        });
        break;
      case 'finished':
        this.logger.log('Workflow run finished', {
          runId: run.id,
        });
        await this.markFinished(run.id, {
          ...runState,
          output: result.output,
        });
        break;
      case 'failed':
      default:
        this.logger.error('Workflow runner reported failure status', {
          runId: run.id,
          error: stringifyError(result.error),
        });
        await this.markFailed(run.id, {
          ...runState,
          output: state?.output ?? run.output ?? null,
          error: stringifyError(result.error),
        });
        break;
    }
  }

  /**
   * Persist a failing workflow run when runner execution throws.
   *
   * @param run - Run the runner went through.
   * @param runner - The runner that threw, if it was created at all.
   * @param contextState - Context state the run was left with.
   * @param error - Error the runner threw.
   */
  async persistCrash(
    run: WorkflowRunFull,
    runner: WorkflowRunner | undefined,
    contextState: Record<string, unknown> | null,
    error: unknown,
  ): Promise<void> {
    const state = runner?.getState();

    this.logger.error(
      'Persisting failed workflow run after runner crash',
      error,
      {
        runId: run.id,
        workflowId: run.workflow?.id,
        triggeredById: run.triggeredBy?.id ?? null,
      },
    );
    await this.markFailed(run.id, {
      ...(runner
        ? {
            snapshot: runner.getSnapshot(),
            stepLog: this.buildStepLog(runner, run.stepLog),
          }
        : {}),
      context: contextState,
      input: state?.input ?? run.input ?? {},
      output: state?.output ?? run.output ?? null,
      error: stringifyError(error),
    });
  }

  /**
   * Claim a suspended run and fail it, marking its open waits cancelled.
   *
   * Emits `hook:step:cancelled` for each step holding an open wait, then
   * `hook:workflow:failure`.
   *
   * @param run - Suspended run, as it was loaded.
   * @param message - Reason stored on the run and its cancelled steps.
   * @returns `false` when another caller claimed the suspension first.
   */
  async cancelSuspended(
    run: WorkflowRunFull,
    message: string,
  ): Promise<boolean> {
    const claimed = await this.claimSuspended(run.id, run.suspendedAt ?? null);
    if (!claimed) {
      return false;
    }

    const waits = getOpenWaits(run);
    const { snapshot, stepLog } = cancelOpenWaits(run, message);
    this.logger.log('Cancelling suspended workflow run', {
      runId: run.id,
      waitIds: waits.map((wait) => wait.waitId),
    });
    await this.markFailed(run.id, {
      snapshot,
      stepLog,
      error: message,
    });

    const error = new Error(message);
    for (const wait of waits) {
      this.eventEmitter.emit('hook:step:cancelled', {
        runId: run.id,
        step: wait.step,
        stepExecution: stepLog?.[wait.step.id],
        error,
        wait,
      });
    }
    this.eventEmitter.emit('hook:workflow:failure', { runId: run.id, error });

    return true;
  }

  /**
   * Cancel the suspended runs called, directly or not, by a cancelled run.
   * Children still running are left alone: once they end, they find their
   * parent failed and do not resume it.
   *
   * @param rootRunId - Identifier of the cancelled run.
   * @param message - Reason stored on the cancelled runs.
   */
  async cancelSuspendedDescendants(
    rootRunId: string,
    message: string,
  ): Promise<void> {
    const queue = [rootRunId];
    const visited = new Set(queue);

    while (queue.length > 0) {
      const parentRunId = queue.shift()!;
      const children = await this.findAndPopulate({
        where: {
          parentRun: { id: parentRunId },
          status: In(ACTIVE_WORKFLOW_RUN_STATUSES),
        },
      });

      for (const child of children) {
        if (visited.has(child.id)) {
          continue;
        }
        visited.add(child.id);

        if (
          child.status === 'suspended' &&
          (await this.cancelSuspended(child, message))
        ) {
          queue.push(child.id);
          continue;
        }

        this.logger.warn('Leaving an active child of a cancelled run alone', {
          runId: child.id,
          parentRunId,
          status: child.status,
        });
      }
    }
  }

  /**
   * Settle the call stacks around a workflow about to be deleted, since its
   * runs are deleted with it.
   *
   * The suspended runs its runs called are cancelled, along with their own
   * suspended descendants: nothing would ever take their result. The runs
   * that called its runs are left waiting; once the workflow is gone,
   * `AgenticService.resumeFromEndedChildren` sends them a failed result.
   *
   * @param workflow - Workflow about to be deleted.
   * @returns Ids of the runs that called an active run of the workflow.
   */
  async prepareWorkflowDeletion(
    workflow: Pick<Workflow, 'id' | 'name'>,
  ): Promise<string[]> {
    const message = `Workflow "${workflow.name}" was deleted`;
    const calledRuns = await this.findAndPopulate({
      where: {
        parentRun: { workflow: { id: workflow.id } },
        status: In(ACTIVE_WORKFLOW_RUN_STATUSES),
      },
    });
    for (const run of calledRuns) {
      if (
        run.status === 'suspended' &&
        (await this.cancelSuspended(run, message))
      ) {
        await this.cancelSuspendedDescendants(run.id, message);
      }
    }

    const callingRuns = await this.find({
      where: {
        workflow: { id: workflow.id },
        parentRun: { id: Not(IsNull()) },
        status: In(ACTIVE_WORKFLOW_RUN_STATUSES),
      },
    });

    return [
      ...new Set(
        callingRuns
          .map((run) => resolveRunId(run.parentRun))
          .filter((id): id is string => !!id),
      ),
    ];
  }

  /**
   * Validate that a workflow call does not create a recursive or overly deep stack.
   *
   * The walk follows active parent links, so only the current call stack is
   * rejected; a workflow can still be called again after an earlier stack has
   * completed.
   *
   * @param parentRun - Run issuing the call.
   * @param targetWorkflowId - Identifier of the called workflow.
   * @throws When the workflow is already in the call stack, or the stack would
   * get too deep.
   */
  async assertCanCallWorkflow(
    parentRun: WorkflowRunFull,
    targetWorkflowId: string,
  ): Promise<void> {
    let current: WorkflowRunFull | null = parentRun;
    let depth = 0;

    while (current) {
      depth += 1;
      if (depth >= MAX_CALL_STACK_DEPTH) {
        throw new Error(
          `Workflow call stack depth cannot exceed ${MAX_CALL_STACK_DEPTH}`,
        );
      }

      if (current.workflow.id === targetWorkflowId) {
        throw new Error(
          `Workflow call cycle detected for workflow ${targetWorkflowId}`,
        );
      }

      const parentRunId = resolveRunId(current.parentRun);
      current = parentRunId ? await this.findOneAndPopulate(parentRunId) : null;
    }
  }

  /**
   * Find the suspended run that should receive the next event.
   *
   * For call-and-return stacks, the parent can be suspended while the child is
   * either running or suspended for the same initiator/thread. The next external
   * event must resume the deepest suspended leaf first; once that child
   * completes, AgenticService resumes its parent internally with the child
   * result.
   *
   * @param triggeredById - Identifier of the subscriber whose suspended run should be fetched.
   * @param threadId - Optional thread id for conversational continuity.
   * @param workflowId - Optional workflow id; a parent match still resolves to its child leaf.
   * @param options.skipBlockedOnOperator - Leave out leaves that only an
   * admin can resume (see {@link isBlockedOnOperator}), so the event starts a
   * new run instead of being absorbed by them.
   * @returns The suspended leaf run populated with relations, or `null` when none exists.
   */
  async findSuspendedRunByInitiator(
    triggeredById: string,
    threadId?: string,
    workflowId?: string,
    options: { skipBlockedOnOperator?: boolean } = {},
  ): Promise<WorkflowRunFull | null> {
    const runs = await this.findAndPopulate({
      where: {
        triggeredBy: { id: triggeredById },
        ...(threadId ? { thread: { id: threadId } } : {}),
        status: In(ACTIVE_WORKFLOW_RUN_STATUSES),
      },
      order: { suspendedAt: 'DESC', createdAt: 'DESC' },
    });

    if (runs.length === 0) {
      return null;
    }

    const runsById = new Map(runs.map((run) => [run.id, run]));
    const parentRunIds = new Set(
      runs
        .map((run) => resolveRunId(run.parentRun))
        .filter((value): value is string => typeof value === 'string'),
    );
    // Leaves are active runs that are not the parent of another unfinished
    // candidate. Only suspended leaves can consume external events; running or
    // idle leaves are still in flight and block their suspended ancestors.
    const leaves = runs.filter((run) => !parentRunIds.has(run.id));
    const candidates = (leaves.length > 0 ? leaves : runs)
      .filter((run) => run.status === EWorkflowRunStatus.SUSPENDED)
      .filter((run) =>
        workflowId
          ? this.isRunInWorkflowStack(run, workflowId, runsById)
          : true,
      )
      .filter(
        (run) => !options.skipBlockedOnOperator || !isBlockedOnOperator(run),
      );

    return this.pickDeepestSuspendedRun(candidates, runsById);
  }

  /**
   * Narrow find options to the runs waiting on an admin: suspended runs
   * whose checkpoint holds an open operator wait. The scope wins over the
   * caller's filters on the same fields.
   *
   * @param options - Find options built from the request filters.
   * @returns The same options, scoped to runs waiting on an admin.
   */
  withAwaitingOperatorScope(
    options: FindManyOptions<WorkflowRunOrmEntity> = {},
  ): FindManyOptions<WorkflowRunOrmEntity> {
    const scope: FindOptionsWhere<WorkflowRunOrmEntity> = {
      status: EWorkflowRunStatus.SUSPENDED,
      awaitingOperator: true,
    };
    const { where } = options;

    return {
      ...options,
      where: Array.isArray(where)
        ? where.map((clause) => ({ ...clause, ...scope }))
        : { ...(where ?? {}), ...scope },
    };
  }

  /**
   * Merge persisted step log entries with the latest runner log.
   */
  private buildStepLog(
    runner: WorkflowRunner,
    existing?: Record<string, StepExecutionRecord> | null,
  ): Record<string, StepExecutionRecord> | null {
    const merged = { ...(existing ?? {}), ...runner.getStepLog() };

    return Object.keys(merged).length > 0 ? merged : null;
  }

  private isRunInWorkflowStack(
    run: WorkflowRunFull,
    workflowId: string,
    runsById: Map<string, WorkflowRunFull>,
  ): boolean {
    let current: WorkflowRunFull | undefined = run;
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.workflow.id === workflowId) {
        return true;
      }
      const parentRunId = resolveRunId(current.parentRun);
      current = parentRunId ? runsById.get(parentRunId) : undefined;
    }

    return false;
  }

  private pickDeepestSuspendedRun(
    runs: WorkflowRunFull[],
    runsById: Map<string, WorkflowRunFull>,
  ): WorkflowRunFull | null {
    if (runs.length === 0) {
      return null;
    }

    const getDepth = (run: WorkflowRunFull): number => {
      let depth = 0;
      let current: WorkflowRunFull | undefined = run;
      const visited = new Set<string>();

      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        depth += 1;
        const parentRunId = resolveRunId(current.parentRun);
        current = parentRunId ? runsById.get(parentRunId) : undefined;
      }

      return depth;
    };
    const getTime = (value?: Date | string | null): number => {
      if (!value) {
        return 0;
      }

      const date = value instanceof Date ? value : new Date(value);
      const timestamp = date.getTime();

      return Number.isNaN(timestamp) ? 0 : timestamp;
    };

    return [...runs].sort((a, b) => {
      const depthDiff = getDepth(b) - getDepth(a);
      if (depthDiff !== 0) {
        return depthDiff;
      }

      return (
        getTime(b.suspendedAt) - getTime(a.suspendedAt) ||
        getTime(b.createdAt) - getTime(a.createdAt)
      );
    })[0];
  }

  /**
   * Fail all active runs linked to a thread, once it is closed.
   *
   * Suspended runs are cancelled as an admin would cancel them (see
   * {@link cancelSuspended}); a run another caller claimed first is left
   * alone. Child runs share the thread of their caller, so the whole call
   * stack is cancelled here and no parent is resumed. Idle and running runs
   * are only marked failed.
   *
   * @param threadId - The ID of the closed thread.
   */
  async abortActiveRunsForThread(threadId: string): Promise<void> {
    const message = 'Thread was closed';
    const activeRuns = await this.findAndPopulate({
      where: {
        thread: { id: threadId },
        status: In(ACTIVE_WORKFLOW_RUN_STATUSES),
      },
    });

    for (const run of activeRuns) {
      if (run.status !== EWorkflowRunStatus.SUSPENDED) {
        await this.markFailed(run.id, { error: message });
        continue;
      }

      if (!(await this.cancelSuspended(run, message))) {
        this.logger.warn(
          'Leaving a run of a closed thread another caller claimed first',
          { runId: run.id, threadId },
        );
      }
    }
  }

  /**
   * Abort all active workflow runs linked to a thread when that thread is closed.
   *
   * @param event - Update event of the thread.
   */
  @OnEvent('hook:thread:postUpdate')
  async handleThreadClosed({
    entity,
    databaseEntity,
  }: {
    entity: { id: string; status: string };
    databaseEntity: { id: string; status: string };
  }): Promise<void> {
    if (entity.status === 'closed' && databaseEntity.status !== 'closed') {
      await this.abortActiveRunsForThread(entity.id);
    }
  }
}

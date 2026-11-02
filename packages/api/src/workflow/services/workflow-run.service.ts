/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  EWorkflowRunStatus,
  type StepExecutionRecord,
  type WorkflowRunner,
  type WorkflowRunResult,
} from '@hexabot-ai/agentic';
import { Workflow, WorkflowFull, WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FindManyOptions, FindOptionsWhere, In, IsNull, Not } from 'typeorm';

import { config } from '@/config';
import { BaseOrmService } from '@/utils/generics/base-orm.service';
import { stringifyError } from '@/utils/helpers/misc';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import {
  failedValues,
  finishedValues,
  RunLease,
  suspendedValues,
} from '../lib/run-lease';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import {
  getWaitedOnChildRunIds,
  resolveRunId,
} from '../lib/workflow-call-stack';
import {
  cancelOpenWaits,
  getOpenWaits,
  isBlockedOnOperator,
  isEventWait,
} from '../lib/workflow-run-waits';
import { WorkflowRunRepository } from '../repositories/workflow-run.repository';
import {
  ACTIVE_WORKFLOW_RUN_STATUSES,
  CLAIMED_WORKFLOW_RUN_STATUSES,
  ExpiredClaim,
  RunClaim,
} from '../types';

const MAX_CALL_STACK_DEPTH = 10;
/**
 * Reason stored on a run cancelled because its caller no longer waits on it
 * (see {@link WorkflowRunService.cancelAbandonedRuns}).
 */
const abandonedRunMessage = (parentRunId: string): string =>
  `Calling workflow run ${parentRunId} no longer waits on this run`;

@Injectable()
export class WorkflowRunService extends BaseOrmService<WorkflowRunOrmEntity> {
  /**
   * Leases held in this process, by claim token. Their claims are renewed
   * until they end; the claims of a process that stopped lapse, and their
   * runs are recovered.
   */
  private readonly leases = new Map<string, RunLease>();

  /**
   * Creates the service with the underlying repository injected.
   *
   * @param repository - ORM repository used to persist workflow run entities.
   */
  constructor(readonly repository: WorkflowRunRepository) {
    super(repository);
  }

  /**
   * Create a run of a workflow for an event and load it with relations. The
   * run is created `idle` under a claim, whose lease the caller hands to the
   * run's first pass.
   *
   * Child calls inherit the same event metadata, initiator, and thread as the
   * parent, but store an explicit `parentRun` relation so future events can
   * resume the deepest suspended child before returning to the parent. The
   * parent's id is also stored in `callerRunId`, which deleting the parent
   * does not clear (see {@link cancelAbandonedRuns}).
   *
   * @param workflow - Workflow to run, with its current version.
   * @param event - Event that triggers the run.
   * @param options.parentRun - Calling run, when the run is a child workflow call.
   * @param options.input - Start input override for child calls.
   * @returns The created run populated with relations, and the lease on it.
   */
  async createFromEvent(
    workflow: WorkflowFull,
    event: TriggerEventWrapper,
    options: {
      parentRun?: WorkflowRunFull;
      input?: Record<string, unknown>;
    } = {},
  ): Promise<{ run: WorkflowRunFull; lease: RunLease }> {
    const initiator = event.getInitiator();
    if (!workflow.definition) {
      throw new Error('Workflow definition is required to create a run');
    }
    const initialContext = {
      ...(workflow.definition.context ?? {}),
      ...event.getContextData(),
    };
    const claim = this.newClaim();
    const run = await this.repository.createClaimed(
      {
        workflow: workflow.id,
        workflowVersion: workflow.currentVersion?.id ?? null,
        triggeredBy: initiator.id,
        thread: event.getThreadId() ?? null,
        parentRun: options.parentRun?.id ?? null,
        callerRunId: options.parentRun?.id ?? null,
        input: options.input ?? event.buildInput(),
        context: Object.keys(initialContext).length > 0 ? initialContext : null,
        metadata: event.getMetadata(),
      },
      claim,
    );
    const populated = await this.findOneAndPopulate(run.id);

    if (!populated) {
      throw new Error(`Unable to load workflow run ${run.id}`);
    }

    // Held only once handed over: a run that cannot be loaded is left to
    // lapse, and recovery fails it.
    return { run: populated, lease: this.hold(run.id, claim) };
  }

  /**
   * Load the latest persisted state of a run, with relations.
   *
   * @returns The run as stored, or `run` itself when it no longer exists.
   */
  async reload(run: WorkflowRunFull): Promise<WorkflowRunFull> {
    return (await this.findOneAndPopulate(run.id)) ?? run;
  }

  /**
   * Claim a suspended run before resuming it. Only one caller wins a given
   * suspension; see {@link WorkflowRunRepository.claimSuspended}.
   *
   * @param runId - Identifier of the run to claim.
   * @param suspendedAt - Suspension timestamp of the run as it was loaded.
   * @returns The lease on the run, now `running`, or `null` when another
   * caller claimed the suspension first.
   */
  async claimSuspended(
    runId: string,
    suspendedAt: Date | null,
  ): Promise<RunLease | null> {
    const claim = this.newClaim();

    return (await this.repository.claimSuspended(runId, suspendedAt, claim))
      ? this.hold(runId, claim)
      : null;
  }

  /**
   * Persist the outcome of a runner pass and the run state it left, and
   * give the claim back.
   *
   * @param run - Run the runner went through.
   * @param runner - Runner of the pass.
   * @param result - Outcome of the pass.
   * @param contextState - Context state the run was left with.
   * @param lease - Lease the pass ran under.
   * @returns `false` when the run was settled by another caller while the
   * pass ran; the outcome of the pass is then dropped.
   */
  async persistResult(
    run: WorkflowRunFull,
    runner: WorkflowRunner,
    result: WorkflowRunResult,
    contextState: Record<string, unknown> | null,
    lease: RunLease,
  ): Promise<boolean> {
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

    let settled: boolean;
    switch (result.status) {
      case 'suspended':
        this.logger.log('Workflow run suspended', {
          runId: run.id,
          waits: result.waits.map(({ waitId, reason }) => ({
            waitId,
            reason,
          })),
        });
        settled = await lease.settle(
          suspendedValues({
            ...runState,
            checkpoint: result.checkpoint,
            output: result.checkpoint.output,
          }),
        );
        break;
      case 'finished':
        this.logger.log('Workflow run finished', {
          runId: run.id,
        });
        settled = await lease.settle(
          finishedValues({ ...runState, output: result.output }),
        );
        break;
      case 'failed':
      default:
        this.logger.error('Workflow runner reported failure status', {
          runId: run.id,
          error: stringifyError(result.error),
        });
        settled = await lease.settle(
          failedValues({
            ...runState,
            output: state?.output ?? run.output ?? null,
            error: stringifyError(result.error),
          }),
        );
        break;
    }

    if (!settled) {
      this.warnClaimLost(run.id, result.status);
    }

    return settled;
  }

  /**
   * Persist a failing workflow run when runner execution throws.
   *
   * @param run - Run the runner went through.
   * @param runner - The runner that threw, if it was created at all.
   * @param contextState - Context state the run was left with; `undefined`
   * leaves the stored context as it is.
   * @param error - Error the runner threw.
   * @param lease - Lease the pass ran under.
   * @returns `false` when the run was settled by another caller while the
   * pass ran.
   */
  async persistCrash(
    run: WorkflowRunFull,
    runner: WorkflowRunner | undefined,
    contextState: Record<string, unknown> | null | undefined,
    error: unknown,
    lease: RunLease,
  ): Promise<boolean> {
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
    const settled = await lease.settle(
      failedValues({
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
      }),
    );
    if (!settled) {
      this.warnClaimLost(run.id, 'failed');
    }

    return settled;
  }

  /**
   * Tell whether this process holds a claim.
   *
   * @param claimId - Token of the claim.
   */
  holdsClaim(claimId: string): boolean {
    return this.leases.has(claimId);
  }

  /**
   * Push back the lapse of the claims held in this process.
   *
   * @returns The number of claims renewed.
   */
  async renewHeldClaims(): Promise<number> {
    if (this.leases.size === 0) {
      return 0;
    }

    return await this.repository.renewClaims(
      [...this.leases.values()],
      this.claimExpiry(),
    );
  }

  /**
   * Find the active runs whose claim lapsed: the process that held them
   * stopped, or could not renew their claim for a whole TTL.
   *
   * @param now - Claims lapsed before this time are returned.
   */
  async findExpiredClaims(now: Date): Promise<ExpiredClaim[]> {
    return await this.repository.findExpiredClaims(now);
  }

  /**
   * Put a run whose resume died back on the suspension it was claimed from.
   * The claim wrote only the status, so the checkpoint, `suspendedAt`,
   * `awaitingOperator`, snapshot, step log and context are as they were
   * before it: the run waits on the same open waits.
   *
   * @param expired - The run and its lapsed claim.
   * @param now - Time the claim was found lapsed at.
   * @returns `false` when the run was settled or its claim renewed meanwhile.
   */
  async putBackExpired(expired: ExpiredClaim, now: Date): Promise<boolean> {
    return await this.repository.recoverExpired(
      expired.id,
      expired.claimId,
      now,
      {
        status: EWorkflowRunStatus.SUSPENDED,
        recoveryCount: expired.recoveryCount + 1,
      },
    );
  }

  /**
   * Fail a run whose claim lapsed.
   *
   * @param expired - The run and its lapsed claim.
   * @param now - Time the claim was found lapsed at.
   * @param error - Failure reason stored on the run.
   * @returns `false` when the run was settled or its claim renewed meanwhile.
   */
  async failExpired(
    expired: ExpiredClaim,
    now: Date,
    error: string,
  ): Promise<boolean> {
    return await this.repository.recoverExpired(
      expired.id,
      expired.claimId,
      now,
      {
        status: EWorkflowRunStatus.FAILED,
        error,
        failedAt: now,
        checkpoint: null,
        awaitingOperator: false,
      },
    );
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
    const lease = await this.claimSuspended(run.id, run.suspendedAt ?? null);
    if (!lease) {
      return false;
    }

    const waits = getOpenWaits(run);
    const { snapshot, stepLog } = cancelOpenWaits(run, message);
    this.logger.log('Cancelling suspended workflow run', {
      runId: run.id,
      waitIds: waits.map((wait) => wait.waitId),
    });
    const settled = await lease.settle(
      failedValues({ snapshot, stepLog, error: message }),
    );
    if (!settled) {
      return false;
    }

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
   * Cancel a suspended run (see {@link cancelSuspended}), then its suspended
   * descendants (see {@link cancelSuspendedDescendants}).
   *
   * @returns `false` when another caller claimed the run first; its
   * descendants are then left alone.
   */
  async cancelSuspendedWithDescendants(
    run: WorkflowRunFull,
    message: string,
  ): Promise<boolean> {
    if (!(await this.cancelSuspended(run, message))) {
      return false;
    }

    await this.cancelSuspendedDescendants(run.id, message);

    return true;
  }

  /**
   * Cancel the suspended runs around a run that nothing waits on any more,
   * each along with its suspended descendants: the run itself when its
   * caller ended, was deleted or no longer waits on it, otherwise its
   * children that none of its open waits names, which is all of them once it
   * ended. A `wait_any` branch that lost the race, for example, drops its
   * wait on the run it called. Such runs could never deliver their result,
   * yet an admin could still resolve them and they would receive the next
   * events of their conversation.
   *
   * A run in a pass is left alone, and so are its children: it is
   * reconciled once its pass is over. A child in a pass is checked once it
   * suspends. Each side writes its own status before reading the other's,
   * so at least one of them sees the other.
   *
   * @param runId - Identifier of the run.
   * @returns The run as stored, or `null` when it no longer exists, or when
   * nothing waits on it any more (it was cancelled, or another caller
   * claimed it first).
   */
  async cancelAbandonedRuns(runId: string): Promise<WorkflowRunFull | null> {
    // Listed before the run is read: a run its next pass calls is then
    // never taken for one it no longer waits on.
    const children = await this.findAndPopulate({
      where: {
        parentRun: { id: runId },
        status: EWorkflowRunStatus.SUSPENDED,
      },
    });
    const run = await this.findOneAndPopulate(runId);
    if (!run || CLAIMED_WORKFLOW_RUN_STATUSES.includes(run.status)) {
      return run;
    }

    let waitedOn = new Set<string>();
    if (run.status === EWorkflowRunStatus.SUSPENDED) {
      // Deleting the caller clears `parentRun`, not `callerRunId`.
      const parentRunId = run.callerRunId ?? resolveRunId(run.parentRun);
      if (parentRunId && !(await this.isWaitedOnBy(run.id, parentRunId))) {
        await this.cancelAbandoned(run, parentRunId);

        return null;
      }

      waitedOn = getWaitedOnChildRunIds(getOpenWaits(run));
    }

    for (const child of children) {
      if (!waitedOn.has(child.id)) {
        await this.cancelAbandoned(child, runId);
      }
    }

    return run;
  }

  /**
   * Cancel a suspended run its caller no longer waits on, with its suspended
   * descendants. A failure is only logged, so that the results the caller
   * does wait on are still delivered; the run is cancelled on a later
   * reconcile.
   */
  private async cancelAbandoned(
    run: WorkflowRunFull,
    parentRunId: string,
  ): Promise<void> {
    const details = { runId: run.id, parentRunId };
    this.logger.warn('Cancelling a run its caller no longer waits on', details);
    try {
      await this.cancelSuspendedWithDescendants(
        run,
        abandonedRunMessage(parentRunId),
      );
    } catch (error) {
      this.logger.error(
        'Unable to cancel a run its caller no longer waits on',
        error,
        details,
      );
    }
  }

  /**
   * Tell whether a run may still deliver its result to its caller: the
   * caller is in a pass, or suspended on a wait for it.
   *
   * @param runId - Identifier of the called run.
   * @param parentRunId - Identifier of its caller.
   */
  private async isWaitedOnBy(
    runId: string,
    parentRunId: string,
  ): Promise<boolean> {
    const parentRun = await this.findOne(parentRunId);
    if (!parentRun) {
      return false;
    }

    if (parentRun.status === EWorkflowRunStatus.SUSPENDED) {
      return getWaitedOnChildRunIds(getOpenWaits(parentRun)).has(runId);
    }

    return CLAIMED_WORKFLOW_RUN_STATUSES.includes(parentRun.status);
  }

  /**
   * Settle the call stacks around a workflow about to be deleted, since its
   * runs are deleted with it.
   *
   * The suspended runs its runs called are cancelled, along with their own
   * suspended descendants: nothing would ever take their result. The ones
   * still in a pass lose their `parentRun` with the deletion but keep their
   * `callerRunId`, so `cancelAbandonedRuns` cancels them once they suspend.
   * The runs that called its runs are left waiting; once the workflow is
   * gone, `WorkflowCallStackService.reconcile` sends them a failed result.
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
      if (run.status === 'suspended') {
        await this.cancelSuspendedWithDescendants(run, message);
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
   * The event goes to the deepest suspended run with a wait it can resolve
   * (see {@link isEventWait}), wherever it sits in its call stack. A child
   * asking the user is thus answered before its parent, and once it
   * completes, WorkflowCallStackService resumes its parent with its result.
   * A parent can also wait on the event itself, alongside its call to a child
   * (`parallel`): it then gets the event while that child waits on an admin,
   * or is still in a pass.
   *
   * When no run can resolve the event, the deepest suspended leaf gets it, so
   * the caller holds the event there (a run waiting on an admin) or catches up
   * on child results it missed. A run that is not the parent of another active
   * run is a leaf; a running or idle leaf is still in flight and blocks its
   * suspended ancestors.
   *
   * @param triggeredById - Identifier of the subscriber whose suspended run should be fetched.
   * @param threadId - Optional thread id for conversational continuity.
   * @param workflowId - Optional workflow id; runs of a stack this workflow
   * is part of, below or above it, still match.
   * @param options.skipBlockedOnOperator - Leave out leaves that only an
   * admin can resume (see {@link isBlockedOnOperator}), so the event starts a
   * new run instead of being absorbed by them.
   * @returns The suspended run populated with relations, or `null` when none exists.
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
    const isCandidate = (run: WorkflowRunFull) =>
      run.status === EWorkflowRunStatus.SUSPENDED &&
      (!workflowId || this.isRunInWorkflowStack(run, workflowId, runsById));
    const awaitingEvent = runs.filter(
      (run) => isCandidate(run) && getOpenWaits(run).some(isEventWait),
    );
    if (awaitingEvent.length > 0) {
      return this.pickDeepestSuspendedRun(awaitingEvent, runsById);
    }

    const parentRunIds = new Set(
      runs
        .map((run) => resolveRunId(run.parentRun))
        .filter((value): value is string => typeof value === 'string'),
    );
    const leaves = runs.filter((run) => !parentRunIds.has(run.id));
    const candidates = (leaves.length > 0 ? leaves : runs)
      .filter(isCandidate)
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
   * Build a new claim, lapsing one TTL from now unless it is renewed.
   */
  private newClaim(): RunClaim {
    return { claimId: randomUUID(), expiresAt: this.claimExpiry() };
  }

  /**
   * Hold a claim this process just took: it is renewed until its lease
   * ends.
   */
  private hold(runId: string, claim: RunClaim): RunLease {
    const lease = new RunLease(runId, claim.claimId, this.repository, (ended) =>
      this.leases.delete(ended.claimId),
    );
    this.leases.set(lease.claimId, lease);

    return lease;
  }

  private claimExpiry(): Date {
    return new Date(Date.now() + config.workflow.runClaimTtl);
  }

  /**
   * Report a pass whose outcome is dropped because its run was settled by
   * another caller while it ran.
   */
  private warnClaimLost(runId: string, status: string): void {
    this.logger.warn(
      'Dropping the outcome of a workflow run pass: the run was taken over or recovered while it ran',
      { runId, status },
    );
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
   * {@link cancelSuspended}). Idle and running runs are only marked failed,
   * taken over from the pass running them: that pass then cannot write its
   * outcome over the failure. A run whose status changed since it was loaded
   * (claimed, recovered) is handled once more from its new status. Child
   * runs share the thread of their caller, so the whole call stack is
   * cancelled here and no parent is resumed.
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
      if (await this.abortActiveRun(run, message)) {
        continue;
      }

      const current = await this.findOneAndPopulate(run.id);
      if (
        current &&
        ACTIVE_WORKFLOW_RUN_STATUSES.includes(current.status) &&
        !(await this.abortActiveRun(current, message))
      ) {
        this.logger.warn(
          'Leaving a run of a closed thread whose status keeps changing',
          { runId: run.id, threadId, status: current.status },
        );
      }
    }
  }

  /**
   * Fail one active run of a closed thread, as loaded.
   *
   * @returns `false` when the run is not in the status it was loaded with.
   */
  private async abortActiveRun(
    run: WorkflowRunFull,
    message: string,
  ): Promise<boolean> {
    if (run.status === EWorkflowRunStatus.SUSPENDED) {
      return await this.cancelSuspended(run, message);
    }

    // Taken over from whoever holds it: no token, and its pass then cannot
    // write over the failure.
    return await this.repository.settle(
      run.id,
      failedValues({ error: message }),
      null,
    );
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

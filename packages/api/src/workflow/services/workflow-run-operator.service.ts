/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from '@hexabot-ai/agentic';
import {
  AWAITING_APPROVAL_REASON,
  AWAITING_RESUME_REASON,
  WorkflowRunFull,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { LoggerService } from '@/logger/logger.service';
import { DeleteEntityEvent } from '@/utils/types/entity-event.types';

import { WorkflowOrmEntity } from '../entities/workflow.entity';
import { runInBackground } from '../lib/run-in-background';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import { getOpenWaits } from '../lib/workflow-run-waits';
import {
  ApprovalDecision,
  OperatorActor,
  ResumePayload,
} from '../schemas/operator-wait-schemas';
import type { ResumeWaitOutcome } from '../types';

import { AgenticService } from './agentic.service';
import {
  WorkflowEventRestorer,
  WorkflowTriggerUnavailableError,
} from './workflow-event-restorer.service';
import { WorkflowRunService } from './workflow-run.service';

/** Error codes of the operator endpoints, sent as `code` in error bodies. */
export type WorkflowRunOperatorErrorCode =
  | 'run_not_suspended'
  | 'wait_not_found'
  | 'wait_kind_mismatch'
  | 'wait_ambiguous'
  | 'no_matching_wait'
  | 'trigger_unavailable'
  | 'claim_lost'
  | 'unresumable'
  | 'resume_unavailable'
  | 'payload_rejected';

type ExceptionClass = new (body: Record<string, unknown>) => HttpException;

/**
 * Build an HTTP exception whose body carries a machine-readable `code`.
 */
const operatorError = (
  Exception: ExceptionClass,
  status: HttpStatus,
  code: WorkflowRunOperatorErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException =>
  new Exception({ statusCode: status, message, code, ...extra });

/**
 * Resolves the waits of suspended runs that only an admin (operator) can
 * resolve: approves or rejects `await_approval` waits, resumes
 * `suspend_workflow` waits, and cancels suspended runs. It also settles the
 * call stacks of the runs deleted along with a workflow.
 *
 * Payloads are built here from the authenticated admin, so clients cannot set
 * who decided or when. Failures are thrown as HTTP exceptions with a `code`,
 * shared by the REST controller and any other caller.
 */
@Injectable()
export class WorkflowRunOperatorService {
  /**
   * Runs that called a run of a workflow being deleted, by workflow id. They
   * are kept from the workflow's `preDelete` hook to its `postDelete` hook.
   */
  private readonly callersOfDeletedWorkflows = new Map<string, string[]>();

  constructor(
    private readonly workflowRunService: WorkflowRunService,
    private readonly agenticService: AgenticService,
    private readonly eventRestorer: WorkflowEventRestorer,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Approve or reject an `await_approval` wait.
   *
   * @param runId - Suspended run.
   * @param decision - The admin's decision.
   * @param request.waitId - Wait to resolve; optional when the run has a
   * single approval wait.
   * @param request.comment - Optional comment passed on to the workflow.
   * @param actor - Authenticated admin.
   * @returns The run once claimed with the decision (`running`); the rest of
   * the run goes on in the background.
   */
  async decide(
    runId: string,
    decision: ApprovalDecision['decision'],
    request: { waitId?: string; comment?: string },
    actor: OperatorActor,
  ): Promise<WorkflowRunFull> {
    const run = await this.findSuspendedRun(runId);
    const wait = this.selectWait(run, AWAITING_APPROVAL_REASON, request.waitId);
    const comment = request.comment?.trim();
    const resumeData: ApprovalDecision = {
      decision,
      decided_by: actor,
      decided_at: new Date().toISOString(),
      ...(comment ? { comment } : {}),
    };
    this.logger.log('Admin decided on a workflow run approval', {
      runId,
      waitId: wait.waitId,
      decision,
      actorId: actor.id,
    });

    return await this.resolveWait(run, wait, resumeData);
  }

  /**
   * Resume a `suspend_workflow` wait with the data the admin sends.
   *
   * @param runId - Suspended run.
   * @param request.waitId - Wait to resolve; optional when the run has a
   * single resume wait.
   * @param request.data - JSON object passed on to the workflow.
   * @param actor - Authenticated admin.
   * @returns The run once claimed with the data (`running`); the rest of the
   * run goes on in the background.
   */
  async resume(
    runId: string,
    request: { waitId?: string; data?: Record<string, unknown> },
    actor: OperatorActor,
  ): Promise<WorkflowRunFull> {
    const run = await this.findSuspendedRun(runId);
    const wait = this.selectWait(run, AWAITING_RESUME_REASON, request.waitId);
    const resumeData: ResumePayload = {
      data: request.data ?? {},
      resumed_by: actor,
      resumed_at: new Date().toISOString(),
    };
    this.logger.log('Admin resumed a workflow run', {
      runId,
      waitId: wait.waitId,
      actorId: actor.id,
    });

    return await this.resolveWait(run, wait, resumeData);
  }

  /**
   * Fail a suspended run, whatever it waits on.
   *
   * @param runId - Suspended run.
   * @param request.reason - Optional reason stored on the run.
   * @param actor - Authenticated admin.
   * @returns The failed run. A parent waiting on it receives the failed
   * result in the background.
   */
  async cancel(
    runId: string,
    request: { reason?: string },
    actor: OperatorActor,
  ): Promise<WorkflowRunFull> {
    const run = await this.findSuspendedRun(runId);
    const reason = request.reason?.trim();
    const message = `Cancelled by ${actor.name}${reason ? `: ${reason}` : ''}`;
    const event = run.parentRun
      ? await this.restoreEvent(run).catch((error: unknown) => {
          // The parent then catches the result up on its next event.
          this.logger.warn(
            'Unable to rebuild the trigger to notify the parent run',
            { runId, error: error instanceof Error ? error.message : error },
          );

          return undefined;
        })
      : undefined;
    this.logger.log('Admin cancelled a workflow run', {
      runId,
      actorId: actor.id,
    });

    const outcome = await this.agenticService.cancelRun({
      run,
      message,
      event,
    });
    if (outcome.status === 'claim_lost') {
      throw this.claimLost();
    }

    return outcome.run;
  }

  /**
   * Before a workflow is deleted with its runs, cancel the runs they called
   * and keep the runs that called them, to notify once the workflow is gone.
   */
  @OnEvent('hook:workflow:preDelete')
  async handleWorkflowDeleting(
    event: DeleteEntityEvent<WorkflowOrmEntity>,
  ): Promise<void> {
    const workflow = event.databaseEntity;
    if (!workflow?.id) {
      return;
    }

    const callerRunIds =
      await this.workflowRunService.prepareWorkflowDeletion(workflow);
    if (callerRunIds.length > 0) {
      this.callersOfDeletedWorkflows.set(workflow.id, callerRunIds);
    }
  }

  /**
   * Once a workflow is deleted, send each suspended run that called one of
   * its runs a failed result, so its `call_workflow` step fails instead of
   * waiting forever. This happens after the deletion so that a retry of the
   * step cannot start the workflow again. A run whose trigger cannot be
   * rebuilt gets the result on its next event. The deletion does not wait
   * for the callers to go on.
   */
  @OnEvent('hook:workflow:postDelete')
  async handleWorkflowDeleted(
    event: DeleteEntityEvent<WorkflowOrmEntity>,
  ): Promise<void> {
    const workflowId = event.entity?.id ?? event.databaseEntity?.id;
    const callerRunIds = workflowId
      ? this.callersOfDeletedWorkflows.get(workflowId)
      : undefined;
    if (!workflowId || !callerRunIds) {
      return;
    }

    this.callersOfDeletedWorkflows.delete(workflowId);
    for (const runId of callerRunIds) {
      try {
        await this.notifyCallerOfDeletedWorkflow(runId, workflowId);
      } catch (error) {
        this.logger.error(
          'Workflow run failed once a callee was deleted',
          error,
          { runId, workflowId },
        );
      }
    }
  }

  /**
   * Send a run the failed result of its call to a deleted workflow.
   */
  private async notifyCallerOfDeletedWorkflow(
    runId: string,
    workflowId: string,
  ): Promise<void> {
    const run = await this.workflowRunService.findOneAndPopulate(runId);
    // A run still running gets the result once it suspends.
    if (run?.status !== 'suspended') {
      return;
    }

    let event: TriggerEventWrapper;
    try {
      event = await this.eventRestorer.restore(run);
    } catch (error) {
      this.logger.warn(
        'Unable to rebuild the trigger to notify a run that a callee was deleted; it gets the result on its next event',
        {
          runId,
          workflowId,
          error: error instanceof Error ? error.message : error,
        },
      );

      return;
    }

    this.logger.log('Notifying a workflow run that a callee was deleted', {
      runId,
      workflowId,
    });
    // The run goes on from there, which may outlast the deletion request.
    void runInBackground(
      this.logger,
      () => this.agenticService.resumeFromEndedChildren(run.id, event),
      'Workflow run failed once a callee was deleted',
      { runId, workflowId },
    );
  }

  /**
   * Load a run that is suspended.
   */
  private async findSuspendedRun(runId: string): Promise<WorkflowRunFull> {
    const run = await this.workflowRunService.findOneAndPopulate(runId);
    if (!run) {
      throw new NotFoundException(`WorkflowRun with ID ${runId} not found`);
    }
    if (run.status !== 'suspended') {
      throw operatorError(
        ConflictException,
        HttpStatus.CONFLICT,
        'run_not_suspended',
        `Workflow run is ${run.status}, not suspended`,
        { status: run.status },
      );
    }

    return run;
  }

  /**
   * Pick the open wait an operation resolves.
   *
   * @param reason - Reason of the waits the operation resolves.
   * @param waitId - Requested wait; optional when exactly one wait has
   * `reason`.
   */
  private selectWait(
    run: WorkflowRunFull,
    reason: string,
    waitId?: string,
  ): WaitInfo {
    const openWaits = getOpenWaits(run);
    const openWaitIds = openWaits
      .filter((wait) => wait.reason === reason)
      .map((wait) => wait.waitId);

    if (waitId !== undefined) {
      const wait = openWaits.find((candidate) => candidate.waitId === waitId);
      if (!wait) {
        throw operatorError(
          ConflictException,
          HttpStatus.CONFLICT,
          'wait_not_found',
          'The wait is not open on this run; reload the run',
          { openWaitIds },
        );
      }
      if (wait.reason !== reason) {
        throw operatorError(
          BadRequestException,
          HttpStatus.BAD_REQUEST,
          'wait_kind_mismatch',
          `The wait is "${wait.reason ?? 'unknown'}", not "${reason}"`,
        );
      }

      return wait;
    }

    if (openWaitIds.length === 0) {
      throw operatorError(
        ConflictException,
        HttpStatus.CONFLICT,
        'no_matching_wait',
        `The run has no open "${reason}" wait`,
      );
    }
    if (openWaitIds.length > 1) {
      throw operatorError(
        BadRequestException,
        HttpStatus.BAD_REQUEST,
        'wait_ambiguous',
        'The run has several waits of this kind; pass a waitId',
        { openWaitIds },
      );
    }

    return openWaits.find((wait) => wait.waitId === openWaitIds[0])!;
  }

  /**
   * Rebuild the trigger event of a run.
   */
  private async restoreEvent(
    run: WorkflowRunFull,
  ): Promise<TriggerEventWrapper> {
    try {
      return await this.eventRestorer.restore(run);
    } catch (error) {
      if (error instanceof WorkflowTriggerUnavailableError) {
        throw operatorError(
          ConflictException,
          HttpStatus.CONFLICT,
          'trigger_unavailable',
          error.message,
          { reason: error.code },
        );
      }

      throw error;
    }
  }

  /**
   * Resume a run on one of its waits and map the outcome to a response. The
   * response does not wait for the run once it is claimed.
   */
  private async resolveWait(
    run: WorkflowRunFull,
    wait: WaitInfo,
    resumeData: unknown,
  ): Promise<WorkflowRunFull> {
    const event = await this.restoreEvent(run);
    let outcome: ResumeWaitOutcome;
    try {
      outcome = await this.agenticService.resumeWait({
        run,
        event,
        waitId: wait.waitId,
        resumeData,
      });
    } catch (error) {
      this.logger.error('Unable to resume the workflow run', error, {
        runId: run.id,
        waitId: wait.waitId,
      });
      throw operatorError(
        ConflictException,
        HttpStatus.CONFLICT,
        'resume_unavailable',
        `The run could not be resumed and is still waiting: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    switch (outcome.status) {
      case 'accepted':
        // The run goes on in the background; its updates report how.
        return outcome.run;
      case 'rejected':
        throw operatorError(
          UnprocessableEntityException,
          HttpStatus.UNPROCESSABLE_ENTITY,
          'payload_rejected',
          outcome.error.message,
          { issues: outcome.error.issues ?? [] },
        );
      case 'claim_lost':
        throw this.claimLost();
      case 'no_wait':
        throw operatorError(
          ConflictException,
          HttpStatus.CONFLICT,
          'wait_not_found',
          'The wait is no longer open on this run; reload the run',
        );
      case 'unresumable':
      default:
        throw operatorError(
          ConflictException,
          HttpStatus.CONFLICT,
          'unresumable',
          `The run can no longer be resumed and was marked failed: ${outcome.run.error ?? 'unknown error'}`,
        );
    }
  }

  private claimLost(): HttpException {
    return operatorError(
      ConflictException,
      HttpStatus.CONFLICT,
      'claim_lost',
      'The run was resumed or cancelled by another request; reload the run',
    );
  }
}

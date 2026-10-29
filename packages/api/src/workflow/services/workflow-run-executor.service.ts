/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  WaitInfo,
  WorkflowCheckpointInvalidError,
  WorkflowDefinitionDriftError,
  WorkflowResumeRejectedError,
  WorkflowRunner,
  WorkflowRunResult,
} from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { LoggerService } from '@/logger/logger.service';
import { stringifyError } from '@/utils/helpers/misc';

import { WorkflowContextFactory } from '../contexts/workflow-context-factory';
import type { WorkflowRuntimeContext } from '../contexts/workflow-runtime.context';
import {
  failedValues,
  putBackValues,
  RunLease,
  runningValues,
} from '../lib/run-lease';
import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import type {
  ClaimedResume,
  ResumeRefusal,
  ResumeRunOptions,
  RunPass,
} from '../types';

import { WorkflowCompiler } from './workflow-compiler.service';
import { WorkflowRunService } from './workflow-run.service';

const MISSING_DEFINITION_ERROR =
  'Workflow definition is required to run the workflow';

/** A run that was failed because it can never resume. */
export type UnresumableRun = {
  status: 'unresumable';
  /** Error stored on the run, which a parent waiting on it receives. */
  error: string;
};

/** What claiming a suspended run for a resume gave. */
export type ResumeClaim = ClaimedResume | UnresumableRun | ResumeRefusal;

/** See the `claim_lost` case of {@link RunPass}. */
const CLAIM_LOST = { status: 'claim_lost' } as const;

/** What a pass built before it threw, which its failed run is written with. */
type PassScope = { context?: WorkflowRuntimeContext; runner?: WorkflowRunner };

/** A runner that ran, the context it ran with, and its result. */
type RanPass = {
  context: WorkflowRuntimeContext;
  runner: WorkflowRunner;
  result: WorkflowRunResult;
};

/**
 * Runs one pass of one workflow run under a claim, following the host
 * contract of the agentic runner (`packages/agentic/SUSPENSION.md` §8):
 * claims suspended runs for a resume, runs the runner and persists how its
 * pass ended. It knows nothing of the runs waiting on a run's outcome.
 */
@Injectable()
export class WorkflowRunExecutor {
  constructor(
    private readonly workflowRunService: WorkflowRunService,
    private readonly workflowCompiler: WorkflowCompiler,
    private readonly workflowContextFactory: WorkflowContextFactory,
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Execute a new run from its first step.
   *
   * A run that cannot start (no definition, a context or runner that cannot
   * be built) is failed right away.
   *
   * @param lease - Lease the run was created with; the pass ends it.
   * @throws See {@link runPass}.
   */
  async start(
    run: WorkflowRunFull,
    lease: RunLease,
    event: TriggerEventWrapper,
  ): Promise<RunPass> {
    return await this.runPass({ run, lease }, async (scope) => {
      const compiled = this.workflowCompiler.compile(run, event);
      if (!compiled) {
        throw new Error(MISSING_DEFINITION_ERROR);
      }

      const context = await this.workflowContextFactory.create(
        run,
        event,
        compiled.definition,
      );
      scope.context = context;
      const runner = await compiled.workflow.buildAsyncRunner({
        runId: run.id,
      });
      scope.runner = runner;

      this.logger.debug('Marking workflow run as running', {
        runId: run.id,
        workflowId: run.workflow?.id,
        triggeredById: run.triggeredBy?.id,
      });
      const marked = await lease.update(
        runningValues({ context: context.state }),
      );
      if (!marked) {
        return null;
      }

      return {
        context,
        runner,
        result: await runner.start({ inputData: run.input ?? {}, context }),
      };
    });
  }

  /**
   * Claim a suspended run to resume one of its open waits.
   *
   * The checkpoint and the payload are validated before anything is claimed,
   * then the run is claimed on the suspension that was validated. A refused
   * payload leaves the run exactly as it was, still waiting. The caller hands
   * a claimed run to {@link resume}, which ends its lease.
   *
   * @throws When the pinned definition no longer compiles. The run stays
   * suspended: compiling depends on the registered actions and binding kinds,
   * which a later deployment can restore.
   */
  async claimResume(options: ResumeRunOptions): Promise<ResumeClaim> {
    const { run, event, resumeData } = options;
    const compiled = this.workflowCompiler.compile(run, event);
    if (!compiled) {
      return await this.failUnresumable(
        run,
        new Error(MISSING_DEFINITION_ERROR),
      );
    }

    const { definition, workflow } = compiled;
    const restorable = workflow.validateCheckpoint(run.checkpoint);
    if (!restorable.ok) {
      return await this.failUnresumable(run, restorable.error);
    }

    const wait = options.selectWait(restorable.checkpoint.waits);
    if (!wait) {
      return { status: 'no_wait' };
    }

    const accepted = workflow.validateCheckpoint(restorable.checkpoint, {
      waitId: wait.waitId,
      resumeData,
    });
    if (!accepted.ok) {
      if (accepted.error instanceof WorkflowResumeRejectedError) {
        this.logRejection(run, wait, accepted.error);
        // The runner never sees this payload, so the host reports the
        // refusal as the runner does for the payloads it refuses itself.
        this.eventEmitter.emit('hook:workflow:resume_rejected', {
          runId: run.id,
          wait,
          resumeData,
          error: accepted.error,
        });

        return { status: 'rejected', error: accepted.error };
      }

      // The wait was picked from the open ones, so it is always found.
      throw accepted.error;
    }

    const context = await this.workflowContextFactory.create(
      run,
      event,
      definition,
    );
    const lease = await this.workflowRunService.claimSuspended(
      run.id,
      run.suspendedAt ?? null,
    );
    if (!lease) {
      this.logger.warn('Workflow run was already resumed by another caller', {
        runId: run.id,
        waitId: wait.waitId,
      });

      return CLAIM_LOST;
    }

    this.logger.debug('Workflow run claimed for a resume', {
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id,
      waitId: wait.waitId,
    });

    return {
      status: 'claimed',
      run,
      event,
      workflow,
      checkpoint: accepted.checkpoint,
      context,
      wait,
      resumeData,
      lease,
    };
  }

  /**
   * Restore a claimed run from its checkpoint and resume it on the wait it
   * was claimed for. The pass ends the lease of the claim.
   *
   * @throws See {@link runPass}.
   */
  async resume(claim: ClaimedResume): Promise<RunPass> {
    const { run, workflow, checkpoint, context, wait, resumeData, lease } =
      claim;

    return await this.runPass({ run, lease, wait }, async (scope) => {
      scope.context = context;
      const runner = workflow.buildRunnerFromCheckpoint({
        checkpoint,
        context,
        snapshot: run.snapshot ?? undefined,
        runId: run.id,
      });
      scope.runner = runner;

      return {
        context,
        runner,
        result: await runner.resume({ waitId: wait.waitId, resumeData }),
      };
    });
  }

  /**
   * Fail a suspended run that can never be resumed: it pins no definition,
   * or its checkpoint is missing, malformed or taken against another
   * definition. Failing it stops it from claiming further events.
   *
   * @returns The error stored on the run, which the caller sends to a parent
   * waiting on it.
   */
  async failUnresumable(
    run: WorkflowRunFull,
    error: unknown,
  ): Promise<UnresumableRun | typeof CLAIM_LOST> {
    const lease = await this.workflowRunService.claimSuspended(
      run.id,
      run.suspendedAt ?? null,
    );
    if (!lease) {
      return CLAIM_LOST;
    }

    this.logger.error('Workflow run can no longer be resumed', error, {
      runId: run.id,
      workflowId: run.workflow?.id,
      triggeredById: run.triggeredBy?.id ?? null,
      ...(error instanceof WorkflowCheckpointInvalidError
        ? { code: error.code, path: error.path }
        : {}),
      ...(error instanceof WorkflowDefinitionDriftError
        ? { expected: error.expected, actual: error.actual }
        : {}),
    });
    const message = `Cannot resume workflow run: ${stringifyError(error)}`;
    const failed = await lease.settle(failedValues({ error: message }));

    return failed ? { status: 'unresumable', error: message } : CLAIM_LOST;
  }

  /**
   * Run one pass of a claimed run and persist how it ended: the runner's
   * result, a step refusing the resume payload (only the claim is undone),
   * or the runner throwing (the run is failed with what the pass built so
   * far). The pass ends the lease, however it ends.
   *
   * @param pass.wait - Wait a resume resolves, which a refusal is reported
   * with.
   * @param drive - Builds the runner, recording what it built in `scope`,
   * and runs it. Returns `null` when the claim was lost before the runner
   * ran.
   * @throws When how the pass ended could not be written; the claim then
   * lapses and recovery takes the run over. A runner that threw is reported
   * with its own error.
   */
  private async runPass(
    {
      run,
      lease,
      wait,
    }: { run: WorkflowRunFull; lease: RunLease; wait?: WaitInfo },
    drive: (scope: PassScope) => Promise<RanPass | null>,
  ): Promise<RunPass> {
    try {
      const scope: PassScope = {};
      let ran: RanPass | null;
      try {
        ran = await drive(scope);
      } catch (error) {
        const settled = await this.workflowRunService
          .persistCrash(run, scope.runner, scope.context?.state, error, lease)
          .catch((writeError: unknown) => {
            this.logger.error(
              'Unable to persist the failure of a workflow run; it is recovered once its claim lapses',
              writeError,
              { runId: run.id },
            );
            throw error;
          });

        return settled ? { status: 'crashed', error } : CLAIM_LOST;
      }
      if (!ran) {
        return CLAIM_LOST;
      }

      const { context, runner, result } = ran;
      if (result.status === 'suspended' && result.rejection) {
        // The step that read the payload refused it: the runner put the run
        // back as its checkpoint describes it, so only the claim is undone.
        // Only a resume is refused, and it names its wait.
        const { error } = result.rejection;
        this.logRejection(run, wait ?? result.rejection, error);

        return (await lease.settle(putBackValues()))
          ? { status: 'rejected', waits: result.waits, error }
          : CLAIM_LOST;
      }

      const settled = await this.workflowRunService.persistResult(
        run,
        runner,
        result,
        context.state,
        lease,
      );

      return settled ? { status: 'settled', result } : CLAIM_LOST;
    } finally {
      // A settled lease has ended already. Otherwise the claim was lost, or
      // the outcome could not be written: the claim lapses, and recovery
      // takes the run over.
      lease.end();
    }
  }

  /**
   * Log a refused resume payload; the run keeps waiting on the same wait.
   */
  private logRejection(
    run: WorkflowRunFull,
    wait: Pick<WaitInfo, 'waitId' | 'reason'>,
    error: WorkflowResumeRejectedError,
  ): void {
    this.logger.warn('Workflow run refused the resume payload', {
      runId: run.id,
      waitId: wait.waitId,
      reason: wait.reason ?? null,
      error: error.message,
      issues: error.issues,
    });
  }
}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  type WaitInfo,
  type Workflow as AgenticWorkflow,
  type WorkflowCheckpoint,
  type WorkflowResumeRejectedError,
  type WorkflowRunResult,
  type WorkflowRunStatus,
} from '@hexabot-ai/agentic';
import {
  AWAITING_APPROVAL_REASON,
  AWAITING_RESUME_REASON,
  DirectionType,
  McpServerTransport,
  MemoryScope,
  WORKFLOW_OPERATOR_WAIT_REASONS,
  WorkflowType,
  WorkflowVersionAction,
  MemoryDefinition,
  WorkflowRunFull,
} from '@hexabot-ai/types';

import type { WorkflowRuntimeContext } from './contexts/workflow-runtime.context';
import type { WorkflowRunOrmEntity } from './entities/workflow-run.entity';
import type { RunLease } from './lib/run-lease';
import { TriggerEventWrapper } from './lib/trigger-event-wrapper';
import { SchemaInstance } from './utils/schema-instance';

export {
  AWAITING_APPROVAL_REASON,
  AWAITING_RESUME_REASON,
  DirectionType,
  McpServerTransport,
  MemoryScope,
  WorkflowType,
  WorkflowVersionAction,
};

export type MemoryValue = Record<string, unknown>;

/**
 * Suspension reason used by the `call_workflow` action while its parent run
 * waits for a spawned child run to reach a terminal state.
 */
export const AWAITING_CHILD_WORKFLOW_REASON = 'awaiting_child_workflow';

/**
 * Suspension reasons of the waits an admin (operator) resolves through the
 * workflow run API: `await_approval` and `suspend_workflow`.
 */
export const OPERATOR_WAIT_REASONS: ReadonlySet<string> = new Set(
  WORKFLOW_OPERATOR_WAIT_REASONS,
);

/**
 * Suspension reasons of waits that the host resolves itself: a child run's
 * result, or an admin's decision. Inbound events (messages, webhooks, manual
 * triggers) never resolve these waits; they only resolve the other open waits
 * of a run.
 */
export const HOST_RESOLVED_WAIT_REASONS: ReadonlySet<string> = new Set([
  AWAITING_CHILD_WORKFLOW_REASON,
  ...OPERATOR_WAIT_REASONS,
]);

/**
 * Payload passed from a child workflow back to the suspended `call_workflow`
 * action in its parent. Only `finished` is exposed as the action output; the
 * action converts `failed` into a thrown error and treats `suspended` as a
 * durable wait state.
 */
export type CallWorkflowFinishedResult = {
  status: 'finished';
  workflow_id: string;
  workflow_run_id: string;
  output: Record<string, unknown>;
};

export type CallWorkflowSuspendedResult = {
  status: 'suspended';
  workflow_id: string;
  workflow_run_id: string;
};

export type CallWorkflowFailedResult = {
  status: 'failed';
  workflow_id: string;
  workflow_run_id: string;
  error: string;
};

export type CallWorkflowResult =
  | CallWorkflowFinishedResult
  | CallWorkflowSuspendedResult
  | CallWorkflowFailedResult;

export type CallWorkflowOptions = {
  workflowId: string;
  /** Optional child start input. When omitted, the parent event input is reused. */
  input?: Record<string, unknown>;
  /** Runtime context of the parent action that is issuing the workflow call. */
  parentContext: WorkflowRuntimeContext;
};

export interface WorkflowCallService {
  callWorkflow(options: CallWorkflowOptions): Promise<CallWorkflowResult>;
}

export const WORKFLOW_CALL_SERVICE = Symbol('WORKFLOW_CALL_SERVICE');

export type ResumeRunOptions = {
  run: WorkflowRunFull;
  event: TriggerEventWrapper;
  /** Picks the open wait to resolve, from the run's waits in flow order. */
  selectWait: (waits: WaitInfo[]) => WaitInfo | undefined;
  resumeData: unknown;
};

/**
 * Why a resume left its suspended run as it was: nothing was claimed or
 * written.
 */
export type ResumeRefusal =
  /** The payload was refused; the run still waits on the same wait. */
  | { status: 'rejected'; error: WorkflowResumeRejectedError }
  /** Another caller claimed this suspension first. */
  | { status: 'claim_lost' }
  /** None of the open waits is one this caller resolves. */
  | { status: 'no_wait' };

/**
 * A resume that claimed its run; its pass has not run yet. Hand it to
 * `WorkflowRunExecutor.resume`, which ends its lease.
 */
export type ClaimedResume = {
  status: 'claimed';
  run: WorkflowRunFull;
  event: TriggerEventWrapper;
  /** The definition the run pinned, compiled. */
  workflow: AgenticWorkflow;
  checkpoint: WorkflowCheckpoint;
  context: WorkflowRuntimeContext;
  wait: WaitInfo;
  resumeData: unknown;
  lease: RunLease;
};

/** How a pass of a run ended. */
export type RunPass =
  /** The runner's result was persisted. */
  | { status: 'settled'; result: WorkflowRunResult }
  /** A step refused the payload; the run is back on the same suspension. */
  | {
      status: 'rejected';
      waits: WaitInfo[];
      error: WorkflowResumeRejectedError;
    }
  /** The runner threw; the run was failed. */
  | { status: 'crashed'; error: unknown }
  /**
   * The run was taken over (its thread was closed) or recovered (its claim
   * lapsed) while the pass ran: the outcome of the pass was dropped.
   */
  | { status: 'claim_lost' };

export type ResumeWaitOptions = {
  run: WorkflowRunFull;
  event: TriggerEventWrapper;
  /** Open wait to resolve. */
  waitId: string;
  resumeData: unknown;
};

/**
 * What happened to a wait the host resolved on behalf of an admin, once the
 * run was claimed or refused. The work that follows goes on in the
 * background (`WorkflowJobs`), so an admin request does not wait for the
 * rest of the run.
 */
export type ResumeWaitOutcome =
  /**
   * The payload was accepted and the run claimed: `running`, or a later
   * status when its pass got there before the run was read back.
   */
  | { status: 'accepted'; run: WorkflowRunFull }
  | ResumeRefusal
  /**
   * The run can never resume; it was marked failed with `error`, which a
   * parent waiting on it receives.
   */
  | { status: 'unresumable'; error: string };

/**
 * What an event did, for the callers that answer whoever sent it: manual
 * runs, webhooks and the MCP run tool. Unlike a chat message, which no one
 * answers, an event that left the suspended run it reached as it was is an
 * error to report, not a run that goes on.
 */
export type TriggerEventOutcome =
  /**
   * The event reached its run: created (`idle`), resumed (`running`), or
   * held by a run that waits on a workflow it called. When the caller
   * waited, the run as it is once its pass is over.
   */
  | { status: 'dispatched'; run: WorkflowRunFull }
  /**
   * The suspended run the event reached refused its payload, before it was
   * claimed or, when the caller waited for the pass, in the step that read
   * it; it still waits on the same wait.
   */
  | { status: 'rejected'; runId: string; error: WorkflowResumeRejectedError }
  /** Another caller claimed the suspended run the event reached first. */
  | { status: 'claim_lost'; runId: string }
  /**
   * No run processed the event, or the pass the caller waited for did not
   * end it: the runner threw (logged), or the run was taken over meanwhile.
   */
  | { status: 'unprocessed' };

export type CancelRunOptions = {
  run: WorkflowRunFull;
  /** Failure message stored on the run and its cancelled steps. */
  message: string;
};

/** What happened to a suspended run the host tried to cancel. */
export type CancelRunOutcome =
  /**
   * The run was failed, along with its suspended descendants; a parent
   * waiting on it receives the failed result in the background.
   */
  | { status: 'cancelled'; run: WorkflowRunFull }
  /** Another caller resumed or cancelled this suspension first. */
  | { status: 'claim_lost' };

/** Statuses of the runs held under a claim by the pass running them. */
export const CLAIMED_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  EWorkflowRunStatus.IDLE,
  EWorkflowRunStatus.RUNNING,
];

/** Statuses of the runs that have not ended. */
export const ACTIVE_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  ...CLAIMED_WORKFLOW_RUN_STATUSES,
  EWorkflowRunStatus.SUSPENDED,
];

/** Claims renewed per `UPDATE`, to stay under bound parameter limits. */
export const WORKFLOW_RUN_CLAIM_RENEW_BATCH_SIZE = 500;

/** The token of a claim on a run, and when the claim lapses. */
export type RunClaim = { claimId: string; expiresAt: Date };

/** A claim held by this process, as renewals read it. */
export type HeldClaim = { runId: string; claimId: string };

/** A run whose claim lapsed, as recovery reads it. */
export type ExpiredClaim = {
  id: string;
  claimId: string;
  hasCheckpoint: boolean;
  recoveryCount: number;
};

/** Values a claimed run is written with. */
export type RunSettlement = Partial<
  Pick<
    WorkflowRunOrmEntity,
    | 'status'
    | 'checkpoint'
    | 'awaitingOperator'
    | 'snapshot'
    | 'context'
    | 'stepLog'
    | 'input'
    | 'output'
    | 'error'
    | 'suspendedAt'
    | 'finishedAt'
    | 'failedAt'
    | 'recoveryCount'
  >
>;

/** Run state persisted when a runner pass ends. */
export type RunStateUpdate = Pick<
  RunSettlement,
  'snapshot' | 'context' | 'stepLog' | 'input' | 'output'
>;

export type WorkflowContextState = Record<string, unknown> & {
  initiatorId: string;
  workflowId: string;
  threadId?: string | null;
  runId: string;
};

export type MemoryStoreData = Record<string, MemoryValue>;

export type MemoryStoreInstances = Record<string, SchemaInstance>;

export type MemoryStoreIdentifier = {
  ownerId: string;
  workflowId?: string | null;
  threadId?: string | null;
  runId?: string | null;
  memoryDefinitionIds?: string[];
};

export type MemoryStoreUpdater = (
  slug: string,
  value: MemoryValue,
) => Promise<MemoryValue>;

export type MemoryStoreBatchUpdater = (
  values: MemoryStoreData,
) => Promise<MemoryStoreData>;

export type MemoryStorePersistRecordFn = (params: {
  definition: MemoryDefinition;
  ownerId: string;
  workflowId?: string | null;
  threadId?: string | null;
  runId?: string | null;
  value: MemoryValue;
}) => Promise<void>;

export type McpToolBindingDefinitions = Record<
  string,
  {
    settings?: {
      server_id?: string;
      tool_names?: string[];
    };
  }
>;

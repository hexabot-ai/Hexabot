/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EWorkflowRunStatus,
  type WaitInfo,
  type WorkflowResumeRejectedError,
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
  WorkflowFull,
} from '@hexabot-ai/types';

import type { WorkflowRuntimeContext } from './contexts/workflow-runtime.context';
import type { WorkflowRunOrmEntity } from './entities/workflow-run.entity';
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

export type StartRunOptions = {
  workflow: WorkflowFull;
  event: TriggerEventWrapper;
  /** Present when this run is a child workflow call. */
  parentRun?: WorkflowRunFull;
  /** Start input override for child calls. */
  input?: Record<string, unknown>;
};

export type ResumeRunOptions = {
  run: WorkflowRunFull;
  event: TriggerEventWrapper;
  /** Picks the open wait to resolve, from the run's waits in flow order. */
  selectWait: (waits: WaitInfo[]) => WaitInfo | undefined;
  resumeData: unknown;
};

/** What happened to a suspended run the host tried to resume. */
export type ResumeOutcome =
  /** The wait was resolved and the run went on. */
  | { status: 'resumed'; run: WorkflowRunFull }
  /** The payload was refused; the run is unchanged and still waiting. */
  | {
      status: 'rejected';
      run: WorkflowRunFull;
      error: WorkflowResumeRejectedError;
    }
  /**
   * Another caller resumed this suspension first; or the run was taken over
   * (its thread was closed) or recovered while this caller ran it, and the
   * outcome of that pass was dropped.
   */
  | { status: 'claim_lost'; run: WorkflowRunFull }
  /** None of the open waits is one this caller resolves. */
  | { status: 'no_wait'; run: WorkflowRunFull }
  /** The run can never resume; it was marked failed. */
  | { status: 'unresumable'; run: WorkflowRunFull };

export type ResumeWaitOptions = {
  run: WorkflowRunFull;
  event: TriggerEventWrapper;
  /** Open wait to resolve. */
  waitId: string;
  resumeData: unknown;
};

/**
 * What happened to a wait the host resolved on behalf of an admin. On top of
 * {@link ResumeOutcome}, `failed` means the wait was resolved but the run
 * failed while it went on.
 */
export type ResumeWaitOutcome =
  | ResumeOutcome
  | { status: 'failed'; run: WorkflowRunFull; error: unknown };

export type CancelRunOptions = {
  run: WorkflowRunFull;
  /** Failure message stored on the run and its cancelled steps. */
  message: string;
  /** Event used to deliver the failed result to a waiting parent run. */
  event?: TriggerEventWrapper;
};

/** What happened to a suspended run the host tried to cancel. */
export type CancelRunOutcome =
  /** The run was failed, along with its suspended descendants. */
  | { status: 'cancelled'; run: WorkflowRunFull }
  /** Another caller resumed or cancelled this suspension first. */
  | { status: 'claim_lost'; run: WorkflowRunFull };

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

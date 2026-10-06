/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  WaitInfo,
  WorkflowResumeRejectedError,
} from '@hexabot-ai/agentic';
import {
  DirectionType,
  McpServerTransport,
  MemoryScope,
  WorkflowType,
  WorkflowVersionAction,
  MemoryDefinition,
  WorkflowRunFull,
  WorkflowFull,
} from '@hexabot-ai/types';

import type { WorkflowRuntimeContext } from './contexts/workflow-runtime.context';
import { TriggerEventWrapper } from './lib/trigger-event-wrapper';
import { SchemaInstance } from './utils/schema-instance';

export {
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
 * Suspension reasons of waits that the host resolves itself. Inbound events
 * (messages, webhooks, manual triggers) never resolve these waits; they only
 * resolve the other open waits of a run.
 */
export const HOST_RESOLVED_WAIT_REASONS: ReadonlySet<string> = new Set([
  AWAITING_CHILD_WORKFLOW_REASON,
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
  /** Another caller resumed this suspension first. */
  | { status: 'claim_lost'; run: WorkflowRunFull }
  /** None of the open waits is one this caller resolves. */
  | { status: 'no_wait'; run: WorkflowRunFull }
  /** The run can never resume; it was marked failed. */
  | { status: 'unresumable'; run: WorkflowRunFull };

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

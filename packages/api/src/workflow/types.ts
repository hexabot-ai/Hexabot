/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  WorkflowResumeResult,
  WorkflowRunner,
  WorkflowSnapshot,
  WorkflowStartResult,
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

export type WorkflowResult = WorkflowStartResult | WorkflowResumeResult;

/**
 * Suspension reason used by the `call_workflow` action while its parent run
 * waits for a spawned child run to reach a terminal state.
 */
export const AWAITING_CHILD_WORKFLOW_REASON = 'awaiting_child_workflow';

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

export type RunWorkflowOptions =
  | {
      mode: 'start';
      workflow: WorkflowFull;
      event: TriggerEventWrapper;
      /** Present when this run is a child workflow call. */
      parentRun?: WorkflowRunFull;
      /** Start input override for child calls. */
      input?: Record<string, unknown>;
    }
  | {
      mode: 'resume';
      run: WorkflowRunFull;
      event: TriggerEventWrapper;
      /** Internal resume payload used to unwind a completed child into its parent. */
      resumeData?: unknown;
    };

export type MarkRunningInput = {
  snapshot?: WorkflowSnapshot | null;
  lastResumeData?: unknown;
};

export type RunStrategy = {
  runner: WorkflowRunner;
  markRunningInput: MarkRunningInput;
  resumeData?: unknown;
  execute: () => Promise<WorkflowResult>;
};

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

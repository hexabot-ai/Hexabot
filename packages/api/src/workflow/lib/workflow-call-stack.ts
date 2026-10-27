/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo, WorkflowRunResult } from '@hexabot-ai/agentic';
import type { WorkflowRunFull } from '@hexabot-ai/types';

import { stringifyError } from '@/utils/helpers/misc';

import {
  AWAITING_CHILD_WORKFLOW_REASON,
  type CallWorkflowResult,
} from '../types';

/**
 * Resolve a workflow run relation from either a populated object or id.
 */
export const resolveRunId = (
  run: string | { id?: string | null } | null | undefined,
): string | null => {
  if (typeof run === 'string') {
    return run;
  }

  return run?.id ?? null;
};

/**
 * Read the child run a `call_workflow` wait is waiting on.
 *
 * @returns The child run id, or `undefined` for any other wait.
 */
export const getChildRunId = (wait: WaitInfo): string | undefined => {
  if (wait.reason !== AWAITING_CHILD_WORKFLOW_REASON) {
    return undefined;
  }

  const childRunId = (wait.data as { workflow_run_id?: unknown } | null)
    ?.workflow_run_id;

  return typeof childRunId === 'string' ? childRunId : undefined;
};

/**
 * Build the `call_workflow` payload of a child run that failed.
 */
export const toFailedCallWorkflowResult = (
  run: WorkflowRunFull,
  error: unknown,
): CallWorkflowResult => ({
  status: 'failed',
  workflow_id: run.workflow.id,
  workflow_run_id: run.id,
  error: stringifyError(error),
});

/**
 * Convert a child run terminal/suspended result into the `call_workflow`
 * contract. The same payload shape is used for immediate returns and for
 * resuming a parent after the child completed in a later event.
 */
export const toCallWorkflowResult = (
  run: WorkflowRunFull,
  result: WorkflowRunResult,
): CallWorkflowResult => {
  if (result.status === 'finished') {
    return {
      status: 'finished',
      workflow_id: run.workflow.id,
      workflow_run_id: run.id,
      output: result.output,
    };
  }

  if (result.status === 'suspended') {
    return {
      status: 'suspended',
      workflow_id: run.workflow.id,
      workflow_run_id: run.id,
    };
  }

  return toFailedCallWorkflowResult(run, result.error);
};

/**
 * Build the `call_workflow` payload of a persisted child run that ended.
 */
export const toEndedCallWorkflowResult = (
  run: WorkflowRunFull,
): CallWorkflowResult => {
  if (run.status === 'finished') {
    return {
      status: 'finished',
      workflow_id: run.workflow.id,
      workflow_run_id: run.id,
      output: run.output ?? {},
    };
  }

  return toFailedCallWorkflowResult(
    run,
    run.error ?? 'Child workflow run failed',
  );
};

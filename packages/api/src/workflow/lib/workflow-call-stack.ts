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
  type CallWorkflowFailedResult,
  type CallWorkflowResult,
  type RunPass,
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
 * Tell which runs to reconcile once `run` ended (see
 * `WorkflowCallStackService.reconcile`): the run itself, since nothing
 * waits on its suspended children any more, and its parent, which may wait
 * on its result.
 */
export const endedFollowUps = (
  run: Pick<WorkflowRunFull, 'id' | 'parentRun'>,
): (string | null)[] => [run.id, resolveRunId(run.parentRun)];

/**
 * Tell which runs to reconcile once a pass of `run` is over (see
 * `WorkflowCallStackService.reconcile`): the run itself when it is back to
 * `suspended`, since child runs may have ended while it was not, or the
 * pass may have dropped its waits on some of them; the run and its parent
 * when it ended (see {@link endedFollowUps}). A run whose claim was lost is
 * left to whoever settled it.
 */
export const followUps = (
  run: Pick<WorkflowRunFull, 'id' | 'parentRun'>,
  pass: RunPass,
): (string | null)[] => {
  switch (pass.status) {
    case 'claim_lost':
      return [];
    case 'rejected':
      return [run.id];
    case 'settled':
      return pass.result.status === 'suspended'
        ? [run.id]
        : endedFollowUps(run);
    case 'crashed':
    default:
      return endedFollowUps(run);
  }
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
 * Read the child runs a set of open waits is waiting on.
 */
export const getWaitedOnChildRunIds = (waits: WaitInfo[]): Set<string> =>
  new Set(
    waits.map(getChildRunId).filter((id): id is string => id !== undefined),
  );

/**
 * Read the workflow a `call_workflow` wait called.
 *
 * @returns The called workflow id, or `undefined` when the wait names none.
 */
export const getCalledWorkflowId = (wait: WaitInfo): string | undefined => {
  const workflowId = (wait.data as { workflow_id?: unknown } | null)
    ?.workflow_id;

  return typeof workflowId === 'string' ? workflowId : undefined;
};

/**
 * Build the `call_workflow` payload of a child run that no longer exists.
 *
 * @param wait - The parent's wait on the child run.
 * @param childRunId - Id of the deleted child run.
 * @param workflowExists - Whether the called workflow still exists, so only
 * its run was deleted.
 */
export const toDeletedCallWorkflowResult = (
  wait: WaitInfo,
  childRunId: string,
  workflowExists: boolean,
): CallWorkflowFailedResult => {
  const workflowId = getCalledWorkflowId(wait);

  return {
    status: 'failed',
    workflow_id: workflowId ?? '',
    workflow_run_id: childRunId,
    error: workflowExists
      ? `Called workflow run ${childRunId} was deleted`
      : `Called workflow ${workflowId} was deleted`,
  };
};

/**
 * Build the `call_workflow` payload of a child run that failed.
 */
const toFailedCallWorkflowResult = (
  run: WorkflowRunFull,
  error: unknown,
): CallWorkflowResult => ({
  status: 'failed',
  workflow_id: run.workflow.id,
  workflow_run_id: run.id,
  error: stringifyError(error),
});

/**
 * Convert the result of a child run's first pass into the `call_workflow`
 * contract, returned to the calling step. A parent resumed once the child
 * ended later reads it with {@link toEndedCallWorkflowResult} instead.
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

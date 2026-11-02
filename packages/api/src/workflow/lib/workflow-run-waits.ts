/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  StepExecutionRecord,
  WaitInfo,
  WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import type { WorkflowRun } from '@hexabot-ai/types';

import { HOST_RESOLVED_WAIT_REASONS, OPERATOR_WAIT_REASONS } from '../types';

/**
 * Read the open waits of a run from its checkpoint, in flow order.
 *
 * @param run - Run as persisted.
 * @returns The open waits, or none when the run holds no checkpoint.
 */
export const getOpenWaits = (
  run: Pick<WorkflowRun, 'checkpoint'>,
): WaitInfo[] => {
  const waits = (run.checkpoint as { waits?: unknown } | null)?.waits;

  return Array.isArray(waits) ? (waits as WaitInfo[]) : [];
};

/**
 * Tell whether an inbound event (a message, a webhook, a manual trigger) can
 * resolve this wait. The host resolves the others itself: a child run's
 * result, or an admin's decision (see `HOST_RESOLVED_WAIT_REASONS`).
 */
export const isEventWait = (wait: Pick<WaitInfo, 'reason'>): boolean =>
  !HOST_RESOLVED_WAIT_REASONS.has(wait.reason ?? '');

/**
 * Find the wait an inbound event resolves: the first one, in flow order,
 * that the host does not resolve itself (see {@link isEventWait}).
 *
 * @param waits - Open waits of a run, in flow order.
 * @returns The wait, or `undefined` when an event resolves none of them.
 */
export const findEventWait = (waits: WaitInfo[]): WaitInfo | undefined =>
  waits.find(isEventWait);

/**
 * Tell whether an admin (operator) resolves this wait.
 */
export const isOperatorWait = (wait: Pick<WaitInfo, 'reason'>): boolean =>
  OPERATOR_WAIT_REASONS.has(wait.reason ?? '');

/**
 * Tell whether any of these waits is resolved by an admin.
 */
export const hasOperatorWait = (waits: Pick<WaitInfo, 'reason'>[]): boolean =>
  waits.some(isOperatorWait);

/**
 * Tell whether a run can only go on through an admin: it has an open wait an
 * admin resolves, and no wait an inbound event resolves.
 *
 * @param run - Run as persisted.
 */
export const isBlockedOnOperator = (
  run: Pick<WorkflowRun, 'checkpoint'>,
): boolean => {
  const waits = getOpenWaits(run);

  return hasOperatorWait(waits) && !waits.some(isEventWait);
};

/**
 * Build the snapshot and step log of a suspended run whose open waits are
 * dropped, e.g. when an admin cancels it: every step holding an open wait is
 * marked `cancelled`, as the runner does for the waits it drops.
 *
 * @param run - Suspended run as persisted.
 * @param message - Reason recorded on the cancelled steps.
 * @param endedAt - Time the steps were cancelled at.
 */
export const cancelOpenWaits = (
  run: Pick<WorkflowRun, 'checkpoint' | 'snapshot' | 'stepLog'>,
  message: string,
  endedAt: number = Date.now(),
): {
  snapshot: WorkflowSnapshot | null;
  stepLog: Record<string, StepExecutionRecord> | null;
} => {
  const previousSnapshot = (run.snapshot ?? null) as WorkflowSnapshot | null;
  const previousStepLog = (run.stepLog ?? null) as Record<
    string,
    StepExecutionRecord
  > | null;
  const actions = { ...(previousSnapshot?.actions ?? {}) };
  const stepLog = { ...(previousStepLog ?? {}) };

  for (const { step } of getOpenWaits(run)) {
    actions[step.id] = {
      id: step.id,
      name: step.name,
      status: 'cancelled',
      reason: message,
    };
    stepLog[step.id] = {
      ...(stepLog[step.id] ?? { id: step.id, name: step.name }),
      id: step.id,
      name: step.name,
      status: 'cancelled',
      endedAt,
      reason: message,
      error: { message },
    };
  }

  return {
    snapshot: previousSnapshot ? { status: 'failed', actions } : null,
    stepLog: Object.keys(stepLog).length > 0 ? stepLog : null,
  };
};

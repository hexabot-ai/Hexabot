/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from '@hexabot-ai/agentic';
import type { WorkflowRun } from '@hexabot-ai/types';

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

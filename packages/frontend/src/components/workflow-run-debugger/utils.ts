/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus, type WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";

import type { BadgeWithTitleProps } from "@/app-components/displays/Badge";
import {
  WORKFLOW_RUN_AWAITING_OPERATOR_STATUS,
  WORKFLOW_STATUS,
} from "@/constants/workflow.constants";
import { normalizeDate } from "@/utils/date";

import type { InitiatorIdentity } from "./types";

const RUN_TIMESTAMP_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

export const resolveEntityId = (
  value?: string | { id?: string } | null,
): string | undefined => {
  if (!value) return undefined;

  return typeof value === "string" ? value : value.id;
};

export const getInitiatorName = (
  initiator?: InitiatorIdentity | null,
): string => {
  if (!initiator) return "Unknown";
  if (initiator.fullName) return initiator.fullName;

  const firstName = initiator.firstName?.trim() ?? "";
  const lastName = initiator.lastName?.trim() ?? "";
  const combined = `${firstName} ${lastName}`.trim();

  return combined || initiator.id || "Unknown";
};

export const formatRunTimestamp = (
  locale: string,
  date?: Date | string,
): string => normalizeDate(locale, date, RUN_TIMESTAMP_OPTIONS) ?? "-";

export const getStatusBadge = (
  status: EWorkflowRunStatus,
  awaitingOperator = false,
): BadgeWithTitleProps => {
  const { key: _key, ...statusBadge } =
    status === EWorkflowRunStatus.SUSPENDED && awaitingOperator
      ? WORKFLOW_RUN_AWAITING_OPERATOR_STATUS
      : (WORKFLOW_STATUS[status] ?? WORKFLOW_STATUS[EWorkflowRunStatus.IDLE]);

  return statusBadge;
};

/**
 * Read the open waits of a run from its checkpoint, in flow order.
 *
 * Only a suspended run has open waits: a resumed run keeps its previous
 * checkpoint until it suspends again, finishes or fails.
 *
 * @param run - Run as cached.
 * @returns The open waits, or none when the run is not suspended.
 */
export const getOpenWaits = (
  run?: Pick<WorkflowRun, "status" | "checkpoint"> | null,
): WaitInfo[] => {
  if (run?.status !== EWorkflowRunStatus.SUSPENDED) {
    return [];
  }

  const waits = run.checkpoint?.waits;

  return Array.isArray(waits) ? (waits as WaitInfo[]) : [];
};

/**
 * Keep the waits opened by one step instance (loop iterations included).
 *
 * @param waits - Open waits of the run.
 * @param stepId - Instance step id, as keyed in the step log.
 * @returns The waits of that step.
 */
export const getStepWaits = (waits: WaitInfo[], stepId: string): WaitInfo[] =>
  waits.filter((wait) => wait.step?.id === stepId);

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from "@hexabot-ai/agentic";
import type { StepExecutionRecord } from "@hexabot-ai/agentic";

import { EntityType } from "@/services/types";

export type CacheRecord = Record<string, unknown>;

const ENTITY_RELATION_KEYS_TO_PRESERVE: Partial<Record<EntityType, string[]>> =
  {
    [EntityType.THREAD]: ["subscriber", "source"],
    [EntityType.WORKFLOW_RUN]: [
      "workflow",
      "workflowVersion",
      "triggeredBy",
      "thread",
      "parentRun",
    ],
  };
const TERMINAL_WORKFLOW_RUN_STATUSES = new Set<string>([
  EWorkflowRunStatus.FINISHED,
  EWorkflowRunStatus.FAILED,
]);
const isObjectRecord = (value: unknown): value is CacheRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStepLog = (
  value: unknown,
): value is Record<string, StepExecutionRecord> => isObjectRecord(value);
const getStepTimestamp = (step: StepExecutionRecord): number => {
  const startedAt = typeof step.startedAt === "number" ? step.startedAt : 0;
  const endedAt = typeof step.endedAt === "number" ? step.endedAt : 0;

  return Math.max(startedAt, endedAt);
};

export const mergeStepExecutionRecord = (
  previous: StepExecutionRecord | undefined,
  next: StepExecutionRecord,
): StepExecutionRecord => {
  if (!previous) {
    return { ...next };
  }

  if (getStepTimestamp(previous) > getStepTimestamp(next)) {
    return previous;
  }

  const context =
    previous.context || next.context
      ? { ...previous.context, ...next.context }
      : undefined;

  return {
    ...previous,
    ...next,
    context,
  };
};

const mergeStepExecutionLogs = (
  previous: unknown,
  next: unknown,
): Record<string, StepExecutionRecord> | null | undefined => {
  if (!isStepLog(previous)) {
    return isStepLog(next) ? next : (next as null | undefined);
  }

  if (next == null) {
    return previous;
  }

  if (!isStepLog(next)) {
    return previous;
  }

  return Object.entries(next).reduce<Record<string, StepExecutionRecord>>(
    (merged, [stepId, step]) => ({
      ...merged,
      [stepId]: mergeStepExecutionRecord(merged[stepId], step),
    }),
    { ...previous },
  );
};
const preserveRelationObjects = (
  entityType: EntityType,
  previousData: CacheRecord | undefined,
  mergedPayload: CacheRecord,
) => {
  const relationKeys = ENTITY_RELATION_KEYS_TO_PRESERVE[entityType] ?? [];

  relationKeys.forEach((relationKey) => {
    if (
      isObjectRecord(previousData?.[relationKey]) &&
      typeof mergedPayload[relationKey] === "string"
    ) {
      mergedPayload[relationKey] = previousData?.[relationKey];
    }
  });
};
const preserveTerminalWorkflowRunState = (
  previousData: CacheRecord | undefined,
  mergedPayload: CacheRecord,
) => {
  if (
    typeof previousData?.status !== "string" ||
    !TERMINAL_WORKFLOW_RUN_STATUSES.has(previousData.status) ||
    typeof mergedPayload.status !== "string" ||
    TERMINAL_WORKFLOW_RUN_STATUSES.has(mergedPayload.status)
  ) {
    return;
  }

  mergedPayload.status = previousData.status;
  ["finishedAt", "failedAt"].forEach((field) => {
    if (previousData[field] && !mergedPayload[field]) {
      mergedPayload[field] = previousData[field];
    }
  });
};

export const mergeEntityCachePayload = (
  entityType: EntityType,
  previousData: CacheRecord | undefined,
  nextEntityData: CacheRecord,
) => {
  const mergedPayload: CacheRecord = {
    ...previousData,
    ...nextEntityData,
  };

  preserveRelationObjects(entityType, previousData, mergedPayload);

  if (entityType === EntityType.WORKFLOW_RUN) {
    const mergedStepLog = mergeStepExecutionLogs(
      previousData?.stepLog,
      nextEntityData.stepLog,
    );

    if (mergedStepLog !== undefined) {
      mergedPayload.stepLog = mergedStepLog;
    }

    preserveTerminalWorkflowRunState(previousData, mergedPayload);
  }

  return mergedPayload;
};

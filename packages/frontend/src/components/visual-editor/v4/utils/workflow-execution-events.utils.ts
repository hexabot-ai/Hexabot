/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord } from "@hexabot-ai/agentic";
import {
  EIndicatorType,
  type WorkflowExecutionStateMap,
} from "@hexabot-ai/graph";

import type {
  NodeExecutionState,
  SubscribeWorkflowProps,
} from "../types/workflow.types";

export const START_INDICATOR_FINISH_DELAY_MS = 1000;
export const STEP_SUCCESS_FINISH_DELAY_MS = 800;
export const WORKFLOW_FINISH_DELAY_MS = 1000;
export const WORKFLOW_RESET_DELAY_MS = 1200;
const LOOP_ITERATION_SUFFIX_PATTERN = /\[(?:\d+(?:\.\d+)*)\]$/;

type AppendExecutionStateAction = {
  type: "append";
  key: string;
  state: NodeExecutionState;
  t?: number;
  delayMs?: number;
};

type ClearExecutionStateAction = {
  type: "clear";
  delayMs?: number;
};

export type ExecutionStateUpdateAction =
  | AppendExecutionStateAction
  | ClearExecutionStateAction;

export const isWorkflowEventForFlow = (
  event: SubscribeWorkflowProps,
  flowId?: string,
) => {
  if (!event.workflowId) {
    return true;
  }

  return Boolean(flowId) && event.workflowId === flowId;
};

export const isStepWorkflowEvent = (
  event: SubscribeWorkflowProps,
): event is SubscribeWorkflowProps & { step: { id: string } } => {
  if (!event.workflowEvent.startsWith("step:") || !("step" in event)) {
    return false;
  }

  const step = (event as { step?: { id?: unknown } }).step;

  return typeof step?.id === "string" && step.id.length > 0;
};
const toExecutionStepKey = (stepId: string) => {
  return stepId.replace(LOOP_ITERATION_SUFFIX_PATTERN, "");
};
const hasLoopIterationSuffix = (stepId: string) => {
  return LOOP_ITERATION_SUFFIX_PATTERN.test(stepId);
};

export const restoreWorkflowExecutionStates = (
  stepLog?: Record<string, StepExecutionRecord> | null,
): WorkflowExecutionStateMap =>
  Object.values(stepLog ?? {}).reduce<WorkflowExecutionStateMap>(
    (states, step) => {
      if (step.status === "pending" || step.status === "skipped") {
        return states;
      }

      const state =
        step.status === "failed"
          ? "error"
          : step.status === "completed"
            ? "finish"
            : step.status;
      const key = toExecutionStepKey(step.id);

      states[key] = [
        ...(states[key] ?? []),
        { state, t: step.endedAt ?? step.startedAt ?? 0 },
      ];

      return states;
    },
    {},
  );

export const mapWorkflowEventToExecutionActions = (
  event: SubscribeWorkflowProps,
): ExecutionStateUpdateAction[] => {
  if (event.workflowEvent === "workflow:start") {
    return [
      { type: "clear" },
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "start",
        t: event.t,
      },
    ];
  }

  if (event.workflowEvent === "workflow:finish") {
    return [
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_END,
        state: "start",
        t: event.t,
      },
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_END,
        state: "finish",
        delayMs: WORKFLOW_FINISH_DELAY_MS,
      },
      {
        type: "clear",
        delayMs: WORKFLOW_RESET_DELAY_MS,
      },
    ];
  }

  if (!isStepWorkflowEvent(event)) {
    return [];
  }

  const stepExecutionKey = toExecutionStepKey(event.step.id);
  const isLoopIterationStep = hasLoopIterationSuffix(event.step.id);
  const stepActions: ExecutionStateUpdateAction[] = [
    {
      type: "append",
      key: EIndicatorType.WORKFLOW_START,
      state: "finish",
      delayMs: START_INDICATOR_FINISH_DELAY_MS,
    },
  ];

  // A resumed step re-runs its action body from the top.
  if (
    event.workflowEvent === "step:start" ||
    event.workflowEvent === "step:resumed"
  ) {
    stepActions.push({
      type: "append",
      key: stepExecutionKey,
      state: "start",
      t: event.t,
    });
  }

  if (event.workflowEvent === "step:error") {
    stepActions.push({
      type: "append",
      key: stepExecutionKey,
      state: "error",
      t: event.t,
    });
  }

  if (event.workflowEvent === "step:success") {
    stepActions.push({
      type: "append",
      key: stepExecutionKey,
      state: "finish",
      ...(isLoopIterationStep
        ? { t: event.t }
        : { delayMs: STEP_SUCCESS_FINISH_DELAY_MS }),
    });
  }

  // A refused resume payload puts the step back on the same wait.
  if (
    event.workflowEvent === "step:suspended" ||
    event.workflowEvent === "step:resume_rejected"
  ) {
    stepActions.push({
      type: "append",
      key: stepExecutionKey,
      state: "suspended",
      t: event.t,
    });
  }

  if (event.workflowEvent === "step:cancelled") {
    stepActions.push({
      type: "append",
      key: stepExecutionKey,
      state: "cancelled",
      t: event.t,
    });
  }

  return stepActions;
};

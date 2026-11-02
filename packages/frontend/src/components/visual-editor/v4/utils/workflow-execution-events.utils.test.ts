/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType } from "@hexabot-ai/agentic";
import { EIndicatorType } from "@hexabot-ai/graph";
import { describe, expect, it } from "vitest";

import type { SubscribeWorkflowProps } from "../types/workflow.types";

import {
  START_INDICATOR_FINISH_DELAY_MS,
  STEP_SUCCESS_FINISH_DELAY_MS,
  WORKFLOW_FINISH_DELAY_MS,
  WORKFLOW_RESET_DELAY_MS,
  isStepWorkflowEvent,
  isWorkflowEventForFlow,
  mapWorkflowEventToExecutionActions,
  restoreWorkflowExecutionStates,
} from "./workflow-execution-events.utils";

const stepInfo = {
  id: "0:send_message",
  name: "send_message",
  type: StepType.Task,
};
const workflowStartEvent: SubscribeWorkflowProps = {
  workflowEvent: "workflow:start",
  workflowId: "flow-1",
  runId: "run-1",
  t: 100,
};
const stepStartEvent: SubscribeWorkflowProps = {
  workflowEvent: "step:start",
  workflowId: "flow-1",
  runId: "run-1",
  t: 110,
  step: stepInfo,
};
const stepSuccessEvent: SubscribeWorkflowProps = {
  ...stepStartEvent,
  workflowEvent: "step:success",
  t: 120,
};
const stepCancelledEvent: SubscribeWorkflowProps = {
  ...stepStartEvent,
  workflowEvent: "step:cancelled",
  t: 125,
};
const loopStepStartEvent: SubscribeWorkflowProps = {
  ...stepStartEvent,
  t: 130,
  step: {
    ...stepInfo,
    id: "0.iterate.0:send_message[2.4]",
  },
};
const loopStepSuccessEvent: SubscribeWorkflowProps = {
  ...loopStepStartEvent,
  workflowEvent: "step:success",
  t: 140,
};
const wait = {
  waitId: "wait-1",
  step: stepInfo,
  suspendKey: "index:1",
  reason: "approval",
};
const stepResumedEvent: SubscribeWorkflowProps = {
  ...stepStartEvent,
  workflowEvent: "step:resumed",
  t: 150,
  wait,
  resumeData: { approved: true },
};
const stepResumeRejectedEvent: SubscribeWorkflowProps = {
  ...stepStartEvent,
  workflowEvent: "step:resume_rejected",
  t: 160,
  wait,
  error: {
    name: "WorkflowResumeRejectedError",
    message: "approved: Required",
  } as never,
};
const workflowResumeRejectedEvent: SubscribeWorkflowProps = {
  workflowEvent: "workflow:resume_rejected",
  workflowId: "flow-1",
  runId: "run-1",
  t: 170,
  wait,
  resumeData: {},
  error: {
    name: "WorkflowResumeRejectedError",
    message: "approved: Required",
  } as never,
};
const workflowFinishEvent: SubscribeWorkflowProps = {
  workflowEvent: "workflow:finish",
  workflowId: "flow-1",
  runId: "run-1",
  t: 200,
  output: {},
};

describe("workflow-execution-events.utils", () => {
  it("restores persisted execution states after a refresh", () => {
    expect(
      restoreWorkflowExecutionStates({
        completed: {
          id: "0:completed",
          name: "completed",
          status: "completed",
          endedAt: 100,
        },
        failed: {
          id: "1:failed",
          name: "failed",
          status: "failed",
          startedAt: 110,
          endedAt: 120,
        },
        suspended: {
          id: "2:await_reply[1.2]",
          name: "await_reply",
          status: "suspended",
          endedAt: 130,
        },
      }),
    ).toEqual({
      "0:completed": [{ state: "finish", t: 100 }],
      "1:failed": [{ state: "error", t: 120 }],
      "2:await_reply": [{ state: "suspended", t: 130 }],
    });
  });

  it("maps workflow start to workflow start indicator", () => {
    expect(mapWorkflowEventToExecutionActions(workflowStartEvent)).toEqual([
      { type: "clear" },
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "start",
        t: 100,
      },
    ]);
  });

  it("maps step start to start-indicator finish and step start", () => {
    expect(mapWorkflowEventToExecutionActions(stepStartEvent)).toEqual([
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "finish",
        delayMs: START_INDICATOR_FINISH_DELAY_MS,
      },
      {
        type: "append",
        key: "0:send_message",
        state: "start",
        t: 110,
      },
    ]);
  });

  it("maps step success to delayed step finish transition", () => {
    expect(mapWorkflowEventToExecutionActions(stepSuccessEvent)).toEqual([
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "finish",
        delayMs: START_INDICATOR_FINISH_DELAY_MS,
      },
      {
        type: "append",
        key: "0:send_message",
        state: "finish",
        delayMs: STEP_SUCCESS_FINISH_DELAY_MS,
      },
    ]);
  });

  it("maps step cancellation to a cancelled state", () => {
    expect(mapWorkflowEventToExecutionActions(stepCancelledEvent)).toEqual([
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "finish",
        delayMs: START_INDICATOR_FINISH_DELAY_MS,
      },
      {
        type: "append",
        key: "0:send_message",
        state: "cancelled",
        t: 125,
      },
    ]);
  });

  it("maps a resumed step back to a started state", () => {
    expect(mapWorkflowEventToExecutionActions(stepResumedEvent)).toEqual([
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "finish",
        delayMs: START_INDICATOR_FINISH_DELAY_MS,
      },
      {
        type: "append",
        key: "0:send_message",
        state: "start",
        t: 150,
      },
    ]);
  });

  it("maps a refused step resume back to a suspended state", () => {
    expect(mapWorkflowEventToExecutionActions(stepResumeRejectedEvent)).toEqual(
      [
        {
          type: "append",
          key: EIndicatorType.WORKFLOW_START,
          state: "finish",
          delayMs: START_INDICATOR_FINISH_DELAY_MS,
        },
        {
          type: "append",
          key: "0:send_message",
          state: "suspended",
          t: 160,
        },
      ],
    );
  });

  it("leaves execution states untouched on a refused workflow resume", () => {
    expect(
      mapWorkflowEventToExecutionActions(workflowResumeRejectedEvent),
    ).toEqual([]);
  });

  it("normalizes loop iteration step ids before updating execution state", () => {
    expect(mapWorkflowEventToExecutionActions(loopStepStartEvent)).toEqual([
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "finish",
        delayMs: START_INDICATOR_FINISH_DELAY_MS,
      },
      {
        type: "append",
        key: "0.iterate.0:send_message",
        state: "start",
        t: 130,
      },
    ]);
  });

  it("applies loop step success immediately to avoid overriding next iteration state", () => {
    expect(mapWorkflowEventToExecutionActions(loopStepSuccessEvent)).toEqual([
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_START,
        state: "finish",
        delayMs: START_INDICATOR_FINISH_DELAY_MS,
      },
      {
        type: "append",
        key: "0.iterate.0:send_message",
        state: "finish",
        t: 140,
      },
    ]);
  });

  it("maps workflow finish to end indicator transitions then reset", () => {
    expect(mapWorkflowEventToExecutionActions(workflowFinishEvent)).toEqual([
      {
        type: "append",
        key: EIndicatorType.WORKFLOW_END,
        state: "start",
        t: 200,
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
    ]);
  });

  it("filters workflow events by active workflow id", () => {
    expect(isWorkflowEventForFlow(workflowStartEvent, "flow-1")).toBe(true);
    expect(isWorkflowEventForFlow(workflowStartEvent, "flow-2")).toBe(false);
    expect(isWorkflowEventForFlow(workflowStartEvent, undefined)).toBe(false);
    expect(
      isWorkflowEventForFlow(
        {
          ...workflowStartEvent,
          workflowId: undefined,
        },
        undefined,
      ),
    ).toBe(true);
  });

  it("detects step events that include a valid step id", () => {
    expect(isStepWorkflowEvent(stepStartEvent)).toBe(true);
    expect(isStepWorkflowEvent(workflowStartEvent)).toBe(false);
    expect(
      isStepWorkflowEvent({
        ...stepStartEvent,
        step: {
          ...stepInfo,
          id: "",
        },
      }),
    ).toBe(false);
  });
});

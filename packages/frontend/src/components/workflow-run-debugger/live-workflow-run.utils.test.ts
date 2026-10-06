/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus, StepType } from "@hexabot-ai/agentic";
import type { StepExecutionRecord, WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";
import { describe, expect, it } from "vitest";

import type { SubscribeWorkflowProps } from "@/websocket/types/workflow.types";

import {
  getResumeRejectionMessage,
  isWorkflowRunLiveEventForDebugger,
  mergeWorkflowRunLiveEvent,
  shouldWorkflowRunLiveEventTouchQuery,
} from "./live-workflow-run.utils";

const workflowId = "workflow-1";
const initiatorId = "user-1";
const runId = "run-1";
const buildRun = (overrides: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: runId,
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
    status: EWorkflowRunStatus.IDLE,
    workflow: workflowId,
    workflowVersion: null,
    triggeredBy: initiatorId,
    parentRun: null,
    input: {},
    output: null,
    context: {},
    snapshot: null,
    stepLog: null,
    checkpoint: null,
    error: null,
    suspendedAt: null,
    finishedAt: null,
    failedAt: null,
    duration: null,
    metadata: null,
    ...overrides,
  }) as WorkflowRun;
// The API never broadcasts the checkpoint.
const toBroadcastRun = ({
  checkpoint: _checkpoint,
  ...run
}: WorkflowRun): Omit<WorkflowRun, "checkpoint"> => run;
const buildEvent = (
  overrides: Partial<SubscribeWorkflowProps>,
): SubscribeWorkflowProps =>
  ({
    runId,
    workflowId,
    initiatorId,
    workflowRun: toBroadcastRun(buildRun()),
    workflowEvent: "workflow:start",
    t: 2000,
    ...overrides,
  }) as SubscribeWorkflowProps;
const awaitStep = { id: "0:await", name: "await", type: StepType.Task };
const buildWait = (overrides: Partial<WaitInfo> = {}): WaitInfo => ({
  waitId: "wait-1",
  step: awaitStep,
  suspendKey: "index:1",
  reason: "approval",
  data: { amount: 42 },
  ...overrides,
});
const buildStepExecution = (
  overrides: Partial<StepExecutionRecord> = {},
): StepExecutionRecord => ({
  id: "0:greet",
  name: "greet",
  action: "greet",
  status: "running",
  startedAt: 2100,
  input: { name: "Ada" },
  ...overrides,
});

describe("live workflow run utils", () => {
  it("merges a manual run event sequence into the WorkflowRun cache model", () => {
    const started = mergeWorkflowRunLiveEvent(
      undefined,
      buildEvent({ workflowEvent: "workflow:start", t: 2000 }),
    );
    const stepStarted = mergeWorkflowRunLiveEvent(
      started,
      buildEvent({
        workflowEvent: "step:start",
        t: 2100,
        step: { id: "0:greet", name: "greet", type: StepType.Task },
        stepExecution: buildStepExecution(),
      }),
    );
    const stepFinished = mergeWorkflowRunLiveEvent(
      stepStarted,
      buildEvent({
        workflowEvent: "step:success",
        t: 2400,
        step: { id: "0:greet", name: "greet", type: StepType.Task },
        stepExecution: buildStepExecution({
          status: "completed",
          endedAt: 2400,
          output: { ok: true },
        }),
      }),
    );
    const finished = mergeWorkflowRunLiveEvent(
      stepFinished,
      buildEvent({ workflowEvent: "workflow:finish", t: 2500 }),
    );

    expect(finished?.status).toBe(EWorkflowRunStatus.FINISHED);
    expect(finished?.workflow).toBe(workflowId);
    expect(finished?.triggeredBy).toBe(initiatorId);
    expect(finished?.finishedAt).toEqual(new Date(2500));
    expect(finished?.stepLog?.["0:greet"]).toEqual(
      expect.objectContaining({
        id: "0:greet",
        status: "completed",
        input: { name: "Ada" },
        output: { ok: true },
      }),
    );
  });

  it("merges scheduled workflow suspension events live", () => {
    const scheduledWorkflowId = "scheduled-workflow";
    const scheduledRun = buildRun({
      workflow: scheduledWorkflowId,
      input: { schedule: "*/5 * * * * *" },
    });
    const suspended = mergeWorkflowRunLiveEvent(
      scheduledRun,
      buildEvent({
        workflowId: scheduledWorkflowId,
        workflowRun: toBroadcastRun(scheduledRun),
        workflowEvent: "step:suspended",
        t: 3000,
        step: { id: "0:await", name: "await", type: StepType.Task },
        stepExecution: buildStepExecution({
          id: "0:await",
          name: "await",
          status: "suspended",
          endedAt: 3000,
          reason: "waiting",
        }),
      }),
    );

    expect(suspended?.status).toBe(EWorkflowRunStatus.SUSPENDED);
    expect(suspended?.suspendedAt).toEqual(new Date(3000));
    expect(suspended?.stepLog?.["0:await"]).toEqual(
      expect.objectContaining({
        status: "suspended",
        reason: "waiting",
      }),
    );
  });

  it("merges cancelled step events without marking the run terminal", () => {
    const runningRun = buildRun({
      status: EWorkflowRunStatus.RUNNING,
      stepLog: {
        "0:slow_branch": buildStepExecution({
          id: "0:slow_branch",
          name: "slow_branch",
          status: "running",
        }),
      },
    });
    const updated = mergeWorkflowRunLiveEvent(
      runningRun,
      buildEvent({
        workflowRun: toBroadcastRun(runningRun),
        workflowEvent: "step:cancelled",
        t: 3200,
        step: { id: "0:slow_branch", name: "slow_branch", type: StepType.Task },
        stepExecution: buildStepExecution({
          id: "0:slow_branch",
          name: "slow_branch",
          status: "cancelled",
          endedAt: 3200,
          error: { message: "Parallel wait_any branch lost the race." },
        }),
      }),
    );

    expect(updated?.status).toBe(EWorkflowRunStatus.RUNNING);
    expect(updated?.stepLog?.["0:slow_branch"]).toEqual(
      expect.objectContaining({
        status: "cancelled",
        error: { message: "Parallel wait_any branch lost the race." },
      }),
    );
  });

  it("marks a resumed step as running again", () => {
    const suspendedRun = buildRun({
      status: EWorkflowRunStatus.SUSPENDED,
      suspendedAt: new Date(3000),
      stepLog: {
        "0:await": buildStepExecution({
          id: "0:await",
          name: "await",
          status: "suspended",
          endedAt: 3000,
          reason: "approval",
        }),
      },
    });
    const resumed = mergeWorkflowRunLiveEvent(
      suspendedRun,
      buildEvent({
        workflowRun: toBroadcastRun(suspendedRun),
        workflowEvent: "step:resumed",
        t: 4000,
        step: awaitStep,
        wait: buildWait(),
        resumeData: { approved: true },
        stepExecution: buildStepExecution({
          id: "0:await",
          name: "await",
          status: "running",
          startedAt: 4000,
        }),
      }),
    );

    expect(resumed?.status).toBe(EWorkflowRunStatus.RUNNING);
    expect(resumed?.stepLog?.["0:await"]).toEqual(
      expect.objectContaining({ status: "running", startedAt: 4000 }),
    );
  });

  it("keeps the run suspended when a resume payload is refused", () => {
    const suspendedRun = buildRun({
      status: EWorkflowRunStatus.SUSPENDED,
      suspendedAt: new Date(3000),
      checkpoint: { waits: [buildWait()] },
    });
    const stepRejected = mergeWorkflowRunLiveEvent(
      { ...suspendedRun, status: EWorkflowRunStatus.RUNNING },
      buildEvent({
        workflowRun: toBroadcastRun(suspendedRun),
        workflowEvent: "step:resume_rejected",
        t: 4100,
        step: awaitStep,
        wait: buildWait(),
        stepExecution: buildStepExecution({
          id: "0:await",
          name: "await",
          status: "suspended",
          endedAt: 4100,
          reason: "approval",
        }),
      }),
    );
    const workflowRejected = mergeWorkflowRunLiveEvent(
      stepRejected,
      buildEvent({
        workflowRun: toBroadcastRun(suspendedRun),
        workflowEvent: "workflow:resume_rejected",
        t: 4200,
        wait: buildWait(),
        resumeData: { approved: "yes" },
      }),
    );

    expect(stepRejected?.status).toBe(EWorkflowRunStatus.SUSPENDED);
    expect(workflowRejected?.status).toBe(EWorkflowRunStatus.SUSPENDED);
    expect(workflowRejected?.suspendedAt).toEqual(new Date(3000));
    expect(workflowRejected?.checkpoint).toEqual({ waits: [buildWait()] });
  });

  it("refreshes the cached checkpoint waits from suspension events", () => {
    const resumedRun = buildRun({
      status: EWorkflowRunStatus.RUNNING,
      checkpoint: { version: 1, frames: [], waits: [buildWait()] },
    });
    const nextWait = buildWait({ waitId: "wait-2", reason: "second_review" });
    const suspended = mergeWorkflowRunLiveEvent(
      resumedRun,
      buildEvent({
        workflowRun: toBroadcastRun(resumedRun),
        workflowEvent: "workflow:suspended",
        t: 5000,
        waits: [nextWait],
      }),
    );

    expect(suspended?.status).toBe(EWorkflowRunStatus.SUSPENDED);
    expect(suspended?.checkpoint).toEqual({
      version: 1,
      frames: [],
      waits: [nextWait],
    });
  });

  it.each(["workflow:finish", "workflow:failure"] as const)(
    "clears the cached checkpoint on %s",
    (workflowEvent) => {
      const run = buildRun({
        status: EWorkflowRunStatus.RUNNING,
        checkpoint: { waits: [buildWait()] },
      });
      const ended = mergeWorkflowRunLiveEvent(
        run,
        buildEvent({
          workflowRun: toBroadcastRun(run),
          workflowEvent,
          t: 6000,
        }),
      );

      expect(ended?.checkpoint).toBeNull();
    },
  );

  it("reads the refusal message of resume_rejected events only", () => {
    expect(
      getResumeRejectionMessage(
        buildEvent({
          workflowEvent: "workflow:resume_rejected",
          wait: buildWait(),
          resumeData: {},
          error: {
            name: "WorkflowResumeRejectedError",
            message: "approved: Required",
          } as never,
        }),
      ),
    ).toBe("approved: Required");
    expect(
      getResumeRejectionMessage(
        buildEvent({ workflowEvent: "workflow:resume_rejected" }),
      ),
    ).toBe("");
    expect(
      getResumeRejectionMessage(buildEvent({ workflowEvent: "step:start" })),
    ).toBeUndefined();
  });

  it("filters and touches only matching debugger workflow run collections", () => {
    const event = buildEvent({ workflowEvent: "step:start" });

    expect(
      isWorkflowRunLiveEventForDebugger(event, workflowId, initiatorId),
    ).toBe(true);
    expect(
      isWorkflowRunLiveEventForDebugger(event, "other-workflow", initiatorId),
    ).toBe(false);
    expect(
      shouldWorkflowRunLiveEventTouchQuery(
        [
          "collection",
          "WorkflowRun",
          JSON.stringify({
            params: {
              where: {
                "workflow.id": workflowId,
                "triggeredBy.id": initiatorId,
              },
            },
          }),
        ],
        event,
      ),
    ).toBe(true);
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus, StepType } from "@hexabot-ai/agentic";
import type { WaitInfo } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import { getOpenWaits, getStepWaits } from "./utils";

const buildWait = (stepId: string, waitId = `${stepId}#wait`): WaitInfo => ({
  waitId,
  step: { id: stepId, name: stepId, type: StepType.Task },
  suspendKey: "index:1",
  reason: "approval",
});

describe("workflow run debugger utils", () => {
  describe("getOpenWaits", () => {
    const waits = [buildWait("0:review"), buildWait("1:approve")];

    it("reads the checkpoint waits of a suspended run", () => {
      expect(
        getOpenWaits({
          status: EWorkflowRunStatus.SUSPENDED,
          checkpoint: { version: 1, waits },
        }),
      ).toEqual(waits);
    });

    it.each([
      EWorkflowRunStatus.RUNNING,
      EWorkflowRunStatus.FINISHED,
      EWorkflowRunStatus.FAILED,
    ])("ignores the stale checkpoint of a %s run", (status) => {
      expect(getOpenWaits({ status, checkpoint: { waits } })).toEqual([]);
    });

    it("returns no waits without a usable checkpoint", () => {
      expect(getOpenWaits(undefined)).toEqual([]);
      expect(getOpenWaits(null)).toEqual([]);
      expect(
        getOpenWaits({
          status: EWorkflowRunStatus.SUSPENDED,
          checkpoint: null,
        }),
      ).toEqual([]);
      expect(
        getOpenWaits({
          status: EWorkflowRunStatus.SUSPENDED,
          checkpoint: { waits: "corrupted" },
        }),
      ).toEqual([]);
    });
  });

  describe("getStepWaits", () => {
    it("keeps the waits of one step instance", () => {
      const firstIteration = buildWait("0.loop.0:review[0]");
      const secondIteration = buildWait("0.loop.0:review[1]");

      expect(
        getStepWaits(
          [firstIteration, secondIteration, buildWait("1:approve")],
          "0.loop.0:review[1]",
        ),
      ).toEqual([secondIteration]);
    });
  });
});

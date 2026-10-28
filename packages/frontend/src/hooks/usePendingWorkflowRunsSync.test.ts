/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { EntityType, QueryType } from "@/services/types";

import {
  invalidatePendingWorkflowRuns,
  isListedAsPending,
  shouldRefreshPendingRuns,
} from "./usePendingWorkflowRunsSync";

const notListed = () => false;

describe("usePendingWorkflowRunsSync helpers", () => {
  describe("shouldRefreshPendingRuns", () => {
    it("refreshes when a run suspends on an admin wait", () => {
      expect(
        shouldRefreshPendingRuns(
          {
            entity: "workflowRun",
            op: "update",
            data: { id: "run-1", status: "suspended", awaitingOperator: true },
          },
          notListed,
        ),
      ).toBe(true);
    });

    it("refreshes when a pending run is claimed to resolve its wait", () => {
      expect(
        shouldRefreshPendingRuns(
          {
            entity: "workflowRun",
            op: "update",
            data: { id: "run-1", status: "running", awaitingOperator: true },
          },
          notListed,
        ),
      ).toBe(true);
    });

    it("refreshes when a listed run leaves the pending state", () => {
      expect(
        shouldRefreshPendingRuns(
          {
            entity: "workflowRun",
            op: "update",
            data: { id: "run-1", status: "failed", awaitingOperator: false },
          },
          (runId) => runId === "run-1",
        ),
      ).toBe(true);
    });

    it("ignores updates of runs that never waited on an admin", () => {
      expect(
        shouldRefreshPendingRuns(
          {
            entity: "workflowRun",
            op: "update",
            data: { id: "run-2", status: "running", awaitingOperator: false },
          },
          notListed,
        ),
      ).toBe(false);
    });

    it.each([
      ["creations", { entity: "workflowRun", op: "create" }],
      ["deletions", { entity: "workflowRun", op: "delete" }],
      ["other entities", { entity: "workflow", op: "update" }],
    ])("leaves %s to the entity subscription", (_label, event) => {
      expect(
        shouldRefreshPendingRuns(
          { ...event, data: { id: "run-1", awaitingOperator: true } },
          notListed,
        ),
      ).toBe(false);
    });
  });

  describe("pending queries", () => {
    const pendingCollectionKey = [
      QueryType.collection,
      EntityType.WORKFLOW_RUN_PENDING,
      JSON.stringify({ params: {} }),
    ];
    const pendingCountKey = [
      QueryType.count,
      EntityType.WORKFLOW_RUN_PENDING,
      JSON.stringify({}),
    ];
    const runsCollectionKey = [
      QueryType.collection,
      EntityType.WORKFLOW_RUN,
      JSON.stringify({ params: {} }),
    ];
    const setup = () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(pendingCollectionKey, ["run-1"]);
      queryClient.setQueryData(pendingCountKey, { count: 1 });
      queryClient.setQueryData(runsCollectionKey, ["run-1", "run-2"]);

      return queryClient;
    };

    it("finds the runs shown by a pending list", () => {
      const queryClient = setup();

      expect(isListedAsPending(queryClient, "run-1")).toBe(true);
      expect(isListedAsPending(queryClient, "run-2")).toBe(false);
    });

    it("invalidates the pending lists and counts only", async () => {
      const queryClient = setup();

      await invalidatePendingWorkflowRuns(queryClient);

      expect(
        queryClient.getQueryState(pendingCollectionKey)?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(pendingCountKey)?.isInvalidated).toBe(
        true,
      );
      expect(queryClient.getQueryState(runsCollectionKey)?.isInvalidated).toBe(
        false,
      );
    });
  });
});

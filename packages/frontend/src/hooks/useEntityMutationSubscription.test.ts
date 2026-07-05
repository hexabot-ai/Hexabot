/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { EntityType, QueryType } from "@/services/types";

import {
  hasMissingRelationRef,
  isThreadInfiniteQuery,
  mergeEntityCachePayload,
} from "./useEntityMutationSubscription";

describe("useEntityMutationSubscription helpers", () => {
  it("keeps populated thread relations when incoming payload has relation ids", () => {
    const previousData = {
      id: "thread-1",
      title: "Support",
      subscriber: { id: "sub-1", fullName: "Subscriber One" },
      source: { id: "source-1", name: "Main web" },
    };
    const nextEntityData = {
      id: "thread-1",
      status: "open",
      subscriber: "sub-1",
      source: "source-1",
    };
    const merged = mergeEntityCachePayload(
      EntityType.THREAD,
      previousData,
      nextEntityData,
    );

    expect(merged.subscriber).toEqual(previousData.subscriber);
    expect(merged.source).toEqual(previousData.source);
    expect(merged.status).toBe("open");
  });

  it("keeps newer live workflow run step state when a stale payload arrives", () => {
    const previousData = {
      id: "run-1",
      status: "finished",
      finishedAt: new Date(2500),
      stepLog: {
        "0:greet": {
          id: "0:greet",
          name: "greet",
          status: "completed",
          startedAt: 2100,
          endedAt: 2400,
        },
      },
    };
    const nextEntityData = {
      id: "run-1",
      status: "running",
      finishedAt: null,
      stepLog: null,
    };
    const merged = mergeEntityCachePayload(
      EntityType.WORKFLOW_RUN,
      previousData,
      nextEntityData,
    );

    expect(merged.status).toBe("finished");
    expect(merged.finishedAt).toEqual(previousData.finishedAt);
    expect(merged.stepLog).toEqual(previousData.stepLog);
  });

  it("detects a relation ref that is missing from the item cache", () => {
    const queryClient = new QueryClient();
    const workflowPayload = {
      id: "workflow-1",
      currentVersion: "version-1",
      publishedVersion: null,
    };

    expect(
      hasMissingRelationRef(queryClient, EntityType.WORKFLOW, workflowPayload),
    ).toBe(true);

    queryClient.setQueryData(
      [QueryType.item, EntityType.WORKFLOW_VERSION, "version-1"],
      { id: "version-1", definitionYml: "flow: []" },
    );

    expect(
      hasMissingRelationRef(queryClient, EntityType.WORKFLOW, workflowPayload),
    ).toBe(false);
  });

  it("ignores null and array relation values", () => {
    const queryClient = new QueryClient();

    expect(
      hasMissingRelationRef(queryClient, EntityType.WORKFLOW, {
        id: "workflow-1",
        currentVersion: null,
        publishedVersion: null,
      }),
    ).toBe(false);
    expect(
      hasMissingRelationRef(queryClient, EntityType.USER, {
        id: "user-1",
        roles: ["role-1"],
      }),
    ).toBe(false);
  });

  it("matches only infinite thread query keys for refetch", () => {
    expect(
      isThreadInfiniteQuery([QueryType.infinite, EntityType.THREAD, "{}"]),
    ).toBe(true);
    expect(
      isThreadInfiniteQuery([QueryType.collection, EntityType.THREAD, "{}"]),
    ).toBe(false);
    expect(
      isThreadInfiniteQuery([QueryType.infinite, EntityType.MESSAGE, "{}"]),
    ).toBe(false);
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  DirectionType,
  WorkflowType,
  type WorkflowImportResult,
} from "@hexabot-ai/types";
import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { ApiClient, ROUTES } from "./api.class";
import { EntityType } from "./types";

const createRequestMock = () => {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  } as unknown as AxiosInstance & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
  };
};

describe("ApiClient workflow import/export", () => {
  it("downloads exported workflow bundles as blobs", async () => {
    const request = createRequestMock();
    const blob = new Blob(["kind: hexabot.workflow.bundle"]);

    request.get.mockResolvedValueOnce({ data: { _csrf: "csrf-token" } });
    request.post.mockResolvedValueOnce({
      data: blob,
      headers: {
        "content-disposition": 'attachment; filename="Sales.workflow.yml"',
      },
    });

    const result = await new ApiClient(request).exportWorkflow("flow id");

    expect(request.post).toHaveBeenCalledWith(
      "/workflow/flow%20id/export",
      { _csrf: "csrf-token" },
      { responseType: "blob" },
    );
    expect(result).toEqual({
      blob,
      filename: "Sales.workflow.yml",
    });
  });

  it("posts strong passwords for encrypted credential exports", async () => {
    const request = createRequestMock();
    const blob = new Blob(["encrypted"]);

    request.get.mockResolvedValueOnce({ data: { _csrf: "csrf-token" } });
    request.post.mockResolvedValueOnce({ data: blob, headers: {} });

    await new ApiClient(request).exportWorkflow(
      "flow id",
      "StrongCredential#123",
    );

    expect(request.post).toHaveBeenCalledWith(
      "/workflow/flow%20id/export",
      { _csrf: "csrf-token", password: "StrongCredential#123" },
      { responseType: "blob" },
    );
  });

  it("uploads workflow import bundles with CSRF params", async () => {
    const request = createRequestMock();
    const importResult = {
      workflow: {
        id: "imported-workflow",
        createdAt: new Date("2026-05-05T00:00:00.000Z"),
        updatedAt: new Date("2026-05-05T00:00:00.000Z"),
        name: "Imported workflow",
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        builtin: false,
        createdBy: null,
        runAfterMs: 0,
        x: 0,
        y: 0,
        zoom: 1,
        direction: DirectionType.HORIZONTAL,
        currentVersion: null,
        publishedVersion: null,
      },
      resources: [],
      warnings: [],
      integrityVerified: true,
    } satisfies WorkflowImportResult;

    request.get.mockResolvedValueOnce({ data: { _csrf: "csrf-token" } });
    request.post.mockResolvedValueOnce({ data: importResult });

    const file = new File(["kind: hexabot.workflow.bundle"], "bundle.yml", {
      type: "application/x-yaml",
    });
    const result = await new ApiClient(request).importWorkflowBundle(
      file,
      "StrongCredential#123",
    );
    const [route, formData, config] = request.post.mock.calls[0];

    expect(request.get).toHaveBeenCalledWith("/csrftoken", {
      withCredentials: true,
    });
    expect(route).toBe("/workflow/import");
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get("password")).toBe("StrongCredential#123");
    expect(config).toEqual({ params: { _csrf: "csrf-token" } });
    expect(result).toBe(importResult);
  });
});

describe("RAG helper API route", () => {
  it("maps RagHelper autocomplete requests to /helper/rag", () => {
    expect(ROUTES[EntityType.RAG_HELPER]).toBe("/helper/rag");
  });
});

describe("ApiClient workflow run operator actions", () => {
  const run = { id: "run id", status: "finished" };
  const setup = () => {
    const request = createRequestMock();

    request.get.mockResolvedValueOnce({ data: { _csrf: "csrf-token" } });
    request.patch.mockResolvedValueOnce({ data: run });

    return { request, client: new ApiClient(request) };
  };

  it("approves a wait with its comment", async () => {
    const { request, client } = setup();
    const result = await client.approveWorkflowRun("run id", {
      waitId: "step@index:0",
      comment: "Looks good",
    });

    expect(request.patch).toHaveBeenCalledWith(
      "/workflowrun/run%20id/approve",
      { waitId: "step@index:0", comment: "Looks good", _csrf: "csrf-token" },
    );
    expect(result).toBe(run);
  });

  it("rejects a wait without sending an empty comment", async () => {
    const { request, client } = setup();

    await client.rejectWorkflowRun("run-1", { waitId: "w1", comment: "" });

    expect(request.patch).toHaveBeenCalledWith("/workflowrun/run-1/reject", {
      waitId: "w1",
      _csrf: "csrf-token",
    });
  });

  it("resumes a wait with its data", async () => {
    const { request, client } = setup();

    await client.resumeWorkflowRun("run-1", {
      waitId: "w1",
      data: { reference: "ABC" },
    });

    expect(request.patch).toHaveBeenCalledWith("/workflowrun/run-1/resume", {
      waitId: "w1",
      data: { reference: "ABC" },
      _csrf: "csrf-token",
    });
  });

  it("cancels a run with an optional reason", async () => {
    const { request, client } = setup();

    await client.cancelWorkflowRun("run-1", { reason: "Duplicate" });

    expect(request.patch).toHaveBeenCalledWith("/workflowrun/run-1/cancel", {
      reason: "Duplicate",
      _csrf: "csrf-token",
    });
  });

  it("maps pending runs to /workflowrun/pending", () => {
    expect(ROUTES[EntityType.WORKFLOW_RUN_PENDING]).toBe(
      "/workflowrun/pending",
    );
  });
});

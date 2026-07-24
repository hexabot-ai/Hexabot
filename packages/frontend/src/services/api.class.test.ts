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
  } as unknown as AxiosInstance & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };
};

describe("ApiClient workflow import/export", () => {
  it("downloads exported workflow bundles as blobs", async () => {
    const request = createRequestMock();
    const blob = new Blob(["kind: hexabot.workflow.bundle"]);

    request.get.mockResolvedValue({
      data: blob,
      headers: {
        "content-disposition": 'attachment; filename="Sales.workflow.yml"',
      },
    });

    const result = await new ApiClient(request).exportWorkflow("flow id");

    expect(request.get).toHaveBeenCalledWith("/workflow/flow%20id/export", {
      responseType: "blob",
    });
    expect(result).toEqual({
      blob,
      filename: "Sales.workflow.yml",
    });
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
        inputSchema: {},
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
    } satisfies WorkflowImportResult;

    request.get.mockResolvedValueOnce({ data: { _csrf: "csrf-token" } });
    request.post.mockResolvedValueOnce({ data: importResult });

    const file = new File(["kind: hexabot.workflow.bundle"], "bundle.yml", {
      type: "application/x-yaml",
    });
    const result = await new ApiClient(request).importWorkflowBundle(file);
    const [route, formData, config] = request.post.mock.calls[0];

    expect(request.get).toHaveBeenCalledWith("/csrftoken", {
      withCredentials: true,
    });
    expect(route).toBe("/workflow/import");
    expect(formData).toBeInstanceOf(FormData);
    expect(config).toEqual({ params: { _csrf: "csrf-token" } });
    expect(result).toBe(importResult);
  });
});

describe("RAG helper API route", () => {
  it("maps RagHelper autocomplete requests to /helper/rag", () => {
    expect(ROUTES[EntityType.RAG_HELPER]).toBe("/helper/rag");
  });
});

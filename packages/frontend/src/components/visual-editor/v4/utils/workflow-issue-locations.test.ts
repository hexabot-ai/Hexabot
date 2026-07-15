/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import type { WorkflowIssue } from "../types/workflow.types";

import { uniqueIssueLocations } from "./workflow-issue-locations";

const makeIssue = (issue: Partial<WorkflowIssue>): WorkflowIssue =>
  ({
    code: "schema",
    message: "issue",
    rawMessage: "issue",
    ...issue,
  }) as WorkflowIssue;
const yaml = [
  "defs:", // 1
  "  greet:", // 2
  "    kind: task", // 3
  "    action: missing_action", // 4
  "flow:", // 5
  "  - do: greet", // 6
  "  - do: ghost_task", // 7
  "outputs:", // 8
  '  result: "=true"', // 9
].join("\n");

describe("uniqueIssueLocations", () => {
  it("resolves each issue path to its 1-based YAML line", () => {
    const result = uniqueIssueLocations(yaml, [
      makeIssue({
        code: "missing_action",
        message: 'The "missing_action" action is not available',
        path: ["defs", "greet", "action"],
      }),
      makeIssue({
        code: "unknown_task",
        message: "Unknown task(s) referenced in flow: ghost_task",
        path: ["flow", 1, "do"],
      }),
    ]);

    expect(result).toEqual([
      {
        message: 'The "missing_action" action is not available',
        line: 4,
      },
      {
        message: "Unknown task(s) referenced in flow: ghost_task",
        line: 7,
      },
    ]);
  });

  it("deduplicates by message, keeping the first occurrence's line", () => {
    const result = uniqueIssueLocations(yaml, [
      makeIssue({
        code: "missing_action",
        message: "same message",
        path: ["defs", "greet", "action"],
      }),
      makeIssue({
        code: "missing_action",
        message: "same message",
        path: ["flow", 1, "do"],
      }),
    ]);

    expect(result).toEqual([{ message: "same message", line: 4 }]);
  });

  it("omits the line when the issue has no path", () => {
    const result = uniqueIssueLocations(yaml, [
      makeIssue({ code: "catalog_error", message: "catalog down" }),
    ]);

    expect(result).toEqual([{ message: "catalog down", line: undefined }]);
  });

  it("omits lines when the YAML has syntax errors", () => {
    const result = uniqueIssueLocations("defs: [ unclosed", [
      makeIssue({
        code: "missing_action",
        message: "still shown",
        path: ["defs", "greet", "action"],
      }),
    ]);

    expect(result).toEqual([{ message: "still shown", line: undefined }]);
  });
});

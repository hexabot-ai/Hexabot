/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowIssue } from "../../../types/workflow.types";
import { YAML_WORKFLOW_VALIDATION_OWNER } from "../constants";

import { applyWorkflowValidationMarkers } from "./validation";

const makeEditorMocks = () => {
  const setModelMarkers = vi.fn();
  const model = {} as editor.ITextModel;
  const editorInstance = {
    getModel: () => model,
  } as editor.IStandaloneCodeEditor;
  const monacoInstance = {
    MarkerSeverity: {
      Error: 8,
    },
    editor: {
      setModelMarkers,
    },
  } as unknown as Monaco;

  return { setModelMarkers, model, editorInstance, monacoInstance };
};
const yaml = [
  "defs:",
  "  task_alpha:",
  "    kind: task",
  "    action: missing_action",
  "flow:",
  "  - do: task_alpha",
  "outputs:",
  '  result: "=$output.task_alpha"',
].join("\n");

describe("yaml validation markers", () => {
  it("targets issue markers at their yaml paths", () => {
    const { setModelMarkers, model, editorInstance, monacoInstance } =
      makeEditorMocks();
    const issues: WorkflowIssue[] = [
      {
        code: "missing_action",
        message: 'The "missing_action" action is not available on this server.',
        rawMessage:
          'defs.task_alpha.action: No action implementation provided for "missing_action".',
        path: ["defs", "task_alpha", "action"],
        actionName: "missing_action",
      },
    ];

    applyWorkflowValidationMarkers({
      editorInstance,
      monacoInstance,
      yaml,
      issues,
    });

    expect(setModelMarkers).toHaveBeenCalledTimes(1);
    const [targetModel, owner, markers] = setModelMarkers.mock.calls[0] as [
      editor.ITextModel,
      string,
      editor.IMarkerData[],
    ];

    expect(targetModel).toBe(model);
    expect(owner).toBe(YAML_WORKFLOW_VALIDATION_OWNER);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.message).toBe(issues[0].message);
    expect(markers[0]?.startLineNumber).toBe(4);
    expect((markers[0]?.endLineNumber ?? 0) >= 4).toBe(true);
  });

  it("skips issues without a path and non-JSONata schema issues", () => {
    const { setModelMarkers, editorInstance, monacoInstance } =
      makeEditorMocks();
    const issues: WorkflowIssue[] = [
      {
        code: "catalog_error",
        message: "The action catalog could not be loaded from the server.",
        rawMessage: "Failed to load the workflow catalogs from the server.",
      },
      {
        code: "schema",
        message: "defs.task_alpha.kind: Invalid literal value",
        rawMessage: "defs.task_alpha.kind: Invalid literal value",
        path: ["defs", "task_alpha", "kind"],
      },
    ];

    applyWorkflowValidationMarkers({
      editorInstance,
      monacoInstance,
      yaml,
      issues,
    });

    const markers = setModelMarkers.mock.calls[0]?.[2] as editor.IMarkerData[];

    expect(markers).toHaveLength(0);
  });

  it("targets the nearest existing parent for a missing required field", () => {
    const { setModelMarkers, editorInstance, monacoInstance } =
      makeEditorMocks();
    const issues: WorkflowIssue[] = [
      {
        actionName: "missing_action",
        code: "action_inputs",
        message:
          'defs.task_alpha.inputs.recipient: requires property "recipient"',
        path: ["defs", "task_alpha", "inputs", "recipient"],
        rawMessage:
          'defs.task_alpha.inputs.recipient: requires property "recipient"',
        taskId: "task_alpha",
      },
    ];

    applyWorkflowValidationMarkers({
      editorInstance,
      monacoInstance,
      yaml,
      issues,
    });

    const markers = setModelMarkers.mock.calls[0]?.[2] as editor.IMarkerData[];

    expect(markers).toHaveLength(1);
    expect(markers[0]?.startLineNumber).toBeGreaterThan(1);
  });
});

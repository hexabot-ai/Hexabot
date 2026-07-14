/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { LineCounter, parseDocument } from "yaml";

import type { WorkflowIssue } from "../../../types/workflow.types";
import { YAML_WORKFLOW_VALIDATION_OWNER } from "../constants";

import { getRangeForPath, type ReferencePath } from "./validation.paths";

type ApplyWorkflowValidationMarkersOptions = {
  editorInstance: editor.IStandaloneCodeEditor | null;
  monacoInstance: Monaco | null;
  yaml: string;
  /** Centralized validation issues; each issue with a path becomes a marker. */
  issues?: WorkflowIssue[];
};
// YAML paths only support string/number keys, so drop symbol segments.
const toReferencePath = (path: readonly PropertyKey[]): ReferencePath =>
  path.filter(
    (segment): segment is string | number =>
      typeof segment === "string" || typeof segment === "number",
  );
// Zod "schema" issues other than JSONata expression errors are already
// underlined by monaco-yaml's own JSON-schema validation; re-marking them
// would double-report. Every other issue code adds signal.
const shouldMarkIssue = (issue: WorkflowIssue): boolean =>
  Boolean(issue.path) &&
  (issue.code !== "schema" ||
    issue.rawMessage.includes("Invalid JSONata expression"));

export const applyWorkflowValidationMarkers = ({
  editorInstance,
  monacoInstance,
  yaml,
  issues = [],
}: ApplyWorkflowValidationMarkersOptions) => {
  if (!editorInstance || !monacoInstance) return;
  const model = editorInstance.getModel();

  if (!model) return;

  // Build a YAML AST so validation errors can be mapped to source locations.
  const lineCounter = new LineCounter();
  const doc = parseDocument(yaml, { lineCounter });

  if (doc.errors.length > 0) {
    // YAML syntax issues are surfaced elsewhere, so clear workflow markers here.
    monacoInstance.editor.setModelMarkers(
      model,
      YAML_WORKFLOW_VALIDATION_OWNER,
      [],
    );

    return;
  }

  const markers: editor.IMarkerData[] = [];

  // Centralized validation issues (missing actions, unknown tasks, binding
  // problems, JSONata errors, …) mapped to their source locations.
  issues.forEach((issue) => {
    if (!shouldMarkIssue(issue) || !issue.path) return;

    markers.push({
      ...getRangeForPath(doc, toReferencePath(issue.path), lineCounter),
      message: issue.message,
      severity: monacoInstance.MarkerSeverity.Error,
    });
  });

  monacoInstance.editor.setModelMarkers(
    model,
    YAML_WORKFLOW_VALIDATION_OWNER,
    markers,
  );
};

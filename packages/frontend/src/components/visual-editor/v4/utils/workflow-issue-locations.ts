/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowGraphIssue } from "@hexabot-ai/graph";
import { LineCounter, parseDocument } from "yaml";

import { getRangeForPath } from "../components/yaml-editor/validation/validation.paths";
import type { WorkflowIssue } from "../types/workflow.types";

/**
 * Deduplicated issues for the graph error panel, each resolved to the 1-based
 * YAML line it points at when possible (so the panel can offer a jump-to-line
 * link). Falls back to no line when the YAML can't be parsed or the issue has
 * no locatable path.
 */
export const uniqueIssueLocations = (
  yaml: string,
  issues: WorkflowIssue[],
): WorkflowGraphIssue[] => {
  const lineCounter = new LineCounter();
  const doc = parseDocument(yaml, { lineCounter });
  // A YAML syntax error makes node offsets unreliable, so don't guess a line.
  const canLocate = doc.errors.length === 0;
  const seen = new Set<string>();
  const locations: WorkflowGraphIssue[] = [];

  for (const issue of issues) {
    if (seen.has(issue.message)) {
      continue;
    }

    seen.add(issue.message);

    const line =
      canLocate && issue.path
        ? getRangeForPath(doc, issue.path, lineCounter).startLineNumber
        : undefined;

    locations.push({ message: issue.message, line });
  }

  return locations;
};

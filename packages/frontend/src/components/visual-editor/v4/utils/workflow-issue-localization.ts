/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { TTranslateProps } from "@/i18n/i18n.types";

import type { RawWorkflowIssue, WorkflowIssue } from "../types/workflow.types";

const localizeIssueMessage = (
  issue: RawWorkflowIssue,
  t: TTranslateProps,
): string => {
  switch (issue.code) {
    case "missing_action":
      return issue.actionName
        ? t("visual_editor.workflow_graph.missing_action", {
            0: issue.actionName,
          })
        : issue.message;
    case "catalog_error":
      return t("visual_editor.workflow_graph.catalog_error");
    default:
      // Unmapped codes fall back to the raw validator message.
      return issue.message;
  }
};

/**
 * Turn raw validation issues into display-ready ones: localized `message`,
 * original validator string preserved as `rawMessage`. Every issue is kept
 * (including e.g. the same missing action reported by several defs) so
 * consumers that need per-occurrence paths, like Monaco markers, can use
 * them all; list renderers should display `uniqueIssueMessages` instead.
 */
export const localizeWorkflowIssues = (
  issues: RawWorkflowIssue[],
  t: TTranslateProps,
): WorkflowIssue[] =>
  issues.map((issue) => ({
    ...issue,
    rawMessage: issue.message,
    message: localizeIssueMessage(issue, t),
  }));

/**
 * Deduplicated localized messages, for the graph error panel and the YAML
 * editor alert (the same missing action referenced by two defs yields one
 * line).
 */
export const uniqueIssueMessages = (issues: WorkflowIssue[]): string[] =>
  Array.from(new Set(issues.map((issue) => issue.message)));

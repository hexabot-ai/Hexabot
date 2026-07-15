/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ArrowUpRight, TriangleAlert } from "lucide-react";

import { useWorkflowGraphHost } from "../contexts/workflow-graph-host.context";

import type { WorkflowGraphIssue } from "./WorkflowGraph";

type WorkflowErrorStateProps = {
  issues: WorkflowGraphIssue[];
};

export const WorkflowErrorState = ({ issues }: WorkflowErrorStateProps) => {
  const { translate, onOpenYamlEditor } = useWorkflowGraphHost();

  return (
    <div className="workflow-error-overlay" role="alert">
      <div className="workflow-error-panel">
        <div className="workflow-error-header">
          <span className="workflow-error-badge" aria-hidden="true">
            <TriangleAlert className="workflow-error-icon" />
          </span>
          <div className="workflow-error-heading">
            <div className="workflow-error-title">
              {translate("visual_editor.workflow_graph.invalid_workflow")}
            </div>
            <p className="workflow-error-subtitle">
              {translate("visual_editor.workflow_graph.invalid_workflow_hint")}
            </p>
          </div>
          <span className="workflow-error-count">
            {translate("visual_editor.workflow_graph.issue_count", {
              count: issues.length,
            })}
          </span>
        </div>
        <ul className="workflow-error-list">
          {issues.map((issue, index) => {
            const canJumpToLine =
              onOpenYamlEditor !== undefined && issue.line !== undefined;

            return (
              <li
                className="workflow-error-row"
                key={`${issue.message}:${index}`}
              >
                <span className="workflow-error-marker" aria-hidden="true" />
                <span className="workflow-error-message">{issue.message}</span>
                {canJumpToLine ? (
                  <button
                    type="button"
                    className="workflow-error-goto"
                    onClick={() => onOpenYamlEditor?.(issue.line)}
                    title={translate(
                      "visual_editor.workflow_graph.go_to_line",
                      { 0: issue.line as number },
                    )}
                  >
                    {translate("visual_editor.workflow_graph.line_label", {
                      0: issue.line as number,
                    })}
                    <ArrowUpRight className="workflow-error-goto-icon" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {onOpenYamlEditor ? (
          <button
            type="button"
            className="workflow-error-cta"
            onClick={() => onOpenYamlEditor()}
          >
            {translate("visual_editor.workflow_graph.open_yaml_editor")}
            <ArrowUpRight className="workflow-error-cta-icon" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { TriangleAlert } from "lucide-react";

import { useWorkflowGraphHost } from "../contexts/workflow-graph-host.context";

type WorkflowErrorStateProps = {
  issues: string[];
};

export const WorkflowErrorState = ({ issues }: WorkflowErrorStateProps) => {
  const { translate, onOpenYamlEditor } = useWorkflowGraphHost();

  return (
    <div className="workflow-error-overlay" role="alert">
      <div className="workflow-error-panel">
        <div className="workflow-error-title">
          <TriangleAlert className="workflow-error-icon" />
          {translate("visual_editor.workflow_graph.invalid_workflow")}
        </div>
        <ul className="workflow-error-list">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        {onOpenYamlEditor ? (
          <button
            type="button"
            className="workflow-error-cta"
            onClick={onOpenYamlEditor}
          >
            {translate("visual_editor.workflow_graph.open_yaml_editor")}
          </button>
        ) : null}
      </div>
    </div>
  );
};

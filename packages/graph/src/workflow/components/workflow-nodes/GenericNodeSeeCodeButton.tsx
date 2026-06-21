/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Code } from "lucide-react";
import { useCallback, type MouseEvent } from "react";

import { useWorkflowGraphHost } from "../../contexts/workflow-graph-host.context";
import { useWorkflowNode } from "../../hooks/useWorkflowNode";

const BASE_CLASS =
  "nodrag nopan workflow-node-see-code workflow-node-see-code-button";

export const GenericNodeSeeCodeButton = () => {
  const { translate, onViewNodeCode, activeCodeDefName } =
    useWorkflowGraphHost();
  const { taskName, bindingName, stepPath } = useWorkflowNode();
  const defName = bindingName ?? taskName;
  const isActive = !!defName && activeCodeDefName === defName;
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (defName) {
        onViewNodeCode?.(defName);
      }
    },
    [defName, onViewNodeCode],
  );

  if (!defName || !stepPath) {
    return null;
  }

  return (
    <button
      type="button"
      className={`${BASE_CLASS}${isActive ? " workflow-node-see-code-button--active" : ""}`}
      aria-label={translate("button.see_definition")}
      aria-pressed={isActive}
      title={translate("button.see_definition")}
      onClick={handleClick}
    >
      <Code size={14} />
    </button>
  );
};

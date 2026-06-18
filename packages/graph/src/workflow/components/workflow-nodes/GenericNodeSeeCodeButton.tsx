/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Code } from "lucide-react";
import { useCallback, type MouseEvent } from "react";

import { useWorkflowGraphHost } from "../../contexts/workflow-graph-host.context";
import { useWorkflowNode } from "../../hooks/useWorkflowNode";

export const GenericNodeSeeCodeButton = () => {
  const { translate, onViewNodeCode, activeCodeDefName } =
    useWorkflowGraphHost();
  const { taskName, bindingName, stepPath } = useWorkflowNode();
  const defName = bindingName ?? taskName;
  const isVisible = !!defName && !!stepPath;
  const isActive = !!defName && activeCodeDefName === defName;
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (!defName) {
        return;
      }

      onViewNodeCode?.(defName);
    },
    [defName, onViewNodeCode],
  );

  if (!isVisible) {
    return null;
  }

  const label = translate("button.see_definition");

  return (
    <button
      type="button"
      className={`nodrag nopan workflow-node-see-code workflow-node-see-code-button${isActive ? " workflow-node-see-code-button--active" : ""}`}
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      onClick={handleClick}
    >
      <Code size={14} />
    </button>
  );
};

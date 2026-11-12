/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Trash2 } from "lucide-react";
import { useCallback, useMemo, type MouseEvent } from "react";

import { useWorkflowGraphHost } from "../../contexts/workflow-graph-host.context";
import { useWorkflowNode } from "../../hooks/useWorkflowNode";
import { ENodeType } from "../../types/workflow-node.types";
import { getBindingRemovalPayload } from "../../utils/workflow-binding.utils";

export const GenericNodeDeleteButton = () => {
  const { translate, onRemoveStep, onRemoveBinding } = useWorkflowGraphHost();
  const {
    id,
    type,
    stepId,
    stepPath,
    ownerDefName,
    ownerBindingKind,
    bindingKind,
    bindingName,
  } = useWorkflowNode();
  const bindingRemoval = useMemo(
    () =>
      onRemoveBinding
        ? getBindingRemovalPayload(id, {
            stepId,
            stepPath,
            ownerDefName,
            ownerBindingKind,
            bindingKind,
            bindingName,
          })
        : undefined,
    [
      bindingKind,
      bindingName,
      id,
      onRemoveBinding,
      ownerBindingKind,
      ownerDefName,
      stepId,
      stepPath,
    ],
  );
  const removableStepPath =
    type === ENodeType.TASK || type === ENodeType.OPERATOR
      ? stepPath
      : undefined;
  const handleDelete = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (bindingRemoval) {
        onRemoveBinding?.(bindingRemoval);
      } else if (removableStepPath) {
        onRemoveStep(removableStepPath, id);
      }
    },
    [bindingRemoval, id, onRemoveBinding, onRemoveStep, removableStepPath],
  );

  if (!bindingRemoval && !removableStepPath) {
    return null;
  }

  const label = translate("button.delete");

  return (
    <button
      type="button"
      className="nodrag nopan workflow-node-delete workflow-node-delete-button"
      aria-label={label}
      title={label}
      onClick={handleDelete}
    >
      <Trash2 size={14} />
    </button>
  );
};

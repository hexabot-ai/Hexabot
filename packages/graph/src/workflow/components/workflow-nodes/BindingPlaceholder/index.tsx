/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { useCallback, useMemo, type FC, type MouseEvent } from "react";

import { useWorkflowGraphHost } from "../../../contexts/workflow-graph-host.context";
import { WorkflowNodeProvider } from "../../../providers/WorkflowNodeProvider";
import { ENodeType, type GraphNode } from "../../../types/workflow-node.types";
import { getBindingAddPayload } from "../../../utils/workflow-binding.utils";
import { PulseIconButton } from "../../PulseIconButton";
import { GenericNodeContainer } from "../GenericNodeContainer";
import { GenericNodePorts } from "../GenericNodePorts";

export const BindingPlaceholder: FC<
  NodeProps<GraphNode<ENodeType.BINDING_PLACEHOLDER>>
> = (props) => {
  const { id, data } = props;
  const { translate, onAddBinding } = useWorkflowGraphHost();
  const stepId = data?.stepId;
  const stepPath = data?.stepPath;
  const ownerDefName = data?.ownerDefName;
  const bindingKind = data?.bindingKind;
  const bindingAddition = useMemo(
    () =>
      onAddBinding
        ? getBindingAddPayload(id, {
            stepId,
            stepPath,
            ownerDefName,
            bindingKind,
          })
        : undefined,
    [bindingKind, id, onAddBinding, ownerDefName, stepId, stepPath],
  );
  const addLabel = translate("button.add");
  const handleAddBinding = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (bindingAddition) {
        onAddBinding?.(bindingAddition);
      }
    },
    [bindingAddition, onAddBinding],
  );

  return (
    <WorkflowNodeProvider node={props}>
      <GenericNodeContainer>
        <div className="workflow-branch-placeholder workflow-binding-placeholder nodrag nopan">
          <PulseIconButton
            type="button"
            tabIndex={-1}
            size={32}
            className="workflow-binding-placeholder__pulse"
            aria-label={addLabel}
            title={addLabel}
            onClick={handleAddBinding}
            disabled={!bindingAddition}
          >
            <Plus size={18} />
          </PulseIconButton>
        </div>
        <GenericNodePorts />
      </GenericNodeContainer>
    </WorkflowNodeProvider>
  );
};

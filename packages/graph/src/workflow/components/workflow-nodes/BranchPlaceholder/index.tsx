/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import type { FC } from "react";

import { useWorkflowGraphHost } from "../../../contexts/workflow-graph-host.context";
import {
  useOpenInsertMenuHandler,
  useWorkflowInsertMenu,
} from "../../../contexts/workflow-insert-menu.context";
import { WorkflowNodeProvider } from "../../../providers/WorkflowNodeProvider";
import {
  ELinkType,
  ENodeType,
  type GraphNode,
} from "../../../types/workflow-node.types";
import { PulseIconButton } from "../../PulseIconButton";
import { GenericNodeContainer } from "../GenericNodeContainer";
import { GenericNodePorts } from "../GenericNodePorts";

export const BranchPlaceholder: FC<
  NodeProps<GraphNode<ENodeType.BRANCH_PLACEHOLDER>>
> = (props) => {
  const { data } = props;
  const { translate } = useWorkflowGraphHost();
  const { onOpenInsertMenu } = useWorkflowInsertMenu();
  const addLabel = translate("button.add");
  const insertPath = data?.insertPath;
  const canInsert = Boolean(insertPath && onOpenInsertMenu);
  const handleOpenInsertMenu = useOpenInsertMenuHandler(insertPath);

  return (
    <WorkflowNodeProvider node={props}>
      <GenericNodeContainer>
        <div className="workflow-branch-placeholder nodrag nopan">
          <PulseIconButton
            type="button"
            tabIndex={-1}
            size={32}
            className="workflow-branch-placeholder__pulse"
            aria-label={addLabel}
            aria-haspopup="menu"
            onClick={handleOpenInsertMenu}
            disabled={!canInsert}
          >
            <Plus size={18} />
          </PulseIconButton>
        </div>
        <GenericNodePorts<ENodeType.BRANCH_PLACEHOLDER>
          getDisabled={({ port, node }) =>
            port === ELinkType.BRANCH_PLACEHOLDER_OUT && !!node.groupName
          }
        />
      </GenericNodeContainer>
    </WorkflowNodeProvider>
  );
};

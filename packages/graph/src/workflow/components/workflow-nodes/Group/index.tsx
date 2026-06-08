/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type NodeProps } from "@xyflow/react";
import { type FC } from "react";

import { useWorkflowGraphHost } from "../../../contexts/workflow-graph-host.context";
import { WorkflowNodeProvider } from "../../../providers/WorkflowNodeProvider";
import { ENodeType, type GraphNode } from "../../../types/workflow-node.types";
import { GenericNodeContainer } from "../GenericNodeContainer";
import { GenericNodePorts } from "../GenericNodePorts";

export const Group: FC<NodeProps<GraphNode<ENodeType.GROUP>>> = (props) => {
  const { direction } = useWorkflowGraphHost();

  return (
    <WorkflowNodeProvider node={props}>
      <div
        style={
          direction === "horizontal"
            ? {
                width: "calc(100% + 26px)",
                height: "100%",
                marginLeft: "-13px",
              }
            : { height: "calc(100% + 26px)", width: "100%", marginTop: "-13px" }
        }
      >
        <GenericNodeContainer>
          <GenericNodePorts />
        </GenericNodeContainer>
      </div>
    </WorkflowNodeProvider>
  );
};

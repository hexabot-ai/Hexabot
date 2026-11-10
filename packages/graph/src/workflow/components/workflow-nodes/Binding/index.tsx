/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { NodeProps } from "@xyflow/react";
import type { FC } from "react";

import { WorkflowNodeProvider } from "../../../providers/WorkflowNodeProvider";
import { ENodeType, type GraphNode } from "../../../types/workflow-node.types";
import { GenericNodeContainer } from "../GenericNodeContainer";
import { GenericNodeDescription } from "../GenericNodeDescription";
import { GenericNodePorts } from "../GenericNodePorts";
import { GenericNodeRightContent } from "../GenericNodeRightContent";
import { GenericNodeTitle } from "../GenericNodeTitle";

export const Binding: FC<
  NodeProps<GraphNode<ENodeType.BINDING_SINGLE | ENodeType.BINDING_MULTI>>
> = (props) => {
  const { data } = props;
  const hasDescription = Boolean(data?.description?.trim());

  return (
    <WorkflowNodeProvider node={props}>
      <GenericNodeContainer className="workflow-node-shell--interactive">
        <GenericNodeRightContent
          variant={hasDescription ? "title-with-description" : "title-only"}
        >
          <GenericNodeTitle />
          {hasDescription ? <GenericNodeDescription /> : null}
        </GenericNodeRightContent>
        <GenericNodePorts />
      </GenericNodeContainer>
    </WorkflowNodeProvider>
  );
};

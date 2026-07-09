/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import {
  applySpreadDeltas,
  getNodeAxisCenter,
  indexNodes,
  isHorizontalDirection,
  type LayoutContext,
} from "./geometry";
import { getExistingNodes } from "./graph-maps";

export const alignGroupBoundaryNodesToGroupAxis = (
  nodes: GraphNode[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
) => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = indexNodes(nodes);
  const deltas = new Map<string, number>();

  groups.forEach((group) => {
    const groupNode = nodesById.get(group.id);

    if (!groupNode) {
      return;
    }

    const groupAxis = getNodeAxisCenter(groupNode, ctx, isVertical, "spread");
    const groupNodes = getExistingNodes(group.memberNodeIds, nodesById).filter(
      (node) => (node.data as { groupName?: string }).groupName === group.id,
    );
    const placeholders = groupNodes.filter(
      (node) => node.type === ENodeType.BRANCH_PLACEHOLDER,
    );

    if (placeholders.length !== 1) {
      return;
    }

    const boundaryNodes = [
      ...groupNodes.filter((node) => node.type === ENodeType.OPERATOR),
      ...placeholders,
    ];

    boundaryNodes.forEach((node) => {
      const delta =
        groupAxis - getNodeAxisCenter(node, ctx, isVertical, "spread");

      if (Math.abs(delta) >= 1) {
        deltas.set(node.id, delta);
      }
    });
  });

  return applySpreadDeltas(nodes, deltas, isVertical);
};

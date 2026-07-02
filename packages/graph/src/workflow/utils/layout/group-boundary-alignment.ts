/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import {
  getAxisCenter,
  getGraphNodeDimensions,
  isHorizontalDirection,
  type LayoutContext,
  translateSpread,
} from "./geometry";

export const alignGroupBoundaryNodesToGroupAxis = (
  nodes: GraphNode[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
) => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const deltas = new Map<string, number>();

  groups.forEach((group) => {
    const groupNode = nodesById.get(group.id);

    if (!groupNode) {
      return;
    }

    const groupAxis = getAxisCenter(
      groupNode.position,
      getGraphNodeDimensions(groupNode, ctx),
      isVertical,
      "spread",
    );
    const groupNodes = [...group.memberNodeIds]
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is GraphNode => {
        if (!node) {
          return false;
        }

        return (node.data as { groupName?: string }).groupName === group.id;
      });
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
        groupAxis -
        getAxisCenter(
          node.position,
          getGraphNodeDimensions(node, ctx),
          isVertical,
          "spread",
        );

      if (Math.abs(delta) >= 1) {
        deltas.set(node.id, delta);
      }
    });
  });

  return nodes.map((node) => {
    const delta = deltas.get(node.id);

    if (delta === undefined) {
      return node;
    }

    return {
      ...node,
      position: translateSpread(node.position, isVertical, delta),
    };
  });
};

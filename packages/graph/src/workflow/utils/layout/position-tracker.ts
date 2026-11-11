/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { GraphNode } from "../../types/workflow-node.types";

import {
  getPositionedNodeAxisBounds,
  isHorizontalDirection,
  translateFlow,
  translateSpread,
  type Axis,
  type AxisBounds,
  type LayoutContext,
  type NodePosition,
} from "./geometry";

/**
 * The positions a layout pass moves nodes to: read and moved by node id while
 * the pass runs, then applied to the nodes in one go.
 */
export type PositionTracker = {
  isVertical: boolean;
  nodesById: Map<string, GraphNode>;
  positions: Map<string, NodePosition>;
  /** Shifts a node along `axis`; unknown ids are ignored. */
  move: (nodeId: string, axis: Axis, delta: number) => void;
  /** A node's current leading/trailing edges along `axis`. */
  getBounds: (nodeId: string, axis: Axis) => AxisBounds | undefined;
  /** The nodes at their tracked positions. */
  apply: () => GraphNode[];
};

export const createPositionTracker = (
  nodes: GraphNode[],
  ctx: LayoutContext,
): PositionTracker => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map(nodes.map((node) => [node.id, node.position]));

  return {
    isVertical,
    nodesById,
    positions,
    move: (nodeId, axis, delta) => {
      const node = nodesById.get(nodeId);

      if (!node) {
        return;
      }

      const translate = axis === "spread" ? translateSpread : translateFlow;

      positions.set(
        nodeId,
        translate(positions.get(nodeId) ?? node.position, isVertical, delta),
      );
    },
    getBounds: (nodeId, axis) =>
      getPositionedNodeAxisBounds(
        nodeId,
        positions,
        nodesById,
        ctx,
        isVertical,
        axis,
      ),
    apply: () =>
      nodes.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
      })),
  };
};

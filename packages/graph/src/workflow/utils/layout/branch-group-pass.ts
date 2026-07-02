/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import type { GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import {
  getPositionedNodeAxisBounds,
  isHorizontalDirection,
  type Axis,
  type AxisBounds,
  type LayoutContext,
  type NodePosition,
  translateFlow,
  translateSpread,
} from "./geometry";
import {
  buildMainFlowMaps,
  collectBranchNodeIds,
  getGroupOperatorNode,
  parseConditionalBranchIndex,
  type BranchTraversal,
  type OutgoingTarget,
} from "./graph-maps";

export type BranchTargetRef = { targetId: string; branchIndex: number };
export type BranchLayoutPass = {
  isVertical: boolean;
  nodesById: Map<string, GraphNode>;
  positions: Map<string, NodePosition>;
  outgoingBySource: Map<string, OutgoingTarget[]>;
  attachmentChildrenByParent: Map<string, string[]>;
  moveNode: (nodeId: string, delta: number) => void;
  collectBranch: (startId: string, group: GroupMeta) => BranchTraversal;
  getNodeBounds: (nodeId: string, axis: Axis) => AxisBounds | undefined;
};
/**
 * Shared scaffold for the branch-alignment passes below (spread-axis symmetry
 * and flow-axis origin alignment). Both index the nodes/positions, build the
 * main-flow adjacency, walk operator groups deepest-first, and resolve each
 * operator's in-group branch targets: a Conditional's branches carry an indexed
 * "operatorOut-N-M" handle (reliable spread order); a Parallel's share a single
 * "operatorOut" handle so we fall back to edge-emission order (matching the
 * step array); a Loop has a single branch that the `< 2` guard skips. `axis`
 * selects which coordinate `moveNode` shifts; accumulated moves are applied to
 * the returned nodes once every group has been handled.
 */
export const runBranchGroupPass = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
  axis: Axis,
  handleGroup: (args: {
    group: GroupMeta;
    operatorNode: GraphNode;
    branchTargets: BranchTargetRef[];
    pass: BranchLayoutPass;
  }) => void,
): GraphNode[] => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const { outgoingBySource, attachmentChildrenByParent } =
    buildMainFlowMaps(edges);
  const translate = axis === "spread" ? translateSpread : translateFlow;
  const pass: BranchLayoutPass = {
    isVertical,
    nodesById,
    positions,
    outgoingBySource,
    attachmentChildrenByParent,
    moveNode: (nodeId, delta) => {
      const node = nodesById.get(nodeId);

      if (!node) {
        return;
      }

      positions.set(
        nodeId,
        translate(positions.get(nodeId) ?? node.position, isVertical, delta),
      );
    },
    collectBranch: (startId, group) =>
      collectBranchNodeIds({
        startId,
        group,
        groups,
        nodesById,
        outgoingBySource,
        attachmentChildrenByParent,
      }),
    getNodeBounds: (nodeId, boundsAxis) =>
      getPositionedNodeAxisBounds(
        nodeId,
        positions,
        nodesById,
        ctx,
        isVertical,
        boundsAxis,
      ),
  };

  [...groups.values()]
    .sort((a, b) => b.level - a.level)
    .forEach((group) => {
      const operatorNode = getGroupOperatorNode(group, nodesById);

      if (!operatorNode) {
        return;
      }

      const branchTargets: BranchTargetRef[] = (
        outgoingBySource.get(operatorNode.id) ?? []
      )
        .filter(({ targetId }) => group.memberNodeIds.has(targetId))
        .map(({ targetId, sourceHandle }, index) => {
          const parsedBranchIndex = parseConditionalBranchIndex(sourceHandle);

          return {
            targetId,
            branchIndex: parsedBranchIndex >= 0 ? parsedBranchIndex : index,
          };
        })
        .sort((a, b) => a.branchIndex - b.branchIndex);

      if (branchTargets.length < 2) {
        return;
      }

      handleGroup({ group, operatorNode, branchTargets, pass });
    });

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import type { GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import type { Axis, AxisBounds, LayoutContext, NodePosition } from "./geometry";
import {
  buildMainFlowMaps,
  collectBranchNodeIds,
  getGroupOperatorNode,
  parseConditionalBranchIndex,
  type BranchTraversal,
  type OutgoingTarget,
} from "./graph-maps";
import { createPositionTracker } from "./position-tracker";

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
  const tracker = createPositionTracker(nodes, ctx);
  const { isVertical, nodesById, positions } = tracker;
  const { outgoingBySource, attachmentChildrenByParent } =
    buildMainFlowMaps(edges);
  const pass: BranchLayoutPass = {
    isVertical,
    nodesById,
    positions,
    outgoingBySource,
    attachmentChildrenByParent,
    moveNode: (nodeId, delta) => tracker.move(nodeId, axis, delta),
    collectBranch: (startId, group) =>
      collectBranchNodeIds({
        startId,
        group,
        groups,
        nodesById,
        outgoingBySource,
        attachmentChildrenByParent,
      }),
    getNodeBounds: tracker.getBounds,
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

  return tracker.apply();
};

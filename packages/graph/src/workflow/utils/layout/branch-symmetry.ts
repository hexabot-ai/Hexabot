/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import type { GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import { runBranchGroupPass } from "./branch-group-pass";
import { BRANCH_SPREAD_GAP } from "./constants";
import { getNodeAxisCenter, notEmpty, type LayoutContext } from "./geometry";
import { countNodeIds } from "./graph-maps";

type SpreadBranch = {
  branchIndex: number;
  nodeIds: Set<string>;
  leading: number;
  trailing: number;
};
export const symmetrizeBranchSiblings = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
): GraphNode[] =>
  runBranchGroupPass(
    nodes,
    edges,
    groups,
    ctx,
    "spread",
    ({ group, operatorNode, branchTargets, pass }) => {
      const { isVertical, positions, moveNode, collectBranch, getNodeBounds } =
        pass;
      const getNodeSpreadBounds = (nodeId: string) =>
        getNodeBounds(nodeId, "spread");
      const rawBranches = branchTargets.map(({ branchIndex, targetId }) => ({
        branchIndex,
        ...collectBranch(targetId, group),
      }));
      // A Parallel's branches all reconverge on one shared join node inside the
      // group (unlike a Conditional's branches, which each keep their own
      // separate trailing placeholder). That shared node sits centrally among
      // every branch, so folding it into any one branch's bounds would blow up
      // that branch's apparent size to span all the way to the shared point —
      // exclude it from both the bounds calculation and the move (it can't be
      // assigned to any single branch's lane; ELK already placed it to clear
      // every branch).
      const mainFlowBranchCountByNodeId = countNodeIds(
        rawBranches.map(({ mainFlowNodeIds }) => mainFlowNodeIds),
      );
      const isSingleBranchNode = (nodeId: string) =>
        (mainFlowBranchCountByNodeId.get(nodeId) ?? 0) <= 1;
      const getBounds = (nodeIds: Set<string>) =>
        [...nodeIds]
          .filter(isSingleBranchNode)
          .map(getNodeSpreadBounds)
          .filter(notEmpty);
      const branches = rawBranches
        .map(({ branchIndex, allNodeIds }): SpreadBranch | undefined => {
          const bounds = getBounds(allNodeIds);

          if (!bounds.length) {
            return;
          }

          return {
            branchIndex,
            nodeIds: allNodeIds,
            leading: Math.min(...bounds.map(({ leading }) => leading)),
            trailing: Math.max(...bounds.map(({ trailing }) => trailing)),
          };
        })
        .filter(notEmpty)
        .sort((a, b) => a.branchIndex - b.branchIndex);

      if (branches.length < 2) {
        return;
      }

      const operatorCenter = getNodeAxisCenter(
        operatorNode,
        ctx,
        isVertical,
        "spread",
        positions.get(operatorNode.id) ?? operatorNode.position,
      );
      const totalSize =
        branches.reduce(
          (sum, { leading, trailing }) => sum + trailing - leading,
          0,
        ) +
        BRANCH_SPREAD_GAP * (branches.length - 1);
      let cursor = operatorCenter - totalSize / 2;

      branches.forEach(({ leading, trailing, nodeIds }) => {
        const delta = cursor - leading;

        if (Math.abs(delta) >= 1) {
          nodeIds.forEach((nodeId) => {
            if (isSingleBranchNode(nodeId)) {
              moveNode(nodeId, delta);
            }
          });
        }

        cursor += trailing - leading + BRANCH_SPREAD_GAP;
      });

      // A shared convergence node (e.g. a Parallel's join placeholder) never
      // gets assigned to any one branch's lane above, so it's left wherever it
      // started. Center it on the operator instead — that's also where the
      // group's own in/out ports are drawn — now that every branch has
      // reached its final spread position.
      mainFlowBranchCountByNodeId.forEach((count, nodeId) => {
        if (count <= 1) {
          return;
        }

        const bounds = getNodeSpreadBounds(nodeId);

        if (!bounds) {
          return;
        }

        const delta = operatorCenter - (bounds.leading + bounds.trailing) / 2;

        if (Math.abs(delta) >= 1) {
          moveNode(nodeId, delta);
        }
      });
    },
  );

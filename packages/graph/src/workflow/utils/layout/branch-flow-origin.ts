/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import type { GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import { runBranchGroupPass } from "./branch-group-pass";
import { FLOW_LAYER_GAP } from "./constants";
import {
  indexNodes,
  notEmpty,
  setMaxMapValue,
  type LayoutContext,
} from "./geometry";
import {
  collectAttachmentDescendants,
  countNodeIds,
  getGroupOperatorNode,
} from "./graph-maps";

/**
 * ELK's layered algorithm ranks nodes by global edge-length optimization, not
 * by branch symmetry — so two sibling branches of the same operator (e.g. a
 * Parallel's "wait all" branches, or a Conditional's branches) can land in
 * different columns when one branch is structurally more complex (e.g. a
 * nested Conditional needing extra layers vs. a plain task). This shifts
 * every branch's flow-axis origin (x in horizontal mode, y in vertical mode)
 * to match the branch that starts furthest along the flow axis, moving each
 * branch's full subtree (including nested groups and attachment descendants)
 * as a unit so internal edges stay consistent.
 */
export const alignBranchFlowOrigins = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
): GraphNode[] => {
  // Account for group leading padding before group nodes are materialized, so
  // grouped and plain branch starts align on the same visible edge.
  const nodesById = indexNodes(nodes);
  const groupEntryLeadingInset = new Map<string, number>();

  groups.forEach((group) => {
    const padding = ctx.config?.highlights?.[group.operatorType]?.padding;
    const operatorNode = padding
      ? getGroupOperatorNode(group, nodesById)
      : undefined;

    if (operatorNode) {
      groupEntryLeadingInset.set(operatorNode.id, padding! / 2);
    }
  });

  return runBranchGroupPass(
    nodes,
    edges,
    groups,
    ctx,
    "flow",
    ({ group, branchTargets, pass }) => {
      const {
        nodesById,
        moveNode,
        collectBranch,
        getNodeBounds,
        outgoingBySource,
        attachmentChildrenByParent,
      } = pass;
      const branches = branchTargets
        .map(({ targetId }) => {
          const { mainFlowNodeIds, allNodeIds } = collectBranch(
            targetId,
            group,
          );
          const leadings = [...mainFlowNodeIds]
            .map((nodeId) => {
              const bounds = getNodeBounds(nodeId, "flow");

              return bounds?.leading === undefined
                ? undefined
                : bounds.leading - (groupEntryLeadingInset.get(nodeId) ?? 0);
            })
            .filter(notEmpty);

          return leadings.length
            ? { nodeIds: allNodeIds, leading: Math.min(...leadings) }
            : undefined;
        })
        .filter(notEmpty);

      if (branches.length < 2) {
        return;
      }

      const targetLeading = Math.max(
        ...branches.map((branch) => branch.leading),
      );
      // Shared convergence nodes keep ELK's position; shift only branch-local
      // nodes, using the largest required delta per node.
      const branchCountByNodeId = countNodeIds(
        branches.map((branch) => branch.nodeIds),
      );
      const deltaByNodeId = new Map<string, number>();
      const addDelta = (
        deltas: Map<string, number>,
        nodeId: string,
        delta: number,
      ) => setMaxMapValue(deltas, nodeId, delta);

      branches.forEach((branch) => {
        const delta = targetLeading - branch.leading;

        if (Math.abs(delta) < 1) {
          return;
        }

        branch.nodeIds.forEach((nodeId) => {
          if ((branchCountByNodeId.get(nodeId) ?? 0) <= 1) {
            addDelta(deltaByNodeId, nodeId, delta);
          }
        });
      });

      deltaByNodeId.forEach((delta, nodeId) => moveNode(nodeId, delta));

      const sharedNodeIds = [...branchCountByNodeId.entries()]
        .filter(([, count]) => count > 1)
        .map(([nodeId]) => nodeId);
      const attachmentIds = new Set<string>();

      attachmentChildrenByParent.forEach((childIds) => {
        childIds.forEach((childId) => attachmentIds.add(childId));
      });

      const collectForwardNodeIds = (startId: string): Set<string> => {
        const forwardNodeIds = new Set<string>();
        const queue = [startId];

        while (queue.length) {
          const current = queue.pop()!;

          if (forwardNodeIds.has(current)) {
            continue;
          }

          forwardNodeIds.add(current);

          collectAttachmentDescendants(
            current,
            attachmentChildrenByParent,
            nodesById,
          ).forEach((attachmentId) => forwardNodeIds.add(attachmentId));

          (outgoingBySource.get(current) ?? []).forEach(({ targetId }) => {
            if (!forwardNodeIds.has(targetId)) {
              queue.push(targetId);
            }
          });
        }

        return forwardNodeIds;
      };
      const getTrailingEdge = (nodeIds: Iterable<string>) => {
        let trailing = -Infinity;

        for (const nodeId of nodeIds) {
          const bounds = attachmentIds.has(nodeId)
            ? undefined
            : getNodeBounds(nodeId, "flow");

          if (bounds) {
            trailing = Math.max(trailing, bounds.trailing);
          }
        }

        return isFinite(trailing) ? trailing + FLOW_LAYER_GAP : undefined;
      };
      const localNodeIds = function* () {
        for (const [nodeId, count] of branchCountByNodeId) {
          if (count <= 1) {
            yield nodeId;
          }
        }
      };
      const sharedTrailing = getTrailingEdge(localNodeIds());

      if (sharedTrailing !== undefined) {
        sharedNodeIds.forEach((nodeId) => {
          const bounds = getNodeBounds(nodeId, "flow");

          if (!bounds) {
            return;
          }

          const delta = sharedTrailing - bounds.leading;

          if (delta >= 1) {
            collectForwardNodeIds(nodeId).forEach((forwardId) =>
              moveNode(forwardId, delta),
            );
          }
        });
      }

      if (!deltaByNodeId.size) {
        return;
      }

      const externalTrailing = getTrailingEdge(branchCountByNodeId.keys());
      const externalDeltaByNodeId = new Map<string, number>();

      if (externalTrailing === undefined) {
        return;
      }

      branchCountByNodeId.forEach((_, memberId) => {
        (outgoingBySource.get(memberId) ?? []).forEach(({ targetId }) => {
          if (
            group.memberNodeIds.has(targetId) ||
            branchCountByNodeId.has(targetId)
          ) {
            return;
          }

          const bounds = getNodeBounds(targetId, "flow");
          const delta = bounds ? externalTrailing - bounds.leading : 0;

          if (delta >= 1) {
            collectForwardNodeIds(targetId).forEach((forwardId) =>
              addDelta(externalDeltaByNodeId, forwardId, delta),
            );
          }
        });
      });

      externalDeltaByNodeId.forEach((delta, nodeId) => moveNode(nodeId, delta));
    },
  );
};

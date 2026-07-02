/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import {
  appendMapValue,
  getAxisCenter,
  getGraphNodeDimensions,
  isHorizontalDirection,
  type LayoutContext,
  translateSpread,
} from "./geometry";
import {
  buildAttachmentMaps,
  collectNodeIdsWithAttachmentDescendants,
  isAttachmentEdge,
} from "./graph-maps";

/**
 * A single branch can hold a *sequence* of operator groups (e.g. Parallel →
 * Conditional → Conditional). ELK lays each group out independently, so their
 * box centers — where GROUP_IN/GROUP_OUT ports sit, and where the group→group
 * overlay edges attach — can land on slightly different spread positions,
 * making the chain (and the operators inside it) zig-zag instead of sharing one
 * axis. `alignAllNodesToStartAxis` only unifies the top-level groups; this pass
 * does the same for every linear chain of sibling groups deeper in the tree:
 * it walks each group→group overlay chain and shifts every following group's
 * whole subtree so its center matches the chain's first group. The empty
 * placeholder a chain finally flows into (a branch's trailing "+" continuation)
 * is pulled onto the same axis too, so the exit edge leaves the last group
 * head-on. Because a group moves as a unit, the branch symmetry established
 * inside it is preserved.
 */
export const alignGroupChainAxes = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
): GraphNode[] => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const { childrenByParent: attachmentChildrenByParent } = buildAttachmentMaps(
    edges,
    nodesById,
  );
  const isGroupNode = (id: string) =>
    nodesById.get(id)?.type === ENodeType.GROUP;
  const isPlaceholderNode = (id: string) =>
    nodesById.get(id)?.type === ENodeType.BRANCH_PLACEHOLDER;
  // Overlay links leaving a group: to the next sibling group sequenced within
  // the same branch, or to the branch's trailing placeholder that ends it.
  const overlaySuccessors = new Map<string, string[]>();
  const overlayPredecessorCount = new Map<string, number>();

  edges.forEach((edge) => {
    if (
      isAttachmentEdge(edge) ||
      !isGroupNode(edge.source) ||
      (!isGroupNode(edge.target) && !isPlaceholderNode(edge.target))
    ) {
      return;
    }

    appendMapValue(overlaySuccessors, edge.source, edge.target);
    overlayPredecessorCount.set(
      edge.target,
      (overlayPredecessorCount.get(edge.target) ?? 0) + 1,
    );
  });
  // Every node that moves when this group moves: its members (which already
  // include nested groups' members) plus their attachment descendants, its own
  // overlay box, and any nested group overlays.
  const collectSubtreeIds = (group: GroupMeta): Set<string> => {
    const ids = collectNodeIdsWithAttachmentDescendants(
      group.memberNodeIds,
      attachmentChildrenByParent,
      nodesById,
    );

    if (nodesById.has(group.id)) {
      ids.add(group.id);
    }

    groups.forEach((candidate, candidateId) => {
      if (
        candidateId === group.id ||
        candidate.level <= group.level ||
        !nodesById.has(candidateId)
      ) {
        return;
      }

      const isNested = [...candidate.memberNodeIds].some((memberId) =>
        group.memberNodeIds.has(memberId),
      );

      if (isNested) {
        ids.add(candidateId);
      }
    });

    return ids;
  };
  const groupCenter = (groupId: string): number | undefined => {
    const overlay = nodesById.get(groupId);

    if (!overlay) {
      return;
    }

    return getAxisCenter(
      positions.get(groupId) ?? overlay.position,
      getGraphNodeDimensions(overlay, ctx),
      isVertical,
      "spread",
    );
  };
  const moveGroup = (group: GroupMeta, delta: number) => {
    collectSubtreeIds(group).forEach((id) => {
      const node = nodesById.get(id);

      if (!node) {
        return;
      }

      positions.set(
        id,
        translateSpread(positions.get(id) ?? node.position, isVertical, delta),
      );
    });
  };
  const moveNodeSpread = (nodeId: string, delta: number) => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    positions.set(
      nodeId,
      translateSpread(
        positions.get(nodeId) ?? node.position,
        isVertical,
        delta,
      ),
    );
  };
  const visited = new Set<string>();

  overlaySuccessors.forEach((_successors, rootId) => {
    // A chain root is a group fed by a non-group (an operator branch handle or
    // the start indicator), so nothing pulls it — align the rest of the chain
    // onto its axis.
    if (
      !isGroupNode(rootId) ||
      (overlayPredecessorCount.get(rootId) ?? 0) > 0
    ) {
      return;
    }

    const anchorAxis = groupCenter(rootId);

    if (anchorAxis === undefined) {
      return;
    }

    let currentId = rootId;

    while (true) {
      const successors = overlaySuccessors.get(currentId) ?? [];

      // Only follow a strict 1-to-1 spine — stop at a fan-out or a join, which
      // the branch-symmetry passes already position.
      if (
        successors.length !== 1 ||
        (overlayPredecessorCount.get(successors[0]) ?? 0) !== 1 ||
        visited.has(successors[0])
      ) {
        break;
      }

      const nextId = successors[0];

      visited.add(nextId);

      const nextGroup = groups.get(nextId);

      if (nextGroup) {
        const nextCenter = groupCenter(nextId);

        if (nextCenter !== undefined) {
          const delta = anchorAxis - nextCenter;

          if (Math.abs(delta) >= 1) {
            moveGroup(nextGroup, delta);
          }
        }

        currentId = nextId;

        continue;
      }

      // A trailing placeholder ends the chain: align it and stop.
      const placeholder = nodesById.get(nextId);

      if (placeholder) {
        const delta =
          anchorAxis -
          getAxisCenter(
            positions.get(nextId) ?? placeholder.position,
            getGraphNodeDimensions(placeholder, ctx),
            isVertical,
            "spread",
          );

        if (Math.abs(delta) >= 1) {
          moveNodeSpread(nextId, delta);
        }
      }

      break;
    }
  });

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
};

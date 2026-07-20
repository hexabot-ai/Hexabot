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
  getPositionedNodeAxisBounds,
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
 * A single branch can hold a *sequence* of operator groups, possibly with
 * plain steps between them (e.g. Parallel → Send Message → Conditional). ELK
 * lays each element out independently, so their centers — where GROUP_IN/
 * GROUP_OUT ports sit, and where the sequence's overlay edges attach — can
 * land on slightly different spread positions, making the chain (and the
 * operators inside it) zig-zag instead of sharing one axis.
 * `alignAllNodesToStartAxis` only unifies the top-level groups; this pass does
 * the same for every linear chain deeper in the tree: it walks each sequence
 * from its first group and shifts every following group's whole subtree — and
 * every plain step's node (with its attachments) — so its center matches that
 * first group. The empty placeholder a chain finally flows into (a branch's
 * trailing "+" continuation) is pulled onto the same axis too, so the exit
 * edge leaves the last element head-on. Because a group moves as a unit, the
 * branch symmetry established inside it is preserved.
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
  const isOperatorNode = (id: string) =>
    nodesById.get(id)?.type === ENodeType.OPERATOR;
  const isPlaceholderNode = (id: string) =>
    nodesById.get(id)?.type === ENodeType.BRANCH_PLACEHOLDER;
  const isTaskNode = (id: string) => nodesById.get(id)?.type === ENodeType.TASK;
  // Links continuing a branch's sequence: from a single-branch operator, group,
  // or plain step to the next group/step, or to the trailing placeholder.
  // Hidden edges are direct duplicates of group overlay links, so skip them.
  const overlaySuccessors = new Map<string, string[]>();
  const overlayPredecessors = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (
      isAttachmentEdge(edge) ||
      edge.hidden ||
      (!isGroupNode(edge.source) &&
        !isOperatorNode(edge.source) &&
        !isTaskNode(edge.source)) ||
      (!isGroupNode(edge.target) &&
        !isPlaceholderNode(edge.target) &&
        !isTaskNode(edge.target))
    ) {
      return;
    }

    appendMapValue(overlaySuccessors, edge.source, edge.target);
    appendMapValue(overlayPredecessors, edge.target, edge.source);
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
  const getSpreadCenter = (nodeIds: Iterable<string>): number | undefined => {
    const bounds = [...nodeIds].flatMap((nodeId) => {
      const result = getPositionedNodeAxisBounds(
        nodeId,
        positions,
        nodesById,
        ctx,
        isVertical,
        "spread",
      );

      return result ? [result] : [];
    });

    return bounds.length
      ? (Math.min(...bounds.map(({ leading }) => leading)) +
          Math.max(...bounds.map(({ trailing }) => trailing))) /
          2
      : undefined;
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
  const moveGroup = (group: GroupMeta, delta: number) => {
    collectSubtreeIds(group).forEach((id) => moveNodeSpread(id, delta));
  };
  // Whether a spine of 1-to-1 links upstream of `id` (walking back through
  // plain steps) eventually reaches a group. If it does, `id` is pulled by
  // that group's chain instead of anchoring its own.
  const hasUpstreamGroupInSpine = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let currentId = id;

    for (;;) {
      const predecessors = overlayPredecessors.get(currentId) ?? [];

      if (predecessors.length !== 1 || seen.has(predecessors[0])) {
        return false;
      }

      if (isGroupNode(predecessors[0])) {
        return true;
      }

      seen.add(predecessors[0]);
      currentId = predecessors[0];
    }
  };
  const visited = new Set<string>();

  overlaySuccessors.forEach((rootSuccessors, rootId) => {
    // Group roots align sibling group chains. A one-output operator additionally
    // aligns its sole branch bundle; fan-out operators remain symmetry-owned.
    const isSingleBranchOperator =
      isOperatorNode(rootId) && rootSuccessors.length === 1;

    if (
      (!isGroupNode(rootId) && !isSingleBranchOperator) ||
      hasUpstreamGroupInSpine(rootId)
    ) {
      return;
    }

    const anchorAxis = getSpreadCenter([rootId]);

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
        (overlayPredecessors.get(successors[0])?.length ?? 0) !== 1 ||
        visited.has(successors[0])
      ) {
        break;
      }

      const nextId = successors[0];

      visited.add(nextId);

      const nextGroup = groups.get(nextId);

      if (nextGroup) {
        const nextCenter = getSpreadCenter([nextId]);

        if (nextCenter !== undefined) {
          const delta = anchorAxis - nextCenter;

          if (Math.abs(delta) >= 1) {
            moveGroup(nextGroup, delta);
          }
        }

        currentId = nextId;

        continue;
      }

      // A plain step sequenced between groups, or the trailing placeholder
      // that ends the chain: center it (and its attachments) on the axis.
      const nextNode = nodesById.get(nextId);

      if (nextNode) {
        const alignedNodeIds = collectNodeIdsWithAttachmentDescendants(
          [nextId],
          attachmentChildrenByParent,
          nodesById,
        );
        const nextCenter = getSpreadCenter(
          isSingleBranchOperator ? alignedNodeIds : [nextId],
        );
        const delta = anchorAxis - (nextCenter ?? anchorAxis);

        if (Math.abs(delta) >= 1) {
          alignedNodeIds.forEach((id) => moveNodeSpread(id, delta));
        }
      }

      // The trailing placeholder is the chain's end; a plain step continues it.
      if (!nextNode || isPlaceholderNode(nextId)) {
        break;
      }

      currentId = nextId;
    }
  });

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import { FLOW_LAYER_GAP } from "./constants";
import {
  appendMapValue,
  getGroupPadding,
  type AxisBounds,
  type LayoutContext,
} from "./geometry";
import {
  buildAttachmentMaps,
  collectGroupSubtreeIds,
  collectNodeIdsWithAttachmentDescendants,
  isAttachmentEdge,
} from "./graph-maps";
import { createPositionTracker } from "./position-tracker";

const CHAIN_SOURCE_TYPES = new Set<ENodeType>([
  ENodeType.GROUP,
  ENodeType.OPERATOR,
  ENodeType.TASK,
]);
const CHAIN_TARGET_TYPES = new Set<ENodeType>([
  ENodeType.GROUP,
  ENodeType.BRANCH_PLACEHOLDER,
  ENodeType.TASK,
]);
/**
 * Links that continue a branch's sequence: from a group, an operator or a
 * plain step to the next group or step, or to the trailing placeholder.
 * Hidden edges are direct duplicates of group overlay links, so they are
 * skipped.
 */
const buildChainLinks = (edges: Edge[], nodesById: Map<string, GraphNode>) => {
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const hasType = (nodeId: string, types: Set<ENodeType>) => {
    const type = nodesById.get(nodeId)?.type;

    return type !== undefined && types.has(type);
  };

  edges.forEach((edge) => {
    if (
      !isAttachmentEdge(edge) &&
      !edge.hidden &&
      hasType(edge.source, CHAIN_SOURCE_TYPES) &&
      hasType(edge.target, CHAIN_TARGET_TYPES)
    ) {
      appendMapValue(successors, edge.source, edge.target);
      appendMapValue(predecessors, edge.target, edge.source);
    }
  });

  return { successors, predecessors };
};

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
  const tracker = createPositionTracker(nodes, ctx);
  const { nodesById, getBounds } = tracker;
  const { childrenByParent: attachmentChildrenByParent } = buildAttachmentMaps(
    edges,
    nodesById,
  );
  const { successors: chainSuccessors, predecessors: chainPredecessors } =
    buildChainLinks(edges, nodesById);
  const isOfType = (id: string, type: ENodeType) =>
    nodesById.get(id)?.type === type;
  const isGroupNode = (id: string) => isOfType(id, ENodeType.GROUP);
  const isOperatorNode = (id: string) => isOfType(id, ENodeType.OPERATOR);
  const isPlaceholderNode = (id: string) =>
    isOfType(id, ENodeType.BRANCH_PLACEHOLDER);
  const isTaskNode = (id: string) => isOfType(id, ENodeType.TASK);
  // A node and its attachments, which move together.
  const collectBundleIds = (id: string) =>
    collectNodeIdsWithAttachmentDescendants(
      [id],
      attachmentChildrenByParent,
      nodesById,
    );
  const collectSubtreeIds = (group: GroupMeta) =>
    collectGroupSubtreeIds(
      group,
      groups,
      attachmentChildrenByParent,
      nodesById,
    );
  const getGroupFlowBounds = (group: GroupMeta) => {
    const memberBounds = [...collectSubtreeIds(group)]
      .filter((id) => id !== group.id)
      .flatMap((id) => {
        const bounds = getBounds(id, "flow");

        return bounds ? [bounds] : [];
      });

    if (!memberBounds.length) {
      return getBounds(group.id, "flow");
    }

    const padding = getGroupPadding(group, ctx);

    return {
      leading:
        Math.min(...memberBounds.map(({ leading }) => leading)) - padding / 2,
      trailing:
        Math.max(...memberBounds.map(({ trailing }) => trailing)) + padding / 2,
    };
  };
  // The flow-axis extent of nodes, ±Infinity when none of them is laid out.
  const getFlowExtent = (nodeIds: Iterable<string>): AxisBounds =>
    [...nodeIds].reduce(
      (extent, id) => {
        const bounds = getBounds(id, "flow");

        return {
          leading: Math.min(extent.leading, bounds?.leading ?? Infinity),
          trailing: Math.max(extent.trailing, bounds?.trailing ?? -Infinity),
        };
      },
      { leading: Infinity, trailing: -Infinity },
    );
  // A chain element spans its group overlay, or its nodes when it is a step.
  const getElementFlowBounds = (
    group: GroupMeta | undefined,
    nodeIds: Iterable<string>,
  ) => (group ? getGroupFlowBounds(group) : getFlowExtent(nodeIds));
  const getSpreadCenter = (nodeIds: Iterable<string>): number | undefined => {
    const bounds = [...nodeIds].flatMap((nodeId) => {
      const result = getBounds(nodeId, "spread");

      return result ? [result] : [];
    });

    return bounds.length
      ? (Math.min(...bounds.map(({ leading }) => leading)) +
          Math.max(...bounds.map(({ trailing }) => trailing))) /
          2
      : undefined;
  };
  const moveSpread = (nodeIds: Iterable<string>, delta: number) => {
    for (const nodeId of nodeIds) {
      tracker.move(nodeId, "spread", delta);
    }
  };
  // Whether a spine of 1-to-1 links upstream of `id` (walking back through
  // plain steps) eventually reaches a group. If it does, `id` is pulled by
  // that group's chain instead of anchoring its own.
  const hasUpstreamGroupInSpine = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let currentId = id;

    for (;;) {
      const predecessors = chainPredecessors.get(currentId) ?? [];

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
  // Group roots align sibling group chains. A one-output operator also aligns
  // its sole branch bundle, and so does the first step of an operator's
  // branch; fan-out operators remain symmetry-owned.
  const isChainRoot = (rootId: string, rootSuccessors: string[]): boolean => {
    const hasOneSuccessor = rootSuccessors.length === 1;
    const startsChain =
      isGroupNode(rootId) ||
      (hasOneSuccessor && isOperatorNode(rootId)) ||
      (hasOneSuccessor &&
        isTaskNode(rootId) &&
        (chainPredecessors.get(rootId) ?? []).some(isOperatorNode));

    return startsChain && !hasUpstreamGroupInSpine(rootId);
  };
  const visited = new Set<string>();
  // The next element of the chain, as long as it continues a strict 1-to-1
  // spine: a fan-out or a join ends the chain (branch symmetry positions
  // those), and so does an element already aligned by another chain.
  const getSpineSuccessor = (currentId: string): string | undefined => {
    const successors = chainSuccessors.get(currentId) ?? [];

    if (
      successors.length !== 1 ||
      (chainPredecessors.get(successors[0])?.length ?? 0) !== 1 ||
      visited.has(successors[0])
    ) {
      return undefined;
    }

    return successors[0];
  };
  // Links into a group, a placeholder, a step continuing the chain, or a
  // final step flowing into the Stop indicator keep a uniform flow gap.
  const shouldCloseFlowGap = (
    nextId: string,
    nextGroup: GroupMeta | undefined,
  ): boolean =>
    Boolean(nextGroup) ||
    isPlaceholderNode(nextId) ||
    (chainSuccessors.get(nextId) ?? []).length === 1 ||
    (isTaskNode(nextId) &&
      edges.some(
        (edge) =>
          !edge.hidden &&
          edge.source === nextId &&
          isOfType(edge.target, ENodeType.INDICATOR),
      ));
  // Pulls the next element (with everything moving with it) back to
  // FLOW_LAYER_GAP after the current one when ELK left a longer link.
  const closeFlowGap = (
    currentId: string,
    nextId: string,
    nextGroup: GroupMeta | undefined,
  ) => {
    const targetIds = nextGroup
      ? collectSubtreeIds(nextGroup)
      : collectBundleIds(nextId);
    // A placeholder links to the step card itself, not to its attachments.
    const sourceIds = isPlaceholderNode(nextId)
      ? [currentId]
      : collectBundleIds(currentId);
    const sourceTrailing = getElementFlowBounds(
      groups.get(currentId),
      sourceIds,
    )?.trailing;
    const targetLeading = getElementFlowBounds(nextGroup, targetIds)?.leading;

    if (sourceTrailing === undefined || targetLeading === undefined) {
      return;
    }

    const flowDelta = sourceTrailing + FLOW_LAYER_GAP - targetLeading;

    if (flowDelta < -0.5) {
      targetIds.forEach((id) => tracker.move(id, "flow", flowDelta));
    }
  };
  // Centers the next element on the chain axis: a group moves as a unit and a
  // plain step with its attachments, while a trailing placeholder stays on
  // its predecessor's card axis so their link stays straight.
  const alignOnChainAxis = (
    currentId: string,
    nextId: string,
    nextGroup: GroupMeta | undefined,
    anchorAxis: number,
  ) => {
    const movedIds = nextGroup
      ? collectSubtreeIds(nextGroup)
      : collectBundleIds(nextId);
    const nextCenter = getSpreadCenter(nextGroup ? [nextId] : movedIds);
    const targetAxis = isPlaceholderNode(nextId)
      ? (getSpreadCenter([currentId]) ?? anchorAxis)
      : anchorAxis;

    if (nextCenter === undefined) {
      return;
    }

    const delta = targetAxis - nextCenter;

    if (Math.abs(delta) >= 1) {
      moveSpread(movedIds, delta);
    }
  };
  const alignChain = (rootId: string) => {
    const anchorAxis = getSpreadCenter(collectBundleIds(rootId));

    if (anchorAxis === undefined) {
      return;
    }

    let currentId = rootId;
    let nextId = getSpineSuccessor(currentId);

    while (nextId !== undefined) {
      visited.add(nextId);

      const nextGroup = groups.get(nextId);

      if (shouldCloseFlowGap(nextId, nextGroup)) {
        closeFlowGap(currentId, nextId, nextGroup);
      }

      if (!nextGroup && !nodesById.has(nextId)) {
        return;
      }

      alignOnChainAxis(currentId, nextId, nextGroup, anchorAxis);

      // The trailing placeholder ends the chain; groups and steps continue it.
      if (isPlaceholderNode(nextId)) {
        return;
      }

      currentId = nextId;
      nextId = getSpineSuccessor(currentId);
    }
  };

  chainSuccessors.forEach((rootSuccessors, rootId) => {
    if (isChainRoot(rootId, rootSuccessors)) {
      alignChain(rootId);
    }
  });

  return tracker.apply();
};

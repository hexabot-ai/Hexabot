/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getNodesBounds, type Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import {
  END_INDICATOR_ID,
  START_INDICATOR_ID,
} from "../graph-builder/id-factory";
import type { GroupMeta } from "../graph-builder/types";
import { getWorkflowNodeDimensions } from "../node-metrics.utils";

import { FLOW_LAYER_GAP } from "./constants";
import {
  average,
  getAxisCenter,
  getBoundsSpreadCenter,
  getFlowCoordinate,
  getFlowSize,
  getGraphNodeDimensions,
  isHorizontalDirection,
  type LayoutContext,
  translateSpread,
  withFlowCoordinate,
} from "./geometry";
import {
  buildAttachmentMaps,
  collectAttachmentDescendants,
  collectNodeIdsWithAttachmentDescendants,
  mapNodesToGroup,
} from "./graph-maps";

export const alignAllNodesToStartAxis = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
) => {
  const isVertical = !isHorizontalDirection(ctx);
  const startNode = nodes.find((node) => node.id === START_INDICATOR_ID);

  if (!startNode) {
    return nodes;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const {
    childrenByParent: attachmentChildrenByParent,
    parentByChild: attachmentParentByChild,
  } = buildAttachmentMaps(edges, nodesById);
  const nodeToOutermostGroup = mapNodesToGroup(groups, "outermost");
  // Compute targetAxis from the content nodes (groups and top-level non-indicator
  // nodes), NOT from Start/Stop positions.  Start/Stop will then be moved to
  // align with the content axis so they share the same perpendicular position
  // as the group entry/exit ports.
  //
  // For each top-level group, use its bounding-box center.
  // For each top-level non-indicator, non-attachment node, use its node center.
  // The targetAxis is the average of all these reference centers.
  const indicatorIds = new Set([START_INDICATOR_ID, END_INDICATOR_ID]);
  const groupAlignments = new Map<
    string,
    { memberIds: Set<string>; referenceCenter: number }
  >();
  const referenceCenters: number[] = [];
  const collectGroupMemberIds = (groupId: string): Set<string> => {
    const group = groups.get(groupId);

    if (!group) {
      return new Set();
    }

    const memberIds = collectNodeIdsWithAttachmentDescendants(
      group.memberNodeIds,
      attachmentChildrenByParent,
      nodesById,
    );

    groups.forEach((candidateGroup, candidateGroupId) => {
      if (
        candidateGroupId === groupId ||
        candidateGroup.level <= group.level ||
        !nodesById.has(candidateGroupId)
      ) {
        return;
      }

      const isNestedGroup = [...candidateGroup.memberNodeIds].some((nodeId) =>
        group.memberNodeIds.has(nodeId),
      );

      if (isNestedGroup) {
        memberIds.add(candidateGroupId);
      }
    });

    return memberIds;
  };
  const getGroupReferenceCenter = (
    groupId: string,
    memberIds = collectGroupMemberIds(groupId),
  ): number | undefined => {
    const groupOverlay = nodesById.get(groupId);

    if (groupOverlay) {
      return getAxisCenter(
        groupOverlay.position,
        getGraphNodeDimensions(groupOverlay, ctx),
        isVertical,
        "spread",
      );
    }

    const memberNodes = [...memberIds]
      .map((id) => nodesById.get(id))
      .filter((member): member is GraphNode => Boolean(member));

    if (!memberNodes.length) {
      return;
    }

    return getBoundsSpreadCenter(getNodesBounds(memberNodes), isVertical);
  };
  // Compute targetAxis from the content reference centers.
  // Walk all nodes once (skipping attachment children, indicators, and GROUP
  // overlay nodes) and collect the bounding-box center of each top-level group
  // and the node center of each standalone non-indicator node.  The targetAxis
  // is the average of these — Start/Stop will be moved to align with it.

  nodes.forEach((node) => {
    // Skip GROUP overlay nodes — they duplicate the bounding-box center of
    // their member nodes which are already counted via nodeToOutermostGroup —
    // and attachment children, which move with their parent.
    if (node.type === ENodeType.GROUP || attachmentParentByChild.has(node.id)) {
      return;
    }

    const groupId = nodeToOutermostGroup.get(node.id);

    if (groupId) {
      if (groupAlignments.has(groupId)) {
        return;
      }

      const memberIds = collectGroupMemberIds(groupId);
      const referenceCenter = getGroupReferenceCenter(groupId, memberIds);

      if (referenceCenter !== undefined) {
        groupAlignments.set(groupId, { memberIds, referenceCenter });
        referenceCenters.push(referenceCenter);
      }

      return;
    }

    if (indicatorIds.has(node.id)) {
      return;
    }

    referenceCenters.push(
      getAxisCenter(
        node.position,
        getGraphNodeDimensions(node, ctx),
        isVertical,
        "spread",
      ),
    );
  });

  // Fall back to Start's own center when there are no content nodes.
  const startDims = getWorkflowNodeDimensions(startNode.type, ctx.config);
  const targetAxis =
    referenceCenters.length > 0
      ? average(referenceCenters)
      : getAxisCenter(startNode.position, startDims, isVertical, "spread");
  const deltas = new Map<string, number>();

  groupAlignments.forEach(({ memberIds, referenceCenter }, groupId) => {
    const delta = targetAxis - referenceCenter;

    if (delta === 0) {
      return;
    }

    memberIds.forEach((id) => {
      deltas.set(id, delta);
    });
    // Also shift the GROUP overlay node itself (same delta as its members).
    deltas.set(groupId, delta);
  });

  // Ungrouped nodes — including the Start/Stop indicators — align individually.
  nodes.forEach((node) => {
    if (
      node.type === ENodeType.GROUP ||
      attachmentParentByChild.has(node.id) ||
      nodeToOutermostGroup.has(node.id)
    ) {
      return;
    }

    const nodeCenter = getAxisCenter(
      node.position,
      getGraphNodeDimensions(node, ctx),
      isVertical,
      "spread",
    );
    const delta = targetAxis - nodeCenter;

    if (delta === 0) {
      return;
    }

    deltas.set(node.id, delta);
    collectAttachmentDescendants(
      node.id,
      attachmentChildrenByParent,
      nodesById,
    ).forEach((childId) => deltas.set(childId, delta));
  });

  const alignedNodes = nodes.map((node) => {
    const delta = deltas.get(node.id);

    if (delta === undefined || delta === 0) {
      return node;
    }

    return {
      ...node,
      position: translateSpread(node.position, isVertical, delta),
    };
  });

  return alignedNodes.map((node) => {
    const isStart = node.id === START_INDICATOR_ID;
    const edge = isStart
      ? edges.find((edge) => edge.source === node.id && !edge.hidden)
      : node.id === END_INDICATOR_ID
        ? edges.find((edge) => edge.target === node.id && !edge.hidden)
        : undefined;
    const boundaryId = isStart ? edge?.target : edge?.source;
    const boundary = boundaryId ? nodesById.get(boundaryId) : undefined;

    if (!boundary) {
      return node;
    }

    const flowCoordinate = isStart
      ? getFlowCoordinate(boundary.position, isVertical) -
        FLOW_LAYER_GAP -
        getFlowSize(getGraphNodeDimensions(node, ctx), isVertical)
      : getFlowCoordinate(boundary.position, isVertical) +
        getFlowSize(getGraphNodeDimensions(boundary, ctx), isVertical) +
        FLOW_LAYER_GAP;

    return {
      ...node,
      position: withFlowCoordinate(node.position, isVertical, flowCoordinate),
    };
  });
};

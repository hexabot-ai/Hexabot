/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getNodesBounds, type Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";
import { getWorkflowNodeDimensions } from "../node-metrics.utils";

import { FLOW_LAYER_GAP } from "./constants";
import {
  appendMapValue,
  getFlowCoordinate,
  getFlowSize,
  getGroupPadding,
  getSpreadCoordinate,
  getSpreadSize,
  isHorizontalDirection,
  withFlowCoordinate,
  withSpreadCoordinate,
  type LayoutContext,
  type NodePosition,
} from "./geometry";
import { buildAttachmentMaps, isAttachmentEdge } from "./graph-maps";

/**
 * ELK pushes every branch's trailing "+" placeholder into a shared layer near
 * the flow's convergence point, so a short branch ends with a link that
 * stretches across the whole span of its longest sibling. This pass pulls
 * each trailing placeholder back to a uniform FLOW_LAYER_GAP after the single
 * step or group that feeds it, so every trailing link reads as the same
 * length. Placeholders fed by more than one visible edge (join placeholders)
 * mark a shared convergence point and keep their ELK position; empty-branch
 * placeholders (fed by the operator itself) are positioned by
 * alignEmptyBranchPlaceholders instead.
 */
export const tightenTrailingPlaceholders = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
): GraphNode[] => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const { childrenByParent: attachmentChildrenByParent } = buildAttachmentMaps(
    edges,
    nodesById,
  );
  const visibleSourcesByTarget = new Map<string, string[]>();
  const directSourcesByTarget = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (isAttachmentEdge(edge)) {
      return;
    }

    const targetNode = nodesById.get(edge.target);

    if (!edge.hidden && targetNode?.type === ENodeType.BRANCH_PLACEHOLDER) {
      appendMapValue(visibleSourcesByTarget, edge.target, edge.source);
    }

    if (targetNode?.type === ENodeType.INDICATOR) {
      appendMapValue(directSourcesByTarget, edge.target, edge.source);
    }
  });

  const getDimensions = (node: GraphNode) =>
    getWorkflowNodeDimensions(node.type, ctx.config);
  const getCardFlowEnd = (node: GraphNode, position = node.position) =>
    getFlowCoordinate(position, isVertical) +
    getFlowSize(getDimensions(node), isVertical);
  // Use the source's far edge, or the future group overlay's padded far edge.
  const sourceFlowEnd = (sourceId: string): number | undefined => {
    const sourceNode = nodesById.get(sourceId);

    if (sourceNode) {
      return getCardFlowEnd(sourceNode);
    }

    const group = groups.get(sourceId);

    if (!group) {
      return;
    }

    const memberNodes = [...group.memberNodeIds]
      .map((id) => nodesById.get(id))
      .filter((node): node is GraphNode => Boolean(node));

    if (!memberNodes.length) {
      return;
    }

    const bounds = getNodesBounds(memberNodes);

    return (
      (isVertical ? bounds.y + bounds.height : bounds.x + bounds.width) +
      getGroupPadding(group, ctx) / 2
    );
  };
  // Centers `node` on the spread axis of `card`.
  const centerOnCard = (
    position: NodePosition,
    node: GraphNode,
    card: GraphNode,
  ): NodePosition =>
    withSpreadCoordinate(
      position,
      isVertical,
      getSpreadCoordinate(card.position, isVertical) +
        (getSpreadSize(getDimensions(card), isVertical) -
          getSpreadSize(getDimensions(node), isVertical)) /
          2,
    );
  // The single step or group feeding a trailing placeholder. Join
  // placeholders (several visible sources) keep their ELK position, and
  // empty-branch placeholders (fed by their operator) are placed by
  // alignEmptyBranchPlaceholders.
  const getTrailingSourceId = (placeholder: GraphNode): string | undefined => {
    const sources = visibleSourcesByTarget.get(placeholder.id) ?? [];

    return sources.length === 1 &&
      nodesById.get(sources[0])?.type !== ENodeType.OPERATOR
      ? sources[0]
      : undefined;
  };
  const getTaskWithAttachments = (nodeId: string): GraphNode | undefined => {
    const node = nodesById.get(nodeId);

    return node?.type === ENodeType.TASK &&
      attachmentChildrenByParent.has(nodeId)
      ? node
      : undefined;
  };
  // A trailing placeholder sits FLOW_LAYER_GAP after its source; after a task
  // with attachments it is also centered on the task card, not on the
  // attachment bundle.
  const getTightenedPlaceholderPosition = (
    placeholder: GraphNode,
  ): NodePosition | undefined => {
    const sourceId = getTrailingSourceId(placeholder);

    if (sourceId === undefined) {
      return;
    }

    const flowEnd = sourceFlowEnd(sourceId);

    if (flowEnd === undefined) {
      return;
    }

    const targetFlow = flowEnd + FLOW_LAYER_GAP;
    const card = getTaskWithAttachments(sourceId);
    const isAtTargetFlow =
      Math.abs(
        getFlowCoordinate(placeholder.position, isVertical) - targetFlow,
      ) < 0.5;

    if (isAtTargetFlow && !card) {
      return;
    }

    const position = isAtTargetFlow
      ? placeholder.position
      : withFlowCoordinate(placeholder.position, isVertical, targetFlow);

    return card ? centerOnCard(position, placeholder, card) : position;
  };
  // Stop is pulled back to FLOW_LAYER_GAP after the furthest of its sources,
  // at their tightened positions; alignBranchFlowOrigins handles pushing it
  // further.
  const getPulledIndicatorPosition = (
    indicator: GraphNode,
    tightenedPositions: Map<string, NodePosition>,
  ): NodePosition | undefined => {
    const sources = (directSourcesByTarget.get(indicator.id) ?? []).filter(
      (id) => nodesById.has(id),
    );

    if (!sources.length) {
      return;
    }

    const maxSourceEnd = sources.reduce((max, sourceId) => {
      const sourceNode = nodesById.get(sourceId);
      const position = tightenedPositions.get(sourceId) ?? sourceNode?.position;

      return position && sourceNode
        ? Math.max(max, getCardFlowEnd(sourceNode, position))
        : max;
    }, -Infinity);

    if (!isFinite(maxSourceEnd)) {
      return;
    }

    const targetFlow = maxSourceEnd + FLOW_LAYER_GAP;

    return targetFlow < getFlowCoordinate(indicator.position, isVertical) - 0.5
      ? withFlowCoordinate(indicator.position, isVertical, targetFlow)
      : undefined;
  };
  const tightenedPositions = new Map<string, NodePosition>();

  nodes.forEach((node) => {
    if (node.type !== ENodeType.BRANCH_PLACEHOLDER) {
      return;
    }

    const position = getTightenedPlaceholderPosition(node);

    if (position) {
      tightenedPositions.set(node.id, position);
    }
  });
  nodes.forEach((node) => {
    if (node.type !== ENodeType.INDICATOR) {
      return;
    }

    const position = getPulledIndicatorPosition(node, tightenedPositions);

    if (position) {
      tightenedPositions.set(node.id, position);
    }
  });

  return nodes.map((node) => {
    const newPosition = tightenedPositions.get(node.id);

    return newPosition ? { ...node, position: newPosition } : node;
  });
};

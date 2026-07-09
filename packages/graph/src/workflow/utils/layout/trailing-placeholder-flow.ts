/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getNodesBounds, type Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import { FLOW_LAYER_GAP } from "./constants";
import {
  appendMapValue,
  applyPositionOverrides,
  getFlowCoordinate,
  getWorkflowNodeAxisEnd,
  indexNodes,
  isHorizontalDirection,
  withFlowCoordinate,
  type LayoutContext,
} from "./geometry";
import { isAttachmentEdge } from "./graph-maps";

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
  const nodesById = indexNodes(nodes);
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

  // Use the source's far edge, or the future group overlay's padded far edge.
  const sourceFlowEnd = (sourceId: string): number | undefined => {
    const sourceNode = nodesById.get(sourceId);

    if (sourceNode) {
      return getWorkflowNodeAxisEnd(sourceNode, ctx, isVertical, "flow");
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
    const padding = ctx.config?.highlights?.[group.operatorType]?.padding ?? 0;

    return (
      (isVertical ? bounds.y + bounds.height : bounds.x + bounds.width) +
      padding / 2
    );
  };
  const tightenedPositions = new Map<string, GraphNode["position"]>();

  nodes.forEach((node) => {
    if (node.type !== ENodeType.BRANCH_PLACEHOLDER) {
      return;
    }

    const sources = visibleSourcesByTarget.get(node.id) ?? [];

    if (
      sources.length !== 1 ||
      nodesById.get(sources[0])?.type === ENodeType.OPERATOR
    ) {
      return;
    }

    const flowEnd = sourceFlowEnd(sources[0]);

    if (flowEnd === undefined) {
      return;
    }

    const targetFlow = flowEnd + FLOW_LAYER_GAP;
    const currentFlow = getFlowCoordinate(node.position, isVertical);

    if (Math.abs(currentFlow - targetFlow) < 0.5) {
      return;
    }

    tightenedPositions.set(
      node.id,
      withFlowCoordinate(node.position, isVertical, targetFlow),
    );
  });

  nodes.forEach((node) => {
    if (node.type !== ENodeType.INDICATOR) {
      return;
    }

    const sources = (directSourcesByTarget.get(node.id) ?? []).filter((id) =>
      nodesById.has(id),
    );

    if (!sources.length) {
      return;
    }

    const maxSourceEnd = sources.reduce((max, sourceId) => {
      const srcNode = nodesById.get(sourceId);

      return srcNode
        ? Math.max(
            max,
            getWorkflowNodeAxisEnd(
              srcNode,
              ctx,
              isVertical,
              "flow",
              tightenedPositions.get(sourceId) ?? srcNode.position,
            ),
          )
        : max;
    }, -Infinity);

    if (!isFinite(maxSourceEnd)) {
      return;
    }

    const targetFlow = maxSourceEnd + FLOW_LAYER_GAP;
    const currentFlow = getFlowCoordinate(node.position, isVertical);

    // Only pull Stop left; alignBranchFlowOrigins handles rightward pushes.
    if (targetFlow < currentFlow - 0.5) {
      tightenedPositions.set(
        node.id,
        withFlowCoordinate(node.position, isVertical, targetFlow),
      );
    }
  });

  return applyPositionOverrides(nodes, tightenedPositions);
};

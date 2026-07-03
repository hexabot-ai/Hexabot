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
  isHorizontalDirection,
  type LayoutContext,
  withFlowCoordinate,
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
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const visibleSourcesByTarget = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (isAttachmentEdge(edge) || edge.hidden) {
      return;
    }

    appendMapValue(visibleSourcesByTarget, edge.target, edge.source);
  });

  // The flow-axis edge a source's outgoing link leaves from: the node's far
  // edge, or the padded far edge of a group's member bounds when the link
  // comes from a group overlay (the overlay node doesn't exist yet at this
  // stage of the pipeline).
  const sourceFlowEnd = (sourceId: string): number | undefined => {
    const sourceNode = nodesById.get(sourceId);

    if (sourceNode) {
      return (
        getFlowCoordinate(sourceNode.position, isVertical) +
        getFlowSize(
          getWorkflowNodeDimensions(sourceNode.type, ctx.config),
          isVertical,
        )
      );
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

  return nodes.map((node) => {
    if (node.type !== ENodeType.BRANCH_PLACEHOLDER) {
      return node;
    }

    const sources = visibleSourcesByTarget.get(node.id) ?? [];

    // A join placeholder (several branches converging on it) marks a shared
    // convergence point, and an operator-fed placeholder is an empty branch —
    // both keep their position. Only a placeholder trailing a single step or
    // group gets pulled.
    if (
      sources.length !== 1 ||
      nodesById.get(sources[0])?.type === ENodeType.OPERATOR
    ) {
      return node;
    }

    const flowEnd = sourceFlowEnd(sources[0]);

    if (flowEnd === undefined) {
      return node;
    }

    const targetFlow = flowEnd + FLOW_LAYER_GAP;
    const currentFlow = getFlowCoordinate(node.position, isVertical);

    if (Math.abs(currentFlow - targetFlow) < 0.5) {
      return node;
    }

    return {
      ...node,
      position: withFlowCoordinate(node.position, isVertical, targetFlow),
    };
  });
};

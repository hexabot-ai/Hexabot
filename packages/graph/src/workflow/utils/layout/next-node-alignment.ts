/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getNodesBounds, type Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";
import { getWorkflowNodeDimensions } from "../node-metrics.utils";

import {
  appendMapValue,
  average,
  getAxisCenter,
  getBoundsSpreadCenter,
  isHorizontalDirection,
  type LayoutContext,
  translateSpread,
} from "./geometry";
import { buildOutgoingMap, mapNodesToGroup } from "./graph-maps";

export const alignNextNodesWithPlaceholders = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
) => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingBySource = buildOutgoingMap(edges);
  const nodeToInnermostGroup = mapNodesToGroup(groups, "innermost");
  // Resolve the bounding-box center of each group so the alignment can use
  // it instead of each branch placeholder's individual position.
  // This keeps the "next" step aligned to the group's visual midpoint
  // (the center of the group rectangle), which is also where xyflow connects
  // overlay edges — keeping Start → group → Stop on the same axis.
  const groupBBoxCenterByGroupId = new Map<string, number>();

  groups.forEach((group, groupId) => {
    const memberNodes = [...group.memberNodeIds]
      .map((id) => nodesById.get(id))
      .filter((n): n is GraphNode => Boolean(n));

    if (!memberNodes.length) {
      return;
    }

    const bounds = getNodesBounds(memberNodes);

    groupBBoxCenterByGroupId.set(
      groupId,
      getBoundsSpreadCenter(bounds, isVertical),
    );
  });
  // Collect per-target spread-axis offset contributions grouped by the
  // *origin* group, so a Conditional with N branches contributes N entries
  // that all point to the same operator center. We average them per target.
  const offsetContributions = new Map<string, number[]>();

  nodes
    .filter((node) => node.type === ENodeType.BRANCH_PLACEHOLDER)
    .forEach((placeholder) => {
      const outgoingEdge = outgoingBySource.get(placeholder.id)?.[0];

      if (!outgoingEdge) {
        return;
      }

      const target = nodesById.get(outgoingEdge.targetId);

      if (!target) {
        return;
      }

      const originGroupId = nodeToInnermostGroup.get(placeholder.id);
      const groupBBoxCenter = originGroupId
        ? groupBBoxCenterByGroupId.get(originGroupId)
        : undefined;
      const targetDims = getWorkflowNodeDimensions(target.type, ctx.config);
      const placeholderDims = getWorkflowNodeDimensions(
        placeholder.type,
        ctx.config,
      );
      // Use the group's bounding-box center as the reference so the next step
      // aligns with the group's visual midpoint (where xyflow routes the exit
      // overlay edge).  Fall back to the placeholder's own center when there
      // is no group.
      const referenceCenter =
        groupBBoxCenter ??
        getAxisCenter(
          placeholder.position,
          placeholderDims,
          isVertical,
          "spread",
        );
      const targetCenter = getAxisCenter(
        target.position,
        targetDims,
        isVertical,
        "spread",
      );
      const offset = referenceCenter - targetCenter;

      if (offset !== 0) {
        appendMapValue(offsetContributions, target.id, offset);
      }
    });
  const offsets = new Map<string, number>();

  offsetContributions.forEach((contributions, targetId) => {
    const avgOffset = average(contributions);

    if (avgOffset === 0) {
      return;
    }

    const targetGroupId = nodeToInnermostGroup.get(targetId);
    const targetGroup = targetGroupId ? groups.get(targetGroupId) : undefined;
    const memberIds = targetGroup ? [...targetGroup.memberNodeIds] : [targetId];

    memberIds.forEach((id) => {
      offsets.set(id, (offsets.get(id) ?? 0) + avgOffset);
    });
  });

  return nodes.map((node) => {
    const offset = offsets.get(node.id);

    if (!offset) {
      return node;
    }

    return {
      ...node,
      position: translateSpread(node.position, isVertical, offset),
    };
  });
};

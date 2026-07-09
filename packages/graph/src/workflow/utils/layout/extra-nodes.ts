/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Position, type Edge } from "@xyflow/react";

import type { GraphNode } from "../../types/workflow-node.types";
import { getWorkflowNodeDimensions } from "../node-metrics.utils";

import { EXTRA_NODE_GAP, EXTRA_NODE_OFFSET } from "./constants";
import {
  appendMapValue,
  indexNodes,
  getFlowCoordinate,
  getFlowSize,
  getSpreadCoordinate,
  getSpreadSize,
  isHorizontalDirection,
  withFlowCoordinate,
  withSpreadCoordinate,
  type LayoutContext,
} from "./geometry";

export const addExtraNodes = (
  nodes: GraphNode[],
  edges: Edge[],
  ctx: LayoutContext,
) => {
  const nodesById = indexNodes(nodes);
  const isVertical = !isHorizontalDirection(ctx);
  const adjacencyMap = new Map<string, GraphNode[]>();
  const incomingAttachmentCounts = new Map<string, number>();

  edges.forEach(({ source, target }) => {
    const targetNode = nodesById.get(target);

    if (nodesById.has(source) && targetNode) {
      appendMapValue(adjacencyMap, source, targetNode);
      incomingAttachmentCounts.set(
        target,
        (incomingAttachmentCounts.get(target) ?? 0) + 1,
      );
    }
  });

  if (adjacencyMap.size === 0) {
    return nodes;
  }

  const overrides = new Map<
    string,
    Pick<GraphNode, "position" | "targetPosition" | "sourcePosition">
  >();
  const resolvedPositions = new Map(
    nodes.map((node) => [node.id, node.position]),
  );
  const remainingIncoming = new Map(incomingAttachmentCounts);
  const sourceIds = [...adjacencyMap.keys()];
  const queue = sourceIds.filter(
    (sourceId) => (remainingIncoming.get(sourceId) ?? 0) === 0,
  );
  const queued = new Set(queue.length ? queue : sourceIds);
  const processed = new Set<string>();

  if (!queue.length) {
    queue.push(...sourceIds);
  }

  const enqueueSource = (sourceId: string) => {
    if (
      adjacencyMap.has(sourceId) &&
      !queued.has(sourceId) &&
      !processed.has(sourceId)
    ) {
      queue.push(sourceId);
      queued.add(sourceId);
    }
  };
  const positionTargets = (sourceId: string) => {
    const sourceNode = nodesById.get(sourceId);
    const targets = adjacencyMap.get(sourceId);

    if (!sourceNode || !targets?.length) {
      return;
    }

    const sourcePosition =
      resolvedPositions.get(sourceId) ?? sourceNode.position;
    const sourceDimensions = getWorkflowNodeDimensions(
      sourceNode.type,
      ctx.config,
    );
    const sourceFlow = getFlowCoordinate(sourcePosition, isVertical);
    const sourceSpread = getSpreadCoordinate(sourcePosition, isVertical);
    const sourceFlowSize = getFlowSize(sourceDimensions, isVertical);
    const sourceSpreadSize = getSpreadSize(sourceDimensions, isVertical);
    const targetsWithDimensions = targets.map((node) => {
      const dimensions = getWorkflowNodeDimensions(node.type, ctx.config);

      return {
        node,
        flowSize: getFlowSize(dimensions, isVertical),
        spreadSize: getSpreadSize(dimensions, isVertical),
      };
    });
    const totalBreadth =
      targetsWithDimensions.reduce((sum, { flowSize }) => sum + flowSize, 0) +
      EXTRA_NODE_GAP * (targets.length - 1);
    let cursor = sourceFlow + (sourceFlowSize - totalBreadth) / 2;

    targetsWithDimensions.forEach(({ node, flowSize, spreadSize }) => {
      const position = withSpreadCoordinate(
        withFlowCoordinate(sourcePosition, isVertical, cursor),
        isVertical,
        isVertical
          ? sourceSpread - EXTRA_NODE_OFFSET - spreadSize
          : sourceSpread + sourceSpreadSize + EXTRA_NODE_OFFSET,
      );

      overrides.set(node.id, {
        position,
        targetPosition: isVertical ? Position.Right : Position.Top,
        sourcePosition: isVertical ? Position.Left : Position.Bottom,
      });
      resolvedPositions.set(node.id, position);
      cursor += flowSize + EXTRA_NODE_GAP;

      const nextRemainingIncoming = (remainingIncoming.get(node.id) ?? 0) - 1;

      remainingIncoming.set(node.id, nextRemainingIncoming);

      if (nextRemainingIncoming <= 0) {
        enqueueSource(node.id);
      }
    });
  };

  // Nested attachment targets must read their parent's overridden coordinates.
  while (queue.length) {
    const sourceId = queue.shift()!;

    queued.delete(sourceId);

    if (!processed.has(sourceId)) {
      processed.add(sourceId);
      positionTargets(sourceId);
    }
  }

  sourceIds.forEach((sourceId) => {
    if (!processed.has(sourceId)) {
      positionTargets(sourceId);
      processed.add(sourceId);
    }
  });

  return nodes.map((node) => ({
    ...node,
    ...overrides.get(node.id),
  }));
};

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
  getFlowCoordinate,
  getFlowSize,
  getSpreadCoordinate,
  getSpreadSize,
  isHorizontalDirection,
  type LayoutContext,
  withFlowCoordinate,
  withSpreadCoordinate,
} from "./geometry";

export const addExtraNodes = (
  nodes: GraphNode[],
  edges: Edge[],
  ctx: LayoutContext,
) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const isVertical = !isHorizontalDirection(ctx);
  const adjacencyMap = new Map<string, GraphNode[]>();
  const incomingAttachmentCounts = new Map<string, number>();

  edges.forEach(({ source, target }) => {
    const sourceNode = nodesById.get(source);
    const targetNode = nodesById.get(target);

    if (sourceNode && targetNode) {
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
  const queued = new Set(queue);
  const processed = new Set<string>();

  if (!queue.length) {
    sourceIds.forEach((sourceId) => {
      queue.push(sourceId);
      queued.add(sourceId);
    });
  }

  const enqueueSource = (sourceId: string) => {
    if (
      !adjacencyMap.has(sourceId) ||
      queued.has(sourceId) ||
      processed.has(sourceId)
    ) {
      return;
    }

    queue.push(sourceId);
    queued.add(sourceId);
  };
  const positionTargets = (sourceId: string) => {
    const targets = adjacencyMap.get(sourceId);
    const sourceNode = nodesById.get(sourceId);

    if (!sourceNode || !targets?.length) {
      return;
    }

    const sourcePosition =
      resolvedPositions.get(sourceId) ?? sourceNode.position;
    const sourceDimensions = getWorkflowNodeDimensions(
      sourceNode.type,
      ctx.config,
    );
    const targetsWithDimensions = targets.map((target) => ({
      node: target,
      dimensions: getWorkflowNodeDimensions(target.type, ctx.config),
    }));
    const totalBreadth =
      targetsWithDimensions.reduce(
        (sum, target) => sum + getFlowSize(target.dimensions, isVertical),
        0,
      ) +
      EXTRA_NODE_GAP * (targets.length - 1);

    let cursor =
      getFlowCoordinate(sourcePosition, isVertical) +
      (getFlowSize(sourceDimensions, isVertical) - totalBreadth) / 2;

    targetsWithDimensions.forEach(({ node, dimensions }) => {
      const spreadPosition = isVertical
        ? getSpreadCoordinate(sourcePosition, isVertical) -
          EXTRA_NODE_OFFSET -
          getSpreadSize(dimensions, isVertical)
        : getSpreadCoordinate(sourcePosition, isVertical) +
          getSpreadSize(sourceDimensions, isVertical) +
          EXTRA_NODE_OFFSET;
      const position = withSpreadCoordinate(
        withFlowCoordinate(sourcePosition, isVertical, cursor),
        isVertical,
        spreadPosition,
      );

      overrides.set(node.id, {
        position,
        targetPosition: isVertical ? Position.Right : Position.Top,
        sourcePosition: isVertical ? Position.Left : Position.Bottom,
      });
      resolvedPositions.set(node.id, position);
      cursor += getFlowSize(dimensions, isVertical) + EXTRA_NODE_GAP;

      const nextRemainingIncoming = (remainingIncoming.get(node.id) ?? 0) - 1;

      remainingIncoming.set(node.id, nextRemainingIncoming);

      if (nextRemainingIncoming <= 0) {
        enqueueSource(node.id);
      }
    });
  };

  // Nested attachment targets must read their parent's overridden coordinates.
  while (queue.length) {
    const sourceId = queue.shift();

    if (!sourceId) {
      continue;
    }

    queued.delete(sourceId);

    if (processed.has(sourceId)) {
      continue;
    }

    processed.add(sourceId);
    positionTargets(sourceId);
  }

  sourceIds.forEach((sourceId) => {
    if (processed.has(sourceId)) {
      return;
    }

    positionTargets(sourceId);
    processed.add(sourceId);
  });

  return nodes.map((node) => ({
    ...node,
    ...overrides.get(node.id),
  }));
};

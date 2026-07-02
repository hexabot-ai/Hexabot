/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ENodeType,
  type GraphNode,
  type INodeConfig,
} from "../../types/workflow-node.types";
import { getWorkflowNodeDimensions } from "../node-metrics.utils";

export type LayoutContext = {
  config?: INodeConfig;
};

export const isHorizontalDirection = (ctx: LayoutContext) =>
  (ctx.config?.direction ?? "horizontal") === "horizontal";

export type NodeDimensions = {
  width: number;
  height: number;
};

export type NodePosition = GraphNode["position"];
export type Axis = "flow" | "spread";
export type AxisBounds = { leading: number; trailing: number };

export const appendMapValue = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const values = map.get(key);

  if (values) {
    values.push(value);

    return;
  }

  map.set(key, [value]);
};
export const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
export const getFlowCoordinate = (
  position: NodePosition,
  isVertical: boolean,
) => (isVertical ? position.y : position.x);
export const getSpreadCoordinate = (
  position: NodePosition,
  isVertical: boolean,
) => (isVertical ? position.x : position.y);
export const getAxisCoordinate = (
  position: NodePosition,
  isVertical: boolean,
  axis: Axis,
) =>
  axis === "flow"
    ? getFlowCoordinate(position, isVertical)
    : getSpreadCoordinate(position, isVertical);
export const getFlowSize = (dimensions: NodeDimensions, isVertical: boolean) =>
  isVertical ? dimensions.height : dimensions.width;
export const getSpreadSize = (
  dimensions: NodeDimensions,
  isVertical: boolean,
) => (isVertical ? dimensions.width : dimensions.height);
export const getAxisSize = (
  dimensions: NodeDimensions,
  isVertical: boolean,
  axis: Axis,
) =>
  axis === "flow"
    ? getFlowSize(dimensions, isVertical)
    : getSpreadSize(dimensions, isVertical);
export const withFlowCoordinate = (
  position: NodePosition,
  isVertical: boolean,
  value: number,
) => (isVertical ? { ...position, y: value } : { ...position, x: value });
export const withSpreadCoordinate = (
  position: NodePosition,
  isVertical: boolean,
  value: number,
) => (isVertical ? { ...position, x: value } : { ...position, y: value });
export const translateFlow = (
  position: NodePosition,
  isVertical: boolean,
  delta: number,
) =>
  isVertical
    ? { x: position.x, y: position.y + delta }
    : { x: position.x + delta, y: position.y };
export const translateSpread = (
  position: NodePosition,
  isVertical: boolean,
  delta: number,
) =>
  isVertical
    ? { x: position.x + delta, y: position.y }
    : { x: position.x, y: position.y + delta };
export const getAxisCenter = (
  position: NodePosition,
  dimensions: NodeDimensions,
  isVertical: boolean,
  axis: Axis,
) =>
  getAxisCoordinate(position, isVertical, axis) +
  getAxisSize(dimensions, isVertical, axis) / 2;
export const getBoundsSpreadCenter = (
  bounds: { x: number; y: number; width: number; height: number },
  isVertical: boolean,
) => (isVertical ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2);
export const getGraphNodeDimensions = (
  node: GraphNode,
  ctx: LayoutContext,
): NodeDimensions => {
  if (node.type !== ENodeType.GROUP) {
    return getWorkflowNodeDimensions(node.type, ctx.config);
  }

  const style = node.style as { width?: number; height?: number } | undefined;

  return {
    width: style?.width ?? 0,
    height: style?.height ?? 0,
  };
};
export const getPositionedNodeAxisBounds = (
  nodeId: string,
  positions: Map<string, NodePosition>,
  nodesById: Map<string, GraphNode>,
  ctx: LayoutContext,
  isVertical: boolean,
  axis: Axis,
): AxisBounds | undefined => {
  const node = nodesById.get(nodeId);

  if (!node) {
    return;
  }

  const position = positions.get(nodeId) ?? node.position;
  const dimensions = getGraphNodeDimensions(node, ctx);
  const leading = getAxisCoordinate(position, isVertical, axis);

  return {
    leading,
    trailing: leading + getAxisSize(dimensions, isVertical, axis),
  };
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Position, type Edge } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";

import {
  EHandleType,
  ENodeType,
  getWorkflowPortId,
  type GraphNode,
  type WorkflowNodePort,
  type WorkflowPort,
} from "../../types/workflow-node.types";
import { getWorkflowNodeDimensions } from "../node-metrics.utils";
import { resolveWorkflowPortRule } from "../port-rules";

import {
  ELK_NODE_NODE_SPACING,
  EXTRA_NODE_GAP,
  EXTRA_NODE_OFFSET,
  FLOW_LAYER_GAP,
} from "./constants";
import {
  appendMapValue,
  getFlowSize,
  getSpreadSize,
  isHorizontalDirection,
  type LayoutContext,
  type NodeDimensions,
} from "./geometry";
import { isAttachmentEdge } from "./graph-maps";

const elk = new ELK();
const getElkSide = (position: Position) => {
  switch (position) {
    case Position.Top:
      return "NORTH";
    case Position.Bottom:
      return "SOUTH";
    case Position.Left:
      return "WEST";
    case Position.Right:
      return "EAST";
    default:
      return "EAST";
  }
};

type ElkPort = {
  handleId: WorkflowPort;
  elkId: string;
  side: string;
  type: EHandleType;
};

type ElkModel = {
  graph: {
    id: string;
    layoutOptions: Record<string, string>;
    children: Array<{
      id: string;
      width: number;
      height: number;
      layoutOptions: Record<string, string>;
      ports: Array<{
        id: string;
        x?: number;
        y?: number;
        properties: Record<string, string>;
      }>;
    }>;
    edges: Array<{
      id: string;
      sources: string[];
      targets: string[];
    }>;
  };
  nodeOffsets: Map<string, { x: number; y: number }>;
};

const toElk = (nodes: GraphNode[], edges: Edge[], ctx: LayoutContext) => {
  const isVertical = !isHorizontalDirection(ctx);
  const direction = ctx.config?.direction ?? "horizontal";
  const elkDirection = isVertical ? "DOWN" : "RIGHT";
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const attachmentTargetsBySource = new Map<string, GraphNode[]>();

  edges.forEach((edge) => {
    if (!isAttachmentEdge(edge)) {
      return;
    }

    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (!sourceNode || !targetNode) {
      return;
    }

    appendMapValue(attachmentTargetsBySource, edge.source, targetNode);
  });
  const layoutDimensions = new Map<string, NodeDimensions>();
  const nodePorts = new Map<string, ElkPort[]>();
  const nodeOffsets = new Map<string, { x: number; y: number }>();
  const resolveLayoutDimensions = (
    nodeId: string,
    visited = new Set<string>(),
  ): NodeDimensions => {
    const memoized = layoutDimensions.get(nodeId);

    if (memoized) {
      return memoized;
    }

    const node = nodeMap.get(nodeId);

    if (!node) {
      return { width: 0, height: 0 };
    }

    const sourceDimensions = getWorkflowNodeDimensions(node.type, ctx.config);
    const targets = attachmentTargetsBySource.get(nodeId) ?? [];

    if (!targets.length || visited.has(nodeId)) {
      layoutDimensions.set(nodeId, sourceDimensions);

      return sourceDimensions;
    }

    visited.add(nodeId);

    const targetDimensions = targets.map((target) =>
      resolveLayoutDimensions(target.id, visited),
    );
    const totalBreadth =
      targetDimensions.reduce(
        (sum, dimensions) => sum + getFlowSize(dimensions, isVertical),
        0,
      ) +
      EXTRA_NODE_GAP * (targets.length - 1);
    const maxAttachmentCrossSize = Math.max(
      ...targetDimensions.map((dimensions) =>
        getSpreadSize(dimensions, isVertical),
      ),
    );
    const dimensions = isVertical
      ? {
          width:
            sourceDimensions.width + EXTRA_NODE_OFFSET + maxAttachmentCrossSize,
          height: Math.max(sourceDimensions.height, totalBreadth),
        }
      : {
          width: Math.max(sourceDimensions.width, totalBreadth),
          height:
            sourceDimensions.height +
            EXTRA_NODE_OFFSET +
            maxAttachmentCrossSize,
        };

    visited.delete(nodeId);
    layoutDimensions.set(nodeId, dimensions);

    return dimensions;
  };
  const resolvePort = (
    ports: ElkPort[] | undefined,
    preferredHandle?: string | null,
    preferredType?: EHandleType,
  ) => {
    if (!ports?.length) {
      return;
    }

    if (preferredHandle) {
      const handlePort = ports.find(
        (port) => port.handleId === preferredHandle,
      );

      if (handlePort) {
        return handlePort.elkId;
      }
    }

    if (preferredType) {
      const typedPort = ports.find((port) => port.type === preferredType);

      if (typedPort) {
        return typedPort.elkId;
      }
    }

    return ports[0]?.elkId;
  };
  const graph: ElkModel["graph"] = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "org.eclipse.elk.direction": elkDirection,
      "elk.spacing.nodeNode": String(ELK_NODE_NODE_SPACING),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(FLOW_LAYER_GAP),
      "org.eclipse.elk.layered.considerModelOrder.strategy": "PREFER_NODES",
      "org.eclipse.elk.layered.crossingMinimization.forceNodeModelOrder":
        "true",
      "org.eclipse.elk.layered.considerModelOrder.crossingCounterNodeInfluence":
        "0.001",
      "org.eclipse.elk.randomSeed": "1",
    },
    children: nodes.map((node) => {
      const ports =
        (node.data as { ports?: WorkflowNodePort<ENodeType>[] })?.ports?.map(
          (portDef) => {
            const handleId = getWorkflowPortId(portDef);
            const portRule = resolveWorkflowPortRule(handleId, direction);

            return {
              handleId,
              elkId: `${node.id}__${handleId}`,
              side: getElkSide(portRule.position),
              type: portRule.type,
            } as ElkPort;
          },
        ) ?? [];

      nodePorts.set(node.id, ports);

      const dimensions =
        layoutDimensions.get(node.id) ?? resolveLayoutDimensions(node.id);
      const sourceDimensions = getWorkflowNodeDimensions(node.type, ctx.config);
      const flowOffset = Math.max(
        0,
        (getFlowSize(dimensions, isVertical) -
          getFlowSize(sourceDimensions, isVertical)) /
          2,
      );
      const offset = isVertical
        ? { x: 0, y: flowOffset }
        : { x: flowOffset, y: 0 };

      nodeOffsets.set(node.id, offset);

      // Pin ports to the visible card when attachments inflate the ELK box.
      const isInflated =
        dimensions.width !== sourceDimensions.width ||
        dimensions.height !== sourceDimensions.height;
      const portsBySide = new Map<string, ElkPort[]>();

      ports.forEach((port) => appendMapValue(portsBySide, port.side, port));

      const getPortCoordinates = (port: ElkPort) => {
        const sidePorts = portsBySide.get(port.side) ?? [];
        const ratio = (sidePorts.indexOf(port) + 1) / (sidePorts.length + 1);

        return {
          x:
            port.side === "WEST"
              ? 0
              : port.side === "EAST"
                ? dimensions.width
                : offset.x + sourceDimensions.width * ratio,
          y:
            port.side === "NORTH"
              ? 0
              : port.side === "SOUTH"
                ? dimensions.height
                : offset.y + sourceDimensions.height * ratio,
        };
      };

      return {
        id: node.id,
        ...dimensions,
        layoutOptions: {
          "org.eclipse.elk.portConstraints": isInflated
            ? "FIXED_POS"
            : "FIXED_ORDER",
        },
        ports: ports.map((port) => ({
          id: port.elkId,
          ...(isInflated ? getPortCoordinates(port) : {}),
          properties: { "org.eclipse.elk.port.side": port.side },
        })),
      };
    }),
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => {
        return {
          id: edge.id,
          sources: [
            resolvePort(
              nodePorts.get(edge.source),
              edge.sourceHandle,
              EHandleType.SOURCE,
            ) ?? `${edge.source}__out`,
          ],
          targets: [
            resolvePort(
              nodePorts.get(edge.target),
              edge.targetHandle,
              EHandleType.TARGET,
            ) ?? `${edge.target}__in`,
          ],
        };
      }),
  };

  return { graph, nodeOffsets };
};

export const layoutNodesWithElk = async (
  nodes: GraphNode[],
  edges: Edge[],
  ctx: LayoutContext,
) => {
  const model = toElk(nodes, edges, ctx);
  const graph = await elk.layout(model.graph);
  const positions = new Map<string, { x: number; y: number }>();

  graph.children?.forEach((child: any) => {
    const offset = model.nodeOffsets.get(child.id) ?? { x: 0, y: 0 };

    positions.set(child.id, {
      x: child.x + offset.x,
      y: child.y + offset.y,
    });
  });

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
};

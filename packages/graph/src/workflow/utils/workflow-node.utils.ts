/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getNodesBounds, Position, type Edge } from "@xyflow/react";
import type { ResizeControlDirection } from "@xyflow/system";
import ELK from "elkjs/lib/elk.bundled.js";

import {
  DEFAULT_NODE_PROPS,
  EDGE_STYLES,
  NODE_DEFINITIONS,
  NODE_DIMENSIONS,
  NODE_METRICS,
  OPERATOR_HIGHLIGHTS,
} from "../constants/workflow.constants";
import {
  EHandleType,
  ENodeType,
  getWorkflowPortId,
  type GraphNode,
  type IBuildNodesAndEdgesProps,
  type INodeConfig,
  type WorkflowNodePort,
  type WorkflowPort,
} from "../types/workflow-node.types";

import { withAlpha } from "./color.utils";
import { decorateSemanticGraph } from "./graph-builder/decorate";
import { projectSemanticGraph } from "./graph-builder/project";
import { traverseWorkflow } from "./graph-builder/traverse";
import type { GroupMeta } from "./graph-builder/types";
import { getWorkflowNodeDimensions } from "./node-metrics.utils";
import {
  isAttachmentSourceHandle,
  resolveWorkflowPortRule,
} from "./port-rules";

const elk = new ELK();
const GROUP_MIN_PADDING = 32;
const GROUP_PADDING_DECAY_PER_LEVEL = 16;
const GROUP_BASE_ALPHA = 0.22;
const GROUP_ALPHA_DECAY_PER_LEVEL = 0.05;
const GROUP_MIN_ALPHA = 0.08;
const EXTRA_NODE_OFFSET = 200;
const EXTRA_NODE_GAP = 56;
const getGroupPadding = (basePadding: number, level: number) =>
  Math.max(
    GROUP_MIN_PADDING,
    basePadding - level * GROUP_PADDING_DECAY_PER_LEVEL,
  );
const getGroupBackgroundAlpha = (level: number) =>
  Math.max(
    GROUP_MIN_ALPHA,
    GROUP_BASE_ALPHA - level * GROUP_ALPHA_DECAY_PER_LEVEL,
  );

type LayoutContext = {
  config?: INodeConfig;
};

const isHorizontalDirection = (ctx: LayoutContext) =>
  (ctx.config?.direction ?? "horizontal") === "horizontal";
const isAttachmentEdge = (edge: Edge) =>
  isAttachmentSourceHandle(edge.sourceHandle);
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

type NodeDimensions = {
  width: number;
  height: number;
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
  const attachmentTargetsBySource = edges.reduce((acc, edge) => {
    if (!isAttachmentEdge(edge)) {
      return acc;
    }

    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (!sourceNode || !targetNode) {
      return acc;
    }

    acc.set(edge.source, [...(acc.get(edge.source) ?? []), targetNode]);

    return acc;
  }, new Map<string, GraphNode[]>());
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
        (sum, dimensions) =>
          sum + (isVertical ? dimensions.height : dimensions.width),
        0,
      ) +
      EXTRA_NODE_GAP * (targets.length - 1);
    const maxAttachmentCrossSize = Math.max(
      ...targetDimensions.map((dimensions) =>
        isVertical ? dimensions.width : dimensions.height,
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
      "elk.spacing.nodeNode": "64",
      "elk.layered.spacing.nodeNodeBetweenLayers": "186",
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
      const offset = isVertical
        ? {
            x: Math.max(0, dimensions.width - sourceDimensions.width),
            y: Math.max(0, (dimensions.height - sourceDimensions.height) / 2),
          }
        : {
            x: Math.max(0, (dimensions.width - sourceDimensions.width) / 2),
            y: 0,
          };

      nodeOffsets.set(node.id, offset);

      return {
        id: node.id,
        ...dimensions,
        layoutOptions: {
          "org.eclipse.elk.portConstraints": "FIXED_ORDER",
        },
        ports: ports.map((port) => ({
          id: port.elkId,
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
const layoutNodesWithElk = async (
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
const addExtraNodes = (
  nodes: GraphNode[],
  edges: Edge[],
  ctx: LayoutContext,
) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const isHorizontal = isHorizontalDirection(ctx);
  const adjacencyMap = new Map<string, GraphNode[]>();
  const incomingAttachmentCounts = new Map<string, number>();

  edges.forEach(({ source, target }) => {
    const sourceNode = nodesById.get(source);
    const targetNode = nodesById.get(target);

    if (sourceNode && targetNode) {
      adjacencyMap.set(source, [
        ...(adjacencyMap.get(source) ?? []),
        targetNode,
      ]);
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
        (sum, target) =>
          sum +
          (isHorizontal ? target.dimensions.width : target.dimensions.height),
        0,
      ) +
      EXTRA_NODE_GAP * (targets.length - 1);

    let cursor = isHorizontal
      ? sourcePosition.x + (sourceDimensions.width - totalBreadth) / 2
      : sourcePosition.y + (sourceDimensions.height - totalBreadth) / 2;

    targetsWithDimensions.forEach(({ node, dimensions }) => {
      const position = isHorizontal
        ? {
            x: cursor,
            y: sourcePosition.y + sourceDimensions.height + EXTRA_NODE_OFFSET,
          }
        : {
            x: sourcePosition.x - EXTRA_NODE_OFFSET - dimensions.width,
            y: cursor,
          };

      overrides.set(node.id, {
        position,
        targetPosition: isHorizontal ? Position.Top : Position.Right,
        sourcePosition: isHorizontal ? Position.Bottom : Position.Left,
      });
      resolvedPositions.set(node.id, position);
      cursor +=
        (isHorizontal ? dimensions.width : dimensions.height) + EXTRA_NODE_GAP;

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
const getGroupNodes = (
  nodes: GraphNode[],
  groups: Map<string, GroupMeta>,
  config: INodeConfig,
  attachmentEdges: Edge[],
) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const attachmentChildrenByParent = new Map<string, Set<string>>();

  attachmentEdges.forEach(({ source, target }) => {
    if (!nodesById.has(source) || !nodesById.has(target)) {
      return;
    }

    if (!attachmentChildrenByParent.has(source)) {
      attachmentChildrenByParent.set(source, new Set());
    }

    attachmentChildrenByParent.get(source)!.add(target);
  });

  const collectAttachmentDescendants = (rootId: string): string[] => {
    const result: string[] = [];
    const stack = [rootId];

    while (stack.length) {
      const current = stack.pop()!;
      const children = attachmentChildrenByParent.get(current);

      if (!children) {
        continue;
      }

      children.forEach((childId) => {
        if (!nodesById.has(childId)) {
          return;
        }

        result.push(childId);
        stack.push(childId);
      });
    }

    return result;
  };
  const groupNodes: GraphNode<ENodeType.GROUP>[] = [];

  groups.forEach((group) => {
    const groupMemberIds = [...group.memberNodeIds].filter((nodeId) =>
      nodesById.has(nodeId),
    );

    if (!groupMemberIds.length) {
      return;
    }

    const boundsMemberIds = [
      ...groupMemberIds,
      ...groupMemberIds.flatMap(collectAttachmentDescendants),
    ];
    const boundsMembers = boundsMemberIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is GraphNode => Boolean(node));
    const color = config.highlights?.[group.operatorType]?.color;
    const basePadding = config.highlights?.[group.operatorType]?.padding || 0;
    const padding = getGroupPadding(basePadding, group.level);
    const backgroundAlpha = getGroupBackgroundAlpha(group.level);
    const bounds = getNodesBounds(boundsMembers);

    groupNodes.push({
      ...DEFAULT_NODE_PROPS,
      id: group.id,
      type: ENodeType.GROUP,
      position: {
        x: bounds.x - padding / 2,
        y: bounds.y - padding / 2,
      },
      data: config.nodes[ENodeType.GROUP],
      style: {
        width: bounds.width + padding,
        height: bounds.height + padding,
        zIndex: -1,
        borderRadius: "1rem",
        backgroundColor: color ? withAlpha(color, backgroundAlpha) : undefined,
        border: `1px solid ${withAlpha("#0004", backgroundAlpha)}`,
      },
    });
  });

  return groupNodes;
};

export const buildNodesAndEdges = async ({
  config,
  flow,
  defs,
  actionCatalog,
  bindingCatalog,
}: IBuildNodesAndEdgesProps): Promise<
  { nodes: GraphNode[]; edges: Edge[] } | undefined
> => {
  if (!flow?.length) {
    return;
  }

  const traversal = traverseWorkflow({
    flow,
    config,
    defs,
    actionCatalog,
    bindingCatalog,
  });

  decorateSemanticGraph(traversal.registry);

  const projected = projectSemanticGraph(traversal.registry, config);
  const elkNodes = await layoutNodesWithElk(projected.nodes, projected.edges, {
    config,
  });
  const positionedNodes = addExtraNodes(
    elkNodes,
    projected.edges.filter(isAttachmentEdge),
    {
      config,
    },
  );
  const groupNodes = getGroupNodes(
    positionedNodes,
    traversal.groups,
    config,
    projected.edges.filter(isAttachmentEdge),
  );

  return {
    edges: projected.edges,
    nodes: [...groupNodes, ...positionedNodes],
  };
};

export const getWorkflowDefaultConfig = (direction?: ResizeControlDirection) =>
  ({
    direction,
    nodeMetrics: NODE_METRICS,
    dimensions: NODE_DIMENSIONS,
    highlights: OPERATOR_HIGHLIGHTS,
    edges: EDGE_STYLES,
    nodes: NODE_DEFINITIONS,
  }) satisfies INodeConfig;

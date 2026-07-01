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
import {
  END_INDICATOR_ID,
  START_INDICATOR_ID,
} from "./graph-builder/id-factory";
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
const BRANCH_SPREAD_GAP = 64;
const EXTRA_NODE_OFFSET = 200;
const EXTRA_NODE_GAP = 56;
const ELK_NODE_NODE_SPACING = 64;
// Matches "elk.layered.spacing.nodeNodeBetweenLayers" below, so nodes we
// position ourselves (e.g. a shared convergence node pushed to clear real
// branch content) get the same flow-axis gap ELK uses everywhere else.
const FLOW_LAYER_GAP = 186;
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
const parseConditionalBranchIndex = (handle?: string | null): number => {
  if (!handle) {
    return -1;
  }

  const match = handle.match(/operatorOut-(\d+)-\d+/);

  return match ? parseInt(match[1], 10) : -1;
};
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

type NodePosition = GraphNode["position"];
type Axis = "flow" | "spread";
type AxisBounds = { leading: number; trailing: number };
type BranchTraversal = {
  mainFlowNodeIds: Set<string>;
  allNodeIds: Set<string>;
};
type OutgoingTarget = {
  targetId: string;
  sourceHandle?: string | null;
};

const appendMapValue = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const values = map.get(key);

  if (values) {
    values.push(value);

    return;
  }

  map.set(key, [value]);
};
const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const getFlowCoordinate = (position: NodePosition, isVertical: boolean) =>
  isVertical ? position.y : position.x;
const getSpreadCoordinate = (position: NodePosition, isVertical: boolean) =>
  isVertical ? position.x : position.y;
const getAxisCoordinate = (
  position: NodePosition,
  isVertical: boolean,
  axis: Axis,
) =>
  axis === "flow"
    ? getFlowCoordinate(position, isVertical)
    : getSpreadCoordinate(position, isVertical);
const getFlowSize = (dimensions: NodeDimensions, isVertical: boolean) =>
  isVertical ? dimensions.height : dimensions.width;
const getSpreadSize = (dimensions: NodeDimensions, isVertical: boolean) =>
  isVertical ? dimensions.width : dimensions.height;
const getAxisSize = (
  dimensions: NodeDimensions,
  isVertical: boolean,
  axis: Axis,
) =>
  axis === "flow"
    ? getFlowSize(dimensions, isVertical)
    : getSpreadSize(dimensions, isVertical);
const withFlowCoordinate = (
  position: NodePosition,
  isVertical: boolean,
  value: number,
) => (isVertical ? { ...position, y: value } : { ...position, x: value });
const withSpreadCoordinate = (
  position: NodePosition,
  isVertical: boolean,
  value: number,
) => (isVertical ? { ...position, x: value } : { ...position, y: value });
const translateFlow = (
  position: NodePosition,
  isVertical: boolean,
  delta: number,
) =>
  isVertical
    ? { x: position.x, y: position.y + delta }
    : { x: position.x + delta, y: position.y };
const translateSpread = (
  position: NodePosition,
  isVertical: boolean,
  delta: number,
) =>
  isVertical
    ? { x: position.x + delta, y: position.y }
    : { x: position.x, y: position.y + delta };
const getAxisCenter = (
  position: NodePosition,
  dimensions: NodeDimensions,
  isVertical: boolean,
  axis: Axis,
) =>
  getAxisCoordinate(position, isVertical, axis) +
  getAxisSize(dimensions, isVertical, axis) / 2;
const getBoundsSpreadCenter = (
  bounds: { x: number; y: number; width: number; height: number },
  isVertical: boolean,
) => (isVertical ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2);
const getGraphNodeDimensions = (
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
const getPositionedNodeAxisBounds = (
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
const buildOutgoingMap = (
  edges: Edge[],
  includeAttachments = false,
): Map<string, OutgoingTarget[]> => {
  const outgoingBySource = new Map<string, OutgoingTarget[]>();

  edges.forEach((edge) => {
    if (!includeAttachments && isAttachmentEdge(edge)) {
      return;
    }

    appendMapValue(outgoingBySource, edge.source, {
      targetId: edge.target,
      sourceHandle: edge.sourceHandle,
    });
  });

  return outgoingBySource;
};
const buildAttachmentMaps = (
  edges: Edge[],
  nodesById?: Map<string, GraphNode>,
) => {
  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();

  edges.forEach((edge) => {
    if (!isAttachmentEdge(edge)) {
      return;
    }

    if (
      nodesById &&
      (!nodesById.has(edge.source) || !nodesById.has(edge.target))
    ) {
      return;
    }

    appendMapValue(childrenByParent, edge.source, edge.target);
    parentByChild.set(edge.target, edge.source);
  });

  return { childrenByParent, parentByChild };
};
const buildMainFlowMaps = (edges: Edge[]) => {
  const outgoingBySource = new Map<string, OutgoingTarget[]>();
  const attachmentChildrenByParent = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (isAttachmentEdge(edge)) {
      appendMapValue(attachmentChildrenByParent, edge.source, edge.target);

      return;
    }

    appendMapValue(outgoingBySource, edge.source, {
      targetId: edge.target,
      sourceHandle: edge.sourceHandle,
    });
  });

  return { outgoingBySource, attachmentChildrenByParent };
};
const collectAttachmentDescendants = (
  rootId: string,
  attachmentChildrenByParent: Map<string, string[]>,
  nodesById: Map<string, GraphNode>,
): string[] => {
  const result: string[] = [];
  const stack = [rootId];

  while (stack.length) {
    const current = stack.pop()!;
    const children = attachmentChildrenByParent.get(current) ?? [];

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
const collectNodeIdsWithAttachmentDescendants = (
  nodeIds: Iterable<string>,
  attachmentChildrenByParent: Map<string, string[]>,
  nodesById: Map<string, GraphNode>,
): Set<string> => {
  const result = new Set<string>();

  for (const nodeId of nodeIds) {
    result.add(nodeId);

    if (!nodesById.has(nodeId)) {
      continue;
    }

    collectAttachmentDescendants(
      nodeId,
      attachmentChildrenByParent,
      nodesById,
    ).forEach((attachmentId) => result.add(attachmentId));
  }

  return result;
};
const mapNodesToGroup = (
  groups: Map<string, GroupMeta>,
  preference: "innermost" | "outermost",
) => {
  const nodeToGroup = new Map<string, string>();

  groups.forEach((group, groupId) => {
    group.memberNodeIds.forEach((nodeId) => {
      const existingGroupId = nodeToGroup.get(nodeId);

      if (!existingGroupId) {
        nodeToGroup.set(nodeId, groupId);

        return;
      }

      const existingLevel = groups.get(existingGroupId)?.level ?? 0;
      const shouldReplace =
        preference === "innermost"
          ? group.level > existingLevel
          : group.level < existingLevel;

      if (shouldReplace) {
        nodeToGroup.set(nodeId, groupId);
      }
    });
  });

  return nodeToGroup;
};
const getGroupOperatorNode = (
  group: GroupMeta,
  nodesById: Map<string, GraphNode>,
) =>
  [...group.memberNodeIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .find(
      (node) =>
        node.type === ENodeType.OPERATOR &&
        (node.data as { groupName?: string })?.groupName === group.id,
    );
const collectBranchNodeIds = ({
  startId,
  group,
  groups,
  nodesById,
  outgoingBySource,
  attachmentChildrenByParent,
}: {
  startId: string;
  group: GroupMeta;
  groups: Map<string, GroupMeta>;
  nodesById: Map<string, GraphNode>;
  outgoingBySource: Map<string, OutgoingTarget[]>;
  attachmentChildrenByParent: Map<string, string[]>;
}): BranchTraversal => {
  const mainFlowNodeIds = new Set<string>();
  const queue = [startId];

  while (queue.length) {
    const current = queue.shift()!;

    if (mainFlowNodeIds.has(current) || !group.memberNodeIds.has(current)) {
      continue;
    }

    mainFlowNodeIds.add(current);

    (outgoingBySource.get(current) ?? []).forEach(({ targetId }) => {
      if (!mainFlowNodeIds.has(targetId) && group.memberNodeIds.has(targetId)) {
        queue.push(targetId);
      }
    });
  }

  const allNodeIds = collectNodeIdsWithAttachmentDescendants(
    mainFlowNodeIds,
    attachmentChildrenByParent,
    nodesById,
  );

  groups.forEach((candidateGroup, candidateGroupId) => {
    if (candidateGroupId === group.id || candidateGroup.level <= group.level) {
      return;
    }

    const isBranchGroup = [...candidateGroup.memberNodeIds].some((nodeId) =>
      mainFlowNodeIds.has(nodeId),
    );

    if (isBranchGroup && nodesById.has(candidateGroupId)) {
      allNodeIds.add(candidateGroupId);
    }
  });

  return { mainFlowNodeIds, allNodeIds };
};
const countNodeIds = (nodeIdCollections: Iterable<Iterable<string>>) => {
  const counts = new Map<string, number>();

  for (const nodeIds of nodeIdCollections) {
    for (const nodeId of nodeIds) {
      counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
    }
  }

  return counts;
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
/**
 * For every empty conditional branch (i.e. a BRANCH_PLACEHOLDER whose sole
 * incoming edge originates directly from an OPERATOR node):
 *
 * 1. **Flow-direction alignment** – shift the placeholder's flow-axis position
 *    (x in horizontal mode, y in vertical mode) to match the first task/operator
 *    node of any sibling non-empty branch, so it starts at the same depth as
 *    the branch content.
 *
 * 2. **Branch-spread positioning** – ELK compresses empty-branch placeholders
 *    and may place them at y-positions that collide with nodes from other
 *    branches once the x-alignment moves them into the same column.  This pass
 *    always derives a safe spread-axis position from the branch-index order:
 *
 *      targetSpread = anchorSpread + gap × (emptyBranchIndex − anchorBranchIndex)
 *
 *    where `anchorSpread` is the ELK-assigned spread position of the nearest
 *    non-empty branch first-node, and `gap` is the uniform inter-branch spacing
 *    measured from ELK's layout.  This guarantees:
 *    - Visual order matches branch-index order (branch 0 above branch 1 above …)
 *    - No collisions with sibling non-empty branch nodes
 *    - Non-empty branch nodes are never moved
 *
 * In horizontal mode: flow axis = x, branch-spread axis = y.
 * In vertical mode:   flow axis = y, branch-spread axis = x.
 */
const alignEmptyBranchPlaceholders = (
  nodes: GraphNode[],
  edges: Edge[],
  ctx: LayoutContext,
): GraphNode[] => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingBySource = buildOutgoingMap(edges, true);
  const { childrenByParent: attachmentChildrenByParent } = buildAttachmentMaps(
    edges,
    nodesById,
  );
  // Compute the full spread-axis extent of a node including all its attachment
  // descendants.  In horizontal mode attachments extend below the task (y+h),
  // in vertical mode they extend to the left so they do NOT increase x+w.
  const nodeSpreadExtent = (node: GraphNode): number => {
    const dims = getWorkflowNodeDimensions(node.type, ctx.config);
    let maxExtent =
      getSpreadCoordinate(node.position, isVertical) +
      getSpreadSize(dims, isVertical);

    if (!isVertical) {
      // Horizontal mode: attachments are placed below the task.
      // Walk the attachment tree to find the furthest bottom edge.
      collectAttachmentDescendants(
        node.id,
        attachmentChildrenByParent,
        nodesById,
      ).forEach((childId) => {
        const child = nodesById.get(childId);

        if (!child) {
          return;
        }

        const childDims = getWorkflowNodeDimensions(child.type, ctx.config);
        const childExtent =
          getSpreadCoordinate(child.position, isVertical) +
          getSpreadSize(childDims, isVertical);

        maxExtent = Math.max(maxExtent, childExtent);
      });
    }

    return maxExtent;
  };
  const operatorIds = new Set(
    nodes.filter((n) => n.type === ENodeType.OPERATOR).map((n) => n.id),
  );
  const overrides = new Map<string, { x: number; y: number }>();

  operatorIds.forEach((operatorId) => {
    const operatorNode = nodesById.get(operatorId);

    if (!operatorNode) {
      return;
    }

    // Build a list of all branch slots in branch-index order.
    type BranchSlot = {
      branchIndex: number;
      node: GraphNode;
      isEmpty: boolean;
    };
    const slots: BranchSlot[] = (outgoingBySource.get(operatorId) ?? [])
      .map(({ targetId, sourceHandle }) => {
        const node = nodesById.get(targetId);

        if (!node) {
          return null;
        }

        return {
          branchIndex: parseConditionalBranchIndex(sourceHandle),
          node,
          isEmpty: node.type === ENodeType.BRANCH_PLACEHOLDER,
        };
      })
      .filter((s): s is BranchSlot => s !== null && s.branchIndex >= 0)
      .sort((a, b) => a.branchIndex - b.branchIndex);
    const emptySlots = slots.filter((s) => s.isEmpty);

    if (!emptySlots.length) {
      return;
    }

    const nonEmptySlots = slots.filter((s) => !s.isEmpty);
    // ── 1. Flow-direction alignment ──────────────────────────────────────────
    // Move each empty placeholder's flow-axis (x in horizontal) to match the
    // minimum flow-axis position of sibling non-empty branch first-nodes.
    // When all branches are empty, place placeholders one ELK inter-layer gap
    // after the operator — identical to ELK's natural position for a direct
    // operator → placeholder edge (same arrow length as the empty branch of a
    // mixed conditional).
    const flowTarget = nonEmptySlots.length
      ? Math.min(
          ...nonEmptySlots.map((s) =>
            getFlowCoordinate(s.node.position, isVertical),
          ),
        )
      : getFlowCoordinate(operatorNode.position, isVertical) +
        getFlowSize(
          getWorkflowNodeDimensions(operatorNode.type, ctx.config),
          isVertical,
        ) +
        FLOW_LAYER_GAP;

    emptySlots.forEach(({ node: placeholder }) => {
      const currentFlow = getFlowCoordinate(placeholder.position, isVertical);

      if (Math.abs(currentFlow - flowTarget) > 0.5) {
        overrides.set(placeholder.id, {
          ...withFlowCoordinate(placeholder.position, isVertical, flowTarget),
        });
      }
    });

    // ── 2. Branch-spread positioning ─────────────────────────────────────────
    const placeholderDims = getWorkflowNodeDimensions(
      ENodeType.BRANCH_PLACEHOLDER,
      ctx.config,
    );
    const phSize = getSpreadSize(placeholderDims, isVertical);

    // When all branches are empty there is no non-empty anchor to compute from.
    // Distribute the placeholders evenly along the spread axis, centered on the
    // operator's spread-axis midpoint. Use a task-sized slot pitch
    // (taskSize + ELK node-node spacing = 86 + 64 = 150 px) so the spacing
    // matches what ELK produces for branches that each hold one task node.
    // The placeholder is centered within each slot.
    if (!nonEmptySlots.length) {
      const taskDims = getWorkflowNodeDimensions(ENodeType.TASK, ctx.config);
      const slotSize = getSpreadSize(taskDims, isVertical);
      const pitch = slotSize + ELK_NODE_NODE_SPACING;
      const slotOffset = (slotSize - phSize) / 2;
      const operatorDims = getWorkflowNodeDimensions(
        operatorNode.type,
        ctx.config,
      );
      const operatorSpreadCenter = getAxisCenter(
        operatorNode.position,
        operatorDims,
        isVertical,
        "spread",
      );
      const totalSpan = (emptySlots.length - 1) * pitch;
      const firstSlotLeadingEdge =
        operatorSpreadCenter - totalSpan / 2 - slotSize / 2;

      emptySlots.forEach(({ node: placeholder }, idx) => {
        const targetLeadingEdge =
          firstSlotLeadingEdge + idx * pitch + slotOffset;
        const existing = overrides.get(placeholder.id) ?? placeholder.position;

        overrides.set(placeholder.id, {
          ...withSpreadCoordinate(existing, isVertical, targetLeadingEdge),
        });
      });

      return;
    }

    // nodeTrailingEdge: the spread-axis extent of a node including its
    // attachment descendants (e.g. AI-agent binding chips below the task).
    const nodeTrailingEdge = (node: GraphNode): number =>
      nodeSpreadExtent(node);
    // nodeLeadingEdge: the spread-axis edge that faces the previous branch.
    const nodeLeadingEdge = (node: GraphNode): number =>
      getSpreadCoordinate(node.position, isVertical);
    // nodeCenter: midpoint between leading and trailing edges (with attachments).
    const nodeCenter = (node: GraphNode): number =>
      (nodeLeadingEdge(node) + nodeTrailingEdge(node)) / 2;
    const nonEmptySortedByIndex = [...nonEmptySlots].sort(
      (a, b) => a.branchIndex - b.branchIndex,
    );
    // Derive a fallback per-slot pitch from ELK's layout when there is only
    // one non-empty branch (used for extrapolation at the edges).
    let fallbackPitch = 0;

    if (nonEmptySortedByIndex.length >= 2) {
      const first = nonEmptySortedByIndex[0];
      const last = nonEmptySortedByIndex[nonEmptySortedByIndex.length - 1];
      const centerDiff = nodeCenter(last.node) - nodeCenter(first.node);
      const indexDiff = last.branchIndex - first.branchIndex;

      fallbackPitch = indexDiff > 0 ? centerDiff / indexDiff : 0;
    }

    if (fallbackPitch <= 0) {
      // Single non-empty branch: derive pitch from ELK's maximum consecutive gap.
      const allReps = [...slots].sort((a, b) => {
        const aPos = getSpreadCoordinate(a.node.position, isVertical);
        const bPos = getSpreadCoordinate(b.node.position, isVertical);

        return aPos - bPos;
      });

      for (let i = 1; i < allReps.length; i++) {
        const prev = getSpreadCoordinate(
          allReps[i - 1].node.position,
          isVertical,
        );
        const curr = getSpreadCoordinate(allReps[i].node.position, isVertical);

        fallbackPitch = Math.max(fallbackPitch, curr - prev);
      }
    }

    if (fallbackPitch <= 0) {
      const taskDims = getWorkflowNodeDimensions(ENodeType.TASK, ctx.config);

      fallbackPitch = getSpreadSize(taskDims, isVertical) + 20;
    }

    // Group empty slots by their (above, below) anchor pair so that multiple
    // empties between the same two non-empty branches are distributed evenly.
    type AnchorKey = string;
    type EmptyGroup = {
      above: (typeof nonEmptySortedByIndex)[0] | undefined;
      below: (typeof nonEmptySortedByIndex)[0] | undefined;
      slots: Array<{ branchIndex: number; node: GraphNode }>;
    };
    const emptyGroups = new Map<AnchorKey, EmptyGroup>();

    emptySlots.forEach(({ branchIndex, node: placeholder }) => {
      const above = nonEmptySortedByIndex
        .filter((s) => s.branchIndex < branchIndex)
        .at(-1);
      const below = nonEmptySortedByIndex.find(
        (s) => s.branchIndex > branchIndex,
      );
      const key = `${above?.branchIndex ?? "none"}_${below?.branchIndex ?? "none"}`;

      if (!emptyGroups.has(key)) {
        emptyGroups.set(key, { above, below, slots: [] });
      }

      emptyGroups.get(key)!.slots.push({ branchIndex, node: placeholder });
    });

    emptyGroups.forEach(({ above, below, slots: groupSlots }) => {
      // Sort slots within each group by branch index for correct order.
      groupSlots.sort((a, b) => a.branchIndex - b.branchIndex);
      const count = groupSlots.length;

      groupSlots.forEach(({ branchIndex, node: placeholder }, slotIdx) => {
        let targetLeadingEdge: number;

        if (above && below) {
          // Distribute placeholders evenly in the gap between the above
          // node's trailing edge and the below node's leading edge.
          // Equal padding is placed before, between, and after placeholders.
          // If the gap is too small, placeholders are packed from the center.
          const gapStart = nodeTrailingEdge(above.node);
          const gapEnd = nodeLeadingEdge(below.node);
          const totalPlaceholderSize = count * phSize;
          const totalPadding = Math.max(
            0,
            gapEnd - gapStart - totalPlaceholderSize,
          );
          const padding = totalPadding / (count + 1);

          targetLeadingEdge = gapStart + padding + slotIdx * (phSize + padding);
        } else if (above) {
          // No branch below — extrapolate forward from above node's trailing edge.
          // Use fallbackPitch as the slot size (leading-edge to leading-edge).
          const stepsBelow = branchIndex - above.branchIndex;

          targetLeadingEdge =
            nodeTrailingEdge(above.node) +
            (fallbackPitch - phSize) / 2 +
            (stepsBelow - 1) * fallbackPitch;
        } else if (below) {
          // No branch above — extrapolate backward from below node's leading edge.
          const stepsAbove = below.branchIndex - branchIndex;

          targetLeadingEdge =
            nodeLeadingEdge(below.node) -
            (fallbackPitch - phSize) / 2 -
            stepsAbove * fallbackPitch;
        } else {
          return;
        }

        const existing = overrides.get(placeholder.id) ?? placeholder.position;

        overrides.set(placeholder.id, {
          ...withSpreadCoordinate(existing, isVertical, targetLeadingEdge),
        });
      });
    });
  });

  return nodes.map((node) => {
    const override = overrides.get(node.id);

    if (!override) {
      return node;
    }

    return { ...node, position: override };
  });
};
const alignNextNodesWithPlaceholders = (
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
  // Collect per-target offset contributions grouped by the *origin* group, so
  // a Conditional with N branches contributes N entries that all point to the
  // same operator center. We average them per target below.
  const offsetContributions = new Map<
    string,
    Array<{ x: number; y: number }>
  >();

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
      const offset = isVertical
        ? { x: referenceCenter - targetCenter, y: 0 }
        : { x: 0, y: referenceCenter - targetCenter };

      if (offset.x === 0 && offset.y === 0) {
        return;
      }

      appendMapValue(offsetContributions, target.id, offset);
    });
  const offsets = new Map<string, { x: number; y: number }>();

  offsetContributions.forEach((contributions, targetId) => {
    const count = contributions.length;
    const avgOffset = {
      x: contributions.reduce((sum, c) => sum + c.x, 0) / count,
      y: contributions.reduce((sum, c) => sum + c.y, 0) / count,
    };

    if (avgOffset.x === 0 && avgOffset.y === 0) {
      return;
    }

    const targetGroupId = nodeToInnermostGroup.get(targetId);
    const targetGroup = targetGroupId ? groups.get(targetGroupId) : undefined;
    const memberIds = targetGroup ? [...targetGroup.memberNodeIds] : [targetId];

    memberIds.forEach((id) => {
      const existing = offsets.get(id) ?? { x: 0, y: 0 };

      offsets.set(id, {
        x: existing.x + avgOffset.x,
        y: existing.y + avgOffset.y,
      });
    });
  });

  return nodes.map((node) => {
    const offset = offsets.get(node.id);

    if (!offset || (offset.x === 0 && offset.y === 0)) {
      return node;
    }

    return {
      ...node,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
    };
  });
};
const alignAllNodesToStartAxis = (
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
  const processedGroupIds = new Set<string>();
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
    if (indicatorIds.has(node.id)) {
      return;
    }

    // Skip GROUP overlay nodes — they duplicate the bounding-box center of
    // their member nodes which are already counted via nodeToOutermostGroup.
    if (node.type === ENodeType.GROUP) {
      return;
    }

    if (attachmentParentByChild.has(node.id)) {
      return;
    }

    const groupId = nodeToOutermostGroup.get(node.id);

    if (groupId) {
      if (processedGroupIds.has(groupId)) {
        return;
      }

      processedGroupIds.add(groupId);
      const referenceCenter = getGroupReferenceCenter(groupId);

      if (referenceCenter !== undefined) {
        referenceCenters.push(referenceCenter);
      }

      return;
    }

    const dims = getWorkflowNodeDimensions(node.type, ctx.config);

    referenceCenters.push(
      getAxisCenter(node.position, dims, isVertical, "spread"),
    );
  });

  // Fall back to Start's own center when there are no content nodes.
  const startDims = getWorkflowNodeDimensions(startNode.type, ctx.config);
  const targetAxis =
    referenceCenters.length > 0
      ? average(referenceCenters)
      : getAxisCenter(startNode.position, startDims, isVertical, "spread");
  const deltas = new Map<string, number>();
  const processedGroups = new Set<string>();

  nodes.forEach((node) => {
    if (attachmentParentByChild.has(node.id)) {
      return;
    }

    // GROUP overlay nodes move with the same delta as their members; skip
    // them here — they're handled below via the groupId path on member nodes.
    if (node.type === ENodeType.GROUP) {
      return;
    }

    const groupId = nodeToOutermostGroup.get(node.id);

    if (groupId) {
      if (processedGroups.has(groupId)) {
        return;
      }

      processedGroups.add(groupId);
      const memberIds = collectGroupMemberIds(groupId);
      const referenceCenter = getGroupReferenceCenter(groupId, memberIds);

      if (referenceCenter === undefined) {
        return;
      }

      const delta = targetAxis - referenceCenter;

      if (delta === 0) {
        return;
      }

      memberIds.forEach((id) => {
        deltas.set(id, delta);
      });
      // Also shift the GROUP overlay node itself (same delta as its members).
      deltas.set(groupId, delta);

      return;
    }

    const dims = getWorkflowNodeDimensions(node.type, ctx.config);
    const nodeCenter = getAxisCenter(node.position, dims, isVertical, "spread");
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

  return nodes.map((node) => {
    const delta = deltas.get(node.id);

    if (delta === undefined || delta === 0) {
      return node;
    }

    return {
      ...node,
      position: translateSpread(node.position, isVertical, delta),
    };
  });
};
const getGroupNodes = (
  nodes: GraphNode[],
  groups: Map<string, GroupMeta>,
  config: INodeConfig,
  attachmentEdges: Edge[],
) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const { childrenByParent: attachmentChildrenByParent } = buildAttachmentMaps(
    attachmentEdges,
    nodesById,
  );
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
      ...groupMemberIds.flatMap((memberId) =>
        collectAttachmentDescendants(
          memberId,
          attachmentChildrenByParent,
          nodesById,
        ),
      ),
    ];
    const boundsMembers = boundsMemberIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is GraphNode => Boolean(node));
    const color = config.highlights?.[group.operatorType]?.color;
    const basePadding = config.highlights?.[group.operatorType]?.padding || 0;
    const padding = getGroupPadding(basePadding, group.level);
    const backgroundAlpha = getGroupBackgroundAlpha(group.level);
    const bounds = getNodesBounds(boundsMembers);
    const groupX = bounds.x - padding / 2;
    const groupY = bounds.y - padding / 2;
    const groupWidth = bounds.width + padding;
    const groupHeight = bounds.height + padding;

    groupNodes.push({
      ...DEFAULT_NODE_PROPS,
      id: group.id,
      type: ENodeType.GROUP,
      position: { x: groupX, y: groupY },
      data: config.nodes[ENodeType.GROUP],
      zIndex: -1,
      style: {
        width: groupWidth,
        height: groupHeight,
        borderRadius: "1rem",
        backgroundColor: color ? withAlpha(color, backgroundAlpha) : undefined,
        border: `2px solid color-mix(in srgb, ${withAlpha(color || "", backgroundAlpha)} 85%, currentColor)`,
      },
    });
  });

  return groupNodes;
};
const withFreshGroupNodes = (
  nodes: GraphNode[],
  groups: Map<string, GroupMeta>,
  config: INodeConfig,
  attachmentEdges: Edge[],
): GraphNode[] => {
  const contentNodes = nodes.filter((node) => node.type !== ENodeType.GROUP);
  const groupNodes = getGroupNodes(
    contentNodes,
    groups,
    config,
    attachmentEdges,
  );

  return [...groupNodes, ...contentNodes];
};
const symmetrizeBranchSiblings = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
): GraphNode[] => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const { outgoingBySource, attachmentChildrenByParent } =
    buildMainFlowMaps(edges);
  const getNodeSpreadBounds = (nodeId: string): AxisBounds | undefined =>
    getPositionedNodeAxisBounds(
      nodeId,
      positions,
      nodesById,
      ctx,
      isVertical,
      "spread",
    );
  const moveNode = (nodeId: string, delta: number) => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    const position = positions.get(nodeId) ?? node.position;

    positions.set(nodeId, translateSpread(position, isVertical, delta));
  };
  const sortedGroups = [...groups.values()].sort((a, b) => b.level - a.level);

  sortedGroups.forEach((group) => {
    const operatorNode = getGroupOperatorNode(group, nodesById);

    if (!operatorNode) {
      return;
    }

    // A Conditional's branches each have their own indexed "operatorOut-N-M"
    // handle, which gives a reliable spread order. A Parallel's branches all
    // share a single "operatorOut" handle, so there's no index to parse —
    // fall back to the order the branch edges were emitted in (which matches
    // the step array order), so Parallel branches still get spread apart
    // with the same gap as Conditional branches instead of relying solely on
    // ELK's default spacing.
    const branchTargets = (outgoingBySource.get(operatorNode.id) ?? [])
      .filter(({ targetId }) => group.memberNodeIds.has(targetId))
      .map(({ targetId, sourceHandle }, index) => {
        const parsedBranchIndex = parseConditionalBranchIndex(sourceHandle);

        return {
          targetId,
          branchIndex: parsedBranchIndex >= 0 ? parsedBranchIndex : index,
        };
      })
      .sort((a, b) => a.branchIndex - b.branchIndex);

    if (branchTargets.length < 2) {
      return;
    }

    const rawBranches = branchTargets.map(({ branchIndex, targetId }) => ({
      branchIndex,
      ...collectBranchNodeIds({
        startId: targetId,
        group,
        groups,
        nodesById,
        outgoingBySource,
        attachmentChildrenByParent,
      }),
    }));
    // A Parallel's branches all reconverge on one shared join node inside
    // the group (unlike a Conditional's branches, which each keep their own
    // separate trailing placeholder). That shared node sits centrally among
    // every branch, so folding it into any one branch's bounds would blow up
    // that branch's apparent size to span all the way to the shared point —
    // exclude it from both the bounds calculation and the move (it can't be
    // assigned to any single branch's lane; ELK already placed it to clear
    // every branch).
    const mainFlowBranchCountByNodeId = countNodeIds(
      rawBranches.map((branch) => branch.mainFlowNodeIds),
    );
    const branches = rawBranches
      .map(({ branchIndex, allNodeIds }) => {
        const ownNodeIds = [...allNodeIds].filter(
          (nodeId) => (mainFlowBranchCountByNodeId.get(nodeId) ?? 0) <= 1,
        );
        const bounds = ownNodeIds.map(getNodeSpreadBounds).filter(
          (
            bounds,
          ): bounds is {
            leading: number;
            trailing: number;
          } => Boolean(bounds),
        );

        if (!bounds.length) {
          return;
        }

        return {
          branchIndex,
          nodeIds: allNodeIds,
          leading: Math.min(...bounds.map((bounds) => bounds.leading)),
          trailing: Math.max(...bounds.map((bounds) => bounds.trailing)),
        };
      })
      .filter(
        (
          branch,
        ): branch is {
          branchIndex: number;
          nodeIds: Set<string>;
          leading: number;
          trailing: number;
        } => Boolean(branch),
      )
      .sort((a, b) => a.branchIndex - b.branchIndex);

    if (branches.length < 2) {
      return;
    }

    const operatorPosition =
      positions.get(operatorNode.id) ?? operatorNode.position;
    const operatorDimensions = getWorkflowNodeDimensions(
      operatorNode.type,
      ctx.config,
    );
    const operatorCenter = getAxisCenter(
      operatorPosition,
      operatorDimensions,
      isVertical,
      "spread",
    );
    const totalSize =
      branches.reduce(
        (sum, branch) => sum + branch.trailing - branch.leading,
        0,
      ) +
      BRANCH_SPREAD_GAP * (branches.length - 1);
    let cursor = operatorCenter - totalSize / 2;

    branches.forEach((branch) => {
      const delta = cursor - branch.leading;

      if (Math.abs(delta) >= 1) {
        branch.nodeIds.forEach((nodeId) => {
          if ((mainFlowBranchCountByNodeId.get(nodeId) ?? 0) <= 1) {
            moveNode(nodeId, delta);
          }
        });
      }

      cursor += branch.trailing - branch.leading + BRANCH_SPREAD_GAP;
    });

    // A shared convergence node (e.g. a Parallel's join placeholder) never
    // gets assigned to any one branch's lane above, so it's left wherever it
    // started. Center it on the operator instead — that's also where the
    // group's own in/out ports are drawn — now that every branch has
    // reached its final spread position.
    mainFlowBranchCountByNodeId.forEach((count, nodeId) => {
      if (count <= 1) {
        return;
      }

      const bounds = getNodeSpreadBounds(nodeId);

      if (!bounds) {
        return;
      }

      const delta = operatorCenter - (bounds.leading + bounds.trailing) / 2;

      if (Math.abs(delta) >= 1) {
        moveNode(nodeId, delta);
      }
    });
  });

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
};
/**
 * ELK's layered algorithm ranks nodes by global edge-length optimization, not
 * by branch symmetry — so two sibling branches of the same operator (e.g. a
 * Parallel's "wait all" branches, or a Conditional's branches) can land in
 * different columns when one branch is structurally more complex (e.g. a
 * nested Conditional needing extra layers vs. a plain task). This shifts
 * every branch's flow-axis origin (x in horizontal mode, y in vertical mode)
 * to match the branch that starts furthest along the flow axis, moving each
 * branch's full subtree (including nested groups and attachment descendants)
 * as a unit so internal edges stay consistent.
 */
const alignBranchFlowOrigins = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
): GraphNode[] => {
  const isVertical = !isHorizontalDirection(ctx);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const { outgoingBySource, attachmentChildrenByParent } =
    buildMainFlowMaps(edges);
  const getNodeFlowLeading = (nodeId: string): number | undefined => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    const position = positions.get(nodeId) ?? node.position;

    return getFlowCoordinate(position, isVertical);
  };
  const moveNode = (nodeId: string, delta: number) => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    const position = positions.get(nodeId) ?? node.position;

    positions.set(nodeId, translateFlow(position, isVertical, delta));
  };
  const sortedGroups = [...groups.values()].sort((a, b) => b.level - a.level);

  sortedGroups.forEach((group) => {
    const operatorNode = getGroupOperatorNode(group, nodesById);

    if (!operatorNode) {
      return;
    }

    // A Conditional's branches each have their own indexed "operatorOut-N-M"
    // handle; a Parallel's branches all share a single "operatorOut" handle
    // but still fan out to distinct targets. Either way, every distinct
    // outgoing target within this group is a branch to reconcile.
    const branchTargets = [
      ...new Set(
        (outgoingBySource.get(operatorNode.id) ?? [])
          .map(({ targetId }) => targetId)
          .filter((targetId) => group.memberNodeIds.has(targetId)),
      ),
    ];

    if (branchTargets.length < 2) {
      return;
    }

    const branches = branchTargets
      .map((targetId) => {
        const { mainFlowNodeIds, allNodeIds } = collectBranchNodeIds({
          startId: targetId,
          group,
          groups,
          nodesById,
          outgoingBySource,
          attachmentChildrenByParent,
        });
        const leadings = [...mainFlowNodeIds]
          .map(getNodeFlowLeading)
          .filter((value): value is number => value !== undefined);

        if (!leadings.length) {
          return;
        }

        return { nodeIds: allNodeIds, leading: Math.min(...leadings) };
      })
      .filter((branch): branch is { nodeIds: Set<string>; leading: number } =>
        Boolean(branch),
      );

    if (branches.length < 2) {
      return;
    }

    const targetLeading = Math.max(...branches.map((branch) => branch.leading));
    // Branches of the same operator (e.g. every Parallel branch) commonly
    // reconverge on a shared merge/join node. ELK already placed that shared
    // node to clear the widest original branch, which is by definition at
    // least as far along as `targetLeading` — so it never needs to move, and
    // must not: nodes outside this group (e.g. the step after the whole
    // Parallel) were already positioned relative to its original spot.
    // Count which branches can reach each node so those shared convergence
    // nodes can be excluded, then resolve one delta per remaining node — the
    // largest any (single) branch requires — before moving anything.
    const branchCountByNodeId = countNodeIds(
      branches.map((branch) => branch.nodeIds),
    );
    const deltaByNodeId = new Map<string, number>();

    branches.forEach((branch) => {
      const delta = targetLeading - branch.leading;

      if (Math.abs(delta) < 1) {
        return;
      }

      branch.nodeIds.forEach((nodeId) => {
        if ((branchCountByNodeId.get(nodeId) ?? 0) > 1) {
          return;
        }

        const existing = deltaByNodeId.get(nodeId);

        deltaByNodeId.set(
          nodeId,
          existing === undefined ? delta : Math.max(existing, delta),
        );
      });
    });

    deltaByNodeId.forEach((delta, nodeId) => moveNode(nodeId, delta));

    // A shared convergence node (e.g. a Parallel's join placeholder) is
    // deliberately left where ELK put it, on the assumption ELK already
    // placed it to clear every branch. That assumption can be wrong: ELK may
    // not rank real nested content (e.g. a task buried inside one branch's
    // own Conditional) as the deepest node, and the shared node must clear
    // not just individual branch nodes but the group's full padded bounding
    // box (the visual box drawn around the group) — otherwise it renders
    // inside the group instead of after it. It should also sit centered on
    // the group's perpendicular axis, matching where the group's own
    // in/out ports are drawn. Everything reachable *after* the shared node
    // (outside this group entirely — e.g. the step following the whole
    // Parallel) must shift by the same flow-axis amount, or it would end up
    // positioned before the node that now feeds it.
    const getNodeBounds = (nodeId: string): AxisBounds | undefined =>
      getPositionedNodeAxisBounds(
        nodeId,
        positions,
        nodesById,
        ctx,
        isVertical,
        "flow",
      );
    const collectForwardNodeIds = (startId: string): Set<string> => {
      const forwardNodeIds = new Set<string>();
      const queue = [startId];

      while (queue.length) {
        const current = queue.shift()!;

        if (forwardNodeIds.has(current)) {
          continue;
        }

        forwardNodeIds.add(current);

        collectAttachmentDescendants(
          current,
          attachmentChildrenByParent,
          nodesById,
        ).forEach((attachmentId) => forwardNodeIds.add(attachmentId));

        (outgoingBySource.get(current) ?? []).forEach(({ targetId }) => {
          if (!forwardNodeIds.has(targetId)) {
            queue.push(targetId);
          }
        });
      }

      return forwardNodeIds;
    };
    const sharedNodeIds = [...branchCountByNodeId.entries()]
      .filter(([, count]) => count > 1)
      .map(([nodeId]) => nodeId);

    if (sharedNodeIds.length) {
      // Measure only the group's *other* real content — not the shared
      // node(s) themselves, which are what we're positioning here. Since a
      // shared node (e.g. the join placeholder) is itself a member of this
      // group, including it in its own target bounds would be circular:
      // the group's rendered box always grows to enclose whichever position
      // we pick for it, so it can never "clear its own box" — what it must
      // clear is every other real member.
      const groupBounds = branches
        .flatMap((branch) => [...branch.nodeIds])
        .filter((nodeId) => (branchCountByNodeId.get(nodeId) ?? 0) <= 1)
        .map(getNodeBounds)
        .filter((bounds): bounds is NonNullable<typeof bounds> =>
          Boolean(bounds),
        );

      if (groupBounds.length) {
        const groupTrailing =
          Math.max(...groupBounds.map((bounds) => bounds.trailing)) +
          FLOW_LAYER_GAP;

        sharedNodeIds.forEach((nodeId) => {
          const bounds = getNodeBounds(nodeId);

          if (!bounds) {
            return;
          }

          const delta = groupTrailing - bounds.leading;

          if (delta >= 1) {
            collectForwardNodeIds(nodeId).forEach((forwardId) =>
              moveNode(forwardId, delta),
            );
          }
        });
      }
    }
  });

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
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
  const attachmentEdges = projected.edges.filter(isAttachmentEdge);
  const elkNodes = await layoutNodesWithElk(projected.nodes, projected.edges, {
    config,
  });
  const alignedNodes = alignNextNodesWithPlaceholders(
    elkNodes,
    projected.edges,
    traversal.groups,
    { config },
  );
  const positionedNodes = addExtraNodes(alignedNodes, attachmentEdges, {
    config,
  });
  const emptyBranchAlignedNodes = alignEmptyBranchPlaceholders(
    positionedNodes,
    projected.edges,
    { config },
  );
  const flowAlignedNodes = alignBranchFlowOrigins(
    emptyBranchAlignedNodes,
    projected.edges,
    traversal.groups,
    { config },
  );
  const groupNodes = getGroupNodes(
    flowAlignedNodes,
    traversal.groups,
    config,
    attachmentEdges,
  );
  const allNodesBeforeSymmetry = [...groupNodes, ...flowAlignedNodes];
  const firstSymmetricNodes = withFreshGroupNodes(
    symmetrizeBranchSiblings(
      allNodesBeforeSymmetry,
      projected.edges,
      traversal.groups,
      { config },
    ),
    traversal.groups,
    config,
    attachmentEdges,
  );
  const symmetricNodes = withFreshGroupNodes(
    symmetrizeBranchSiblings(
      firstSymmetricNodes,
      projected.edges,
      traversal.groups,
      { config },
    ),
    traversal.groups,
    config,
    attachmentEdges,
  );
  // Run axis alignment last — after getGroupNodes — so that alignAllNodesToStartAxis
  // computes targetAxis from the final group bounding boxes (which include
  // padding and attachment-shifted positions).  This ensures groups, top-level
  // nodes, and Start/Stop all land on the same perpendicular-axis line.
  const finalNodes = alignAllNodesToStartAxis(
    symmetricNodes,
    projected.edges,
    traversal.groups,
    { config },
  );

  return {
    edges: projected.edges,
    nodes: finalNodes,
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

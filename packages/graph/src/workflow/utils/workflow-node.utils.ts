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
  // Build outgoing-edge map with source handles: sourceId → [{targetId, sourceHandle}]
  const outgoingBySource = new Map<
    string,
    Array<{ targetId: string; sourceHandle?: string }>
  >();
  // Build attachment-children map: nodeId → [attachmentNodeIds]
  const attachmentChildrenByParent = new Map<string, string[]>();

  edges.forEach(({ source, target, sourceHandle }) => {
    outgoingBySource.set(source, [
      ...(outgoingBySource.get(source) ?? []),
      { targetId: target, sourceHandle: sourceHandle ?? undefined },
    ]);

    if (isAttachmentSourceHandle(sourceHandle)) {
      attachmentChildrenByParent.set(source, [
        ...(attachmentChildrenByParent.get(source) ?? []),
        target,
      ]);
    }
  });

  // Compute the full spread-axis extent of a node including all its attachment
  // descendants.  In horizontal mode attachments extend below the task (y+h),
  // in vertical mode they extend to the left so they do NOT increase x+w.
  const nodeSpreadExtent = (node: GraphNode): number => {
    const dims = getWorkflowNodeDimensions(node.type, ctx.config);
    let maxExtent =
      (isVertical ? node.position.x : node.position.y) +
      (isVertical ? dims.width : dims.height);

    if (!isVertical) {
      // Horizontal mode: attachments are placed below the task.
      // Walk the attachment tree to find the furthest bottom edge.
      const stack = [node.id];

      while (stack.length) {
        const current = stack.pop()!;
        const children = attachmentChildrenByParent.get(current) ?? [];

        children.forEach((childId) => {
          const child = nodesById.get(childId);

          if (!child) {
            return;
          }

          const childDims = getWorkflowNodeDimensions(child.type, ctx.config);
          const childExtent = child.position.y + childDims.height;

          if (childExtent > maxExtent) {
            maxExtent = childExtent;
          }

          stack.push(childId);
        });
      }
    }

    return maxExtent;
  };
  // Extract branchIndex from an operatorOut source handle: "operatorOut-{idx}-{total}"
  const parseBranchIndex = (handle?: string): number => {
    if (!handle) {
      return -1;
    }

    const match = handle.match(/operatorOut-(\d+)-\d+/);

    return match ? parseInt(match[1], 10) : -1;
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
          branchIndex: parseBranchIndex(sourceHandle),
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
    const ELK_BETWEEN_LAYERS = 186;
    const flowTarget = nonEmptySlots.length
      ? Math.min(
          ...nonEmptySlots.map((s) =>
            isVertical ? s.node.position.y : s.node.position.x,
          ),
        )
      : (isVertical ? operatorNode.position.y : operatorNode.position.x) +
        (isVertical
          ? getWorkflowNodeDimensions(operatorNode.type, ctx.config).height
          : getWorkflowNodeDimensions(operatorNode.type, ctx.config).width) +
        ELK_BETWEEN_LAYERS;

    emptySlots.forEach(({ node: placeholder }) => {
      const currentFlow = isVertical
        ? placeholder.position.y
        : placeholder.position.x;

      if (Math.abs(currentFlow - flowTarget) > 0.5) {
        overrides.set(placeholder.id, {
          x: isVertical ? placeholder.position.x : flowTarget,
          y: isVertical ? flowTarget : placeholder.position.y,
        });
      }
    });

    // ── 2. Branch-spread positioning ─────────────────────────────────────────
    const placeholderDims = getWorkflowNodeDimensions(
      ENodeType.BRANCH_PLACEHOLDER,
      ctx.config,
    );
    const phSize = isVertical ? placeholderDims.width : placeholderDims.height;

    // When all branches are empty there is no non-empty anchor to compute from.
    // Distribute the placeholders evenly along the spread axis, centered on the
    // operator's spread-axis midpoint. Use a task-sized slot pitch
    // (taskSize + ELK node-node spacing = 86 + 64 = 150 px) so the spacing
    // matches what ELK produces for branches that each hold one task node.
    // The placeholder is centered within each slot.
    if (!nonEmptySlots.length) {
      const ELK_NODE_NODE_SPACING = 64;
      const taskDims = getWorkflowNodeDimensions(ENodeType.TASK, ctx.config);
      const slotSize = isVertical ? taskDims.width : taskDims.height;
      const pitch = slotSize + ELK_NODE_NODE_SPACING;
      const slotOffset = (slotSize - phSize) / 2;
      const operatorDims = getWorkflowNodeDimensions(
        operatorNode.type,
        ctx.config,
      );
      const operatorSpreadCenter =
        (isVertical ? operatorNode.position.x : operatorNode.position.y) +
        (isVertical ? operatorDims.width : operatorDims.height) / 2;
      const totalSpan = (emptySlots.length - 1) * pitch;
      const firstSlotLeadingEdge =
        operatorSpreadCenter - totalSpan / 2 - slotSize / 2;

      emptySlots.forEach(({ node: placeholder }, idx) => {
        const targetLeadingEdge =
          firstSlotLeadingEdge + idx * pitch + slotOffset;
        const existing = overrides.get(placeholder.id) ?? placeholder.position;

        overrides.set(placeholder.id, {
          x: isVertical ? targetLeadingEdge : existing.x,
          y: isVertical ? existing.y : targetLeadingEdge,
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
      isVertical ? node.position.x : node.position.y;
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
        const aPos = isVertical ? a.node.position.x : a.node.position.y;
        const bPos = isVertical ? b.node.position.x : b.node.position.y;

        return aPos - bPos;
      });

      for (let i = 1; i < allReps.length; i++) {
        const prev = isVertical
          ? allReps[i - 1].node.position.x
          : allReps[i - 1].node.position.y;
        const curr = isVertical
          ? allReps[i].node.position.x
          : allReps[i].node.position.y;

        fallbackPitch = Math.max(fallbackPitch, curr - prev);
      }
    }

    if (fallbackPitch <= 0) {
      const taskDims = getWorkflowNodeDimensions(ENodeType.TASK, ctx.config);

      fallbackPitch = (isVertical ? taskDims.width : taskDims.height) + 20;
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
          x: isVertical ? targetLeadingEdge : existing.x,
          y: isVertical ? existing.y : targetLeadingEdge,
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
  const nodeToInnermostGroup = new Map<string, string>();

  groups.forEach((group, groupId) => {
    const currentLevel = group.level;

    group.memberNodeIds.forEach((nodeId) => {
      const existingGroupId = nodeToInnermostGroup.get(nodeId);

      if (!existingGroupId) {
        nodeToInnermostGroup.set(nodeId, groupId);

        return;
      }

      const existingLevel = groups.get(existingGroupId)?.level ?? 0;

      if (currentLevel > existingLevel) {
        nodeToInnermostGroup.set(nodeId, groupId);
      }
    });
  });
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
      isVertical ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2,
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
      const outgoingEdge = edges.find((edge) => edge.source === placeholder.id);

      if (!outgoingEdge) {
        return;
      }

      const target = nodesById.get(outgoingEdge.target);

      if (!target) {
        return;
      }

      const originGroupId = nodeToInnermostGroup.get(placeholder.id);
      const groupBBoxCenter = originGroupId
        ? groupBBoxCenterByGroupId.get(originGroupId)
        : undefined;
      const targetDims = getWorkflowNodeDimensions(target.type, ctx.config);
      // Use the group's bounding-box center as the reference so the next step
      // aligns with the group's visual midpoint (where xyflow routes the exit
      // overlay edge).  Fall back to the placeholder's own center when there
      // is no group.
      const referenceCenter =
        groupBBoxCenter ??
        (isVertical
          ? placeholder.position.x +
            getWorkflowNodeDimensions(placeholder.type, ctx.config).width / 2
          : placeholder.position.y +
            getWorkflowNodeDimensions(placeholder.type, ctx.config).height / 2);
      const targetCenter = isVertical
        ? target.position.x + targetDims.width / 2
        : target.position.y + targetDims.height / 2;
      const offset = isVertical
        ? { x: referenceCenter - targetCenter, y: 0 }
        : { x: 0, y: referenceCenter - targetCenter };

      if (offset.x === 0 && offset.y === 0) {
        return;
      }

      const contributions = offsetContributions.get(target.id) ?? [];

      contributions.push(offset);
      offsetContributions.set(target.id, contributions);
    });
  const offsets = new Map<string, { x: number; y: number }>();

  offsetContributions.forEach((contributions, targetId) => {
    const count = contributions.length;
    const sumX = contributions.reduce((sum, c) => sum + c.x, 0);
    const sumY = contributions.reduce((sum, c) => sum + c.y, 0);
    const avgOffset = { x: sumX / count, y: sumY / count };

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
  // Build parent/children maps for attachment edges so we can shift the
  // entire attachment stack (parent + descendants) as a single unit. Without
  // this, children would shift independently and break the relative
  // positioning established by `addExtraNodes`.
  const attachmentChildrenByParent = new Map<string, string[]>();
  const attachmentParentByChild = new Map<string, string>();

  edges.forEach((edge) => {
    if (!isAttachmentEdge(edge)) {
      return;
    }

    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      return;
    }

    const children = attachmentChildrenByParent.get(edge.source) ?? [];

    children.push(edge.target);
    attachmentChildrenByParent.set(edge.source, children);
    attachmentParentByChild.set(edge.target, edge.source);
  });
  // Map every node to its outermost group so this final axis alignment shifts
  // top-level groups as a single unit. Nested branch symmetry is already
  // resolved before this pass and must not be overwritten group-by-group here.
  const nodeToOutermostGroup = new Map<string, string>();

  groups.forEach((group, groupId) => {
    const currentLevel = group.level;

    group.memberNodeIds.forEach((nodeId) => {
      const existingGroupId = nodeToOutermostGroup.get(nodeId);

      if (!existingGroupId) {
        nodeToOutermostGroup.set(nodeId, groupId);

        return;
      }

      const existingLevel = groups.get(existingGroupId)?.level ?? 0;

      if (currentLevel < existingLevel) {
        nodeToOutermostGroup.set(nodeId, groupId);
      }
    });
  });
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

      // Use the GROUP overlay node (if present) for the definitive bounding
      // box since it has the final position+size including padding.
      const groupOverlay = nodesById.get(groupId);

      if (groupOverlay) {
        const gStyle = groupOverlay.style as
          | { width?: number; height?: number }
          | undefined;

        referenceCenters.push(
          isVertical
            ? groupOverlay.position.x + (gStyle?.width ?? 0) / 2
            : groupOverlay.position.y + (gStyle?.height ?? 0) / 2,
        );

        return;
      }

      // Fallback when GROUP overlay node is not in the list yet.
      const group = groups.get(groupId);

      if (!group) {
        return;
      }

      // Include attachment descendants so the bounding box matches
      // what getGroupNodes computes for the group rectangle.
      const allMemberIds = new Set<string>();

      group.memberNodeIds.forEach((memberId) => {
        if (!nodesById.has(memberId)) {
          return;
        }

        allMemberIds.add(memberId);
        const stack = [memberId];

        while (stack.length) {
          const current = stack.pop()!;
          const children = attachmentChildrenByParent.get(current) ?? [];

          children.forEach((childId) => {
            if (nodesById.has(childId) && !allMemberIds.has(childId)) {
              allMemberIds.add(childId);
              stack.push(childId);
            }
          });
        }
      });

      const memberNodes = [...allMemberIds]
        .map((id) => nodesById.get(id))
        .filter((n): n is GraphNode => Boolean(n));

      if (!memberNodes.length) {
        return;
      }

      const bounds = getNodesBounds(memberNodes);

      referenceCenters.push(
        isVertical ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2,
      );

      return;
    }

    const dims = getWorkflowNodeDimensions(node.type, ctx.config);

    referenceCenters.push(
      isVertical
        ? node.position.x + dims.width / 2
        : node.position.y + dims.height / 2,
    );
  });

  // Fall back to Start's own center when there are no content nodes.
  const startDims = getWorkflowNodeDimensions(startNode.type, ctx.config);
  const targetAxis =
    referenceCenters.length > 0
      ? referenceCenters.reduce((a, b) => a + b, 0) / referenceCenters.length
      : isVertical
        ? startNode.position.x + startDims.width / 2
        : startNode.position.y + startDims.height / 2;
  const deltas = new Map<string, number>();
  const processedGroups = new Set<string>();
  const collectGroupMemberIds = (groupId: string): Set<string> => {
    const memberIds = new Set<string>();
    const group = groups.get(groupId);

    if (!group) {
      return memberIds;
    }

    group.memberNodeIds.forEach((memberId) => {
      if (!nodesById.has(memberId)) {
        return;
      }

      memberIds.add(memberId);
      const stack = [memberId];

      while (stack.length) {
        const current = stack.pop()!;
        const children = attachmentChildrenByParent.get(current) ?? [];

        children.forEach((childId) => {
          if (nodesById.has(childId) && !memberIds.has(childId)) {
            memberIds.add(childId);
            stack.push(childId);
          }
        });
      }
    });

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
      // Use the GROUP overlay node's actual position+size as the reference
      // when it's present in the node list (it has the final bounding box
      // including padding).  Fall back to member bounding-box otherwise.
      const groupOverlayNode = nodesById.get(groupId);
      let referenceCenter: number;

      if (groupOverlayNode) {
        const gStyle = groupOverlayNode.style as
          | { width?: number; height?: number }
          | undefined;

        referenceCenter = isVertical
          ? groupOverlayNode.position.x + (gStyle?.width ?? 0) / 2
          : groupOverlayNode.position.y + (gStyle?.height ?? 0) / 2;
      } else {
        const memberNodes = [...memberIds]
          .map((id) => nodesById.get(id))
          .filter((member): member is GraphNode => Boolean(member));
        const bounds = getNodesBounds(memberNodes);

        referenceCenter = isVertical
          ? bounds.x + bounds.width / 2
          : bounds.y + bounds.height / 2;
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
    const nodeCenter = isVertical
      ? node.position.x + dims.width / 2
      : node.position.y + dims.height / 2;
    const delta = targetAxis - nodeCenter;

    if (delta === 0) {
      return;
    }

    deltas.set(node.id, delta);
    const stack = [node.id];

    while (stack.length) {
      const current = stack.pop()!;
      const children = attachmentChildrenByParent.get(current) ?? [];

      children.forEach((childId) => {
        deltas.set(childId, delta);
        stack.push(childId);
      });
    }
  });

  return nodes.map((node) => {
    const delta = deltas.get(node.id);

    if (delta === undefined || delta === 0) {
      return node;
    }

    return {
      ...node,
      position: isVertical
        ? { x: node.position.x + delta, y: node.position.y }
        : { x: node.position.x, y: node.position.y + delta },
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
      style: {
        width: groupWidth,
        height: groupHeight,
        zIndex: -1,
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
  const outgoingBySource = new Map<
    string,
    Array<{ targetId: string; sourceHandle?: string | null }>
  >();
  const attachmentChildrenByParent = new Map<string, string[]>();

  edges.forEach(({ source, target, sourceHandle }) => {
    if (isAttachmentEdge({ sourceHandle } as Edge)) {
      attachmentChildrenByParent.set(source, [
        ...(attachmentChildrenByParent.get(source) ?? []),
        target,
      ]);

      return;
    }

    outgoingBySource.set(source, [
      ...(outgoingBySource.get(source) ?? []),
      { targetId: target, sourceHandle },
    ]);
  });

  const collectAttachmentDescendants = (rootId: string): string[] => {
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
  const getNodeSpreadBounds = (
    nodeId: string,
  ): { leading: number; trailing: number } | undefined => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    const position = positions.get(nodeId) ?? node.position;
    const style = node.style as { width?: number; height?: number } | undefined;
    const dimensions =
      node.type === ENodeType.GROUP
        ? {
            width: style?.width ?? 0,
            height: style?.height ?? 0,
          }
        : getWorkflowNodeDimensions(node.type, ctx.config);
    const leading = isVertical ? position.x : position.y;
    const size = isVertical ? dimensions.width : dimensions.height;

    return { leading, trailing: leading + size };
  };
  const moveNode = (nodeId: string, delta: number) => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    const position = positions.get(nodeId) ?? node.position;

    positions.set(
      nodeId,
      isVertical
        ? { x: position.x + delta, y: position.y }
        : { x: position.x, y: position.y + delta },
    );
  };
  // Returns every node in the branch, including attachment descendants (e.g.
  // a task's binding chips) — those extend the branch's real visual
  // footprint and must count toward its spread bounds so the next branch
  // gets enough clearance. Also returns just the main-flow subset, which
  // `sortedGroups.forEach` below uses to detect nodes shared across more
  // than one branch (a Parallel's branches all reconverge on one shared
  // join node) so those can be excluded from bounds/movement — a shared
  // node sits centrally among every branch, so folding it into any one
  // branch's bounds would blow that branch's apparent size out to span all
  // the way to the shared point.
  const collectBranchNodeIds = (
    startId: string,
    group: GroupMeta,
  ): { mainFlowNodeIds: Set<string>; allNodeIds: Set<string> } => {
    const mainFlowNodeIds = new Set<string>();
    const queue = [startId];

    while (queue.length) {
      const current = queue.shift()!;

      if (mainFlowNodeIds.has(current) || !group.memberNodeIds.has(current)) {
        continue;
      }

      mainFlowNodeIds.add(current);

      (outgoingBySource.get(current) ?? []).forEach(({ targetId }) => {
        if (
          !mainFlowNodeIds.has(targetId) &&
          group.memberNodeIds.has(targetId)
        ) {
          queue.push(targetId);
        }
      });
    }

    const allNodeIds = new Set(mainFlowNodeIds);

    [...mainFlowNodeIds].forEach((nodeId) => {
      collectAttachmentDescendants(nodeId).forEach((attachmentId) => {
        allNodeIds.add(attachmentId);
      });
    });

    groups.forEach((candidateGroup, candidateGroupId) => {
      if (
        candidateGroupId === group.id ||
        candidateGroup.level <= group.level
      ) {
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
  const sortedGroups = [...groups.values()].sort((a, b) => b.level - a.level);

  sortedGroups.forEach((group) => {
    const operatorNode = [...group.memberNodeIds]
      .map((id) => nodesById.get(id))
      .filter((node): node is GraphNode => Boolean(node))
      .find(
        (node) =>
          node.type === ENodeType.OPERATOR &&
          (node.data as { groupName?: string })?.groupName === group.id,
      );

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
      ...collectBranchNodeIds(targetId, group),
    }));
    // A Parallel's branches all reconverge on one shared join node inside
    // the group (unlike a Conditional's branches, which each keep their own
    // separate trailing placeholder). That shared node sits centrally among
    // every branch, so folding it into any one branch's bounds would blow up
    // that branch's apparent size to span all the way to the shared point —
    // exclude it from both the bounds calculation and the move (it can't be
    // assigned to any single branch's lane; ELK already placed it to clear
    // every branch).
    const mainFlowBranchCountByNodeId = new Map<string, number>();

    rawBranches.forEach((branch) => {
      branch.mainFlowNodeIds.forEach((nodeId) => {
        mainFlowBranchCountByNodeId.set(
          nodeId,
          (mainFlowBranchCountByNodeId.get(nodeId) ?? 0) + 1,
        );
      });
    });

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
    const operatorCenter =
      (isVertical ? operatorPosition.x : operatorPosition.y) +
      (isVertical ? operatorDimensions.width : operatorDimensions.height) / 2;
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
  const outgoingBySource = new Map<
    string,
    Array<{ targetId: string; sourceHandle?: string | null }>
  >();
  const attachmentChildrenByParent = new Map<string, string[]>();

  edges.forEach(({ source, target, sourceHandle }) => {
    if (isAttachmentEdge({ sourceHandle } as Edge)) {
      attachmentChildrenByParent.set(source, [
        ...(attachmentChildrenByParent.get(source) ?? []),
        target,
      ]);

      return;
    }

    outgoingBySource.set(source, [
      ...(outgoingBySource.get(source) ?? []),
      { targetId: target, sourceHandle },
    ]);
  });

  const collectAttachmentDescendants = (rootId: string): string[] => {
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
  const getNodeFlowLeading = (nodeId: string): number | undefined => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    const position = positions.get(nodeId) ?? node.position;

    return isVertical ? position.y : position.x;
  };
  const moveNode = (nodeId: string, delta: number) => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    const position = positions.get(nodeId) ?? node.position;

    positions.set(
      nodeId,
      isVertical
        ? { x: position.x, y: position.y + delta }
        : { x: position.x + delta, y: position.y },
    );
  };
  // Returns the branch's main-flow nodes (used to compute where the branch
  // "starts") separately from its full node set including attachment
  // descendants (used when actually moving the branch). Attachment children
  // (e.g. a task's binding chips) are centered *below* their parent and can
  // end up with a smaller flow-axis coordinate than the parent purely as a
  // rendering artifact — mixing them into the leading calculation would
  // throw off the alignment target.
  const collectBranchNodeIds = (
    startId: string,
    group: GroupMeta,
  ): { mainFlowNodeIds: Set<string>; allNodeIds: Set<string> } => {
    const mainFlowNodeIds = new Set<string>();
    const queue = [startId];

    while (queue.length) {
      const current = queue.shift()!;

      if (mainFlowNodeIds.has(current) || !group.memberNodeIds.has(current)) {
        continue;
      }

      mainFlowNodeIds.add(current);

      (outgoingBySource.get(current) ?? []).forEach(({ targetId }) => {
        if (
          !mainFlowNodeIds.has(targetId) &&
          group.memberNodeIds.has(targetId)
        ) {
          queue.push(targetId);
        }
      });
    }

    const allNodeIds = new Set(mainFlowNodeIds);

    [...mainFlowNodeIds].forEach((nodeId) => {
      collectAttachmentDescendants(nodeId).forEach((attachmentId) => {
        allNodeIds.add(attachmentId);
      });
    });

    groups.forEach((candidateGroup, candidateGroupId) => {
      if (
        candidateGroupId === group.id ||
        candidateGroup.level <= group.level
      ) {
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
  const sortedGroups = [...groups.values()].sort((a, b) => b.level - a.level);

  sortedGroups.forEach((group) => {
    const operatorNode = [...group.memberNodeIds]
      .map((id) => nodesById.get(id))
      .filter((node): node is GraphNode => Boolean(node))
      .find(
        (node) =>
          node.type === ENodeType.OPERATOR &&
          (node.data as { groupName?: string })?.groupName === group.id,
      );

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
        const { mainFlowNodeIds, allNodeIds } = collectBranchNodeIds(
          targetId,
          group,
        );
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
    const branchCountByNodeId = new Map<string, number>();

    branches.forEach((branch) => {
      branch.nodeIds.forEach((nodeId) => {
        branchCountByNodeId.set(
          nodeId,
          (branchCountByNodeId.get(nodeId) ?? 0) + 1,
        );
      });
    });

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
    const getNodeBounds = (
      nodeId: string,
    ): { leading: number; trailing: number } | undefined => {
      const node = nodesById.get(nodeId);

      if (!node) {
        return;
      }

      const position = positions.get(nodeId) ?? node.position;
      const style = node.style as
        | { width?: number; height?: number }
        | undefined;
      const dimensions =
        node.type === ENodeType.GROUP
          ? { width: style?.width ?? 0, height: style?.height ?? 0 }
          : getWorkflowNodeDimensions(node.type, ctx.config);
      const flowLeading = isVertical ? position.y : position.x;
      const flowSize = isVertical ? dimensions.height : dimensions.width;

      return {
        leading: flowLeading,
        trailing: flowLeading + flowSize,
      };
    };
    const collectForwardNodeIds = (startId: string): Set<string> => {
      const forwardNodeIds = new Set<string>();
      const queue = [startId];

      while (queue.length) {
        const current = queue.shift()!;

        if (forwardNodeIds.has(current)) {
          continue;
        }

        forwardNodeIds.add(current);

        collectAttachmentDescendants(current).forEach((attachmentId) => {
          forwardNodeIds.add(attachmentId);
        });

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

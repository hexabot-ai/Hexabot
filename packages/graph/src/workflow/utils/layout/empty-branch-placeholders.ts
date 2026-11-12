/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import {
  ENodeType,
  type GraphNode,
  type INodeConfig,
} from "../../types/workflow-node.types";
import { getWorkflowNodeDimensions } from "../node-metrics.utils";

import { ELK_NODE_NODE_SPACING, FLOW_LAYER_GAP } from "./constants";
import {
  getAxisCenter,
  getFlowCoordinate,
  getFlowSize,
  getSpreadCoordinate,
  getSpreadSize,
  isHorizontalDirection,
  type LayoutContext,
  type NodePosition,
  withFlowCoordinate,
  withSpreadCoordinate,
} from "./geometry";
import {
  buildAttachmentMaps,
  buildOutgoingMap,
  collectAttachmentDescendants,
  parseConditionalBranchIndex,
  type OutgoingTarget,
} from "./graph-maps";

type BranchSlot = {
  branchIndex: number;
  node: GraphNode;
  isEmpty: boolean;
};
type PlacementContext = {
  isVertical: boolean;
  config?: INodeConfig;
  /** Trailing spread-axis edge of a node, its attachments included. */
  getSpreadExtent: (node: GraphNode) => number;
};

const getSpreadSizeOf = (nodeType: ENodeType, placement: PlacementContext) =>
  getSpreadSize(
    getWorkflowNodeDimensions(nodeType, placement.config),
    placement.isVertical,
  );
// The operator's conditional branches in branch-index order; an empty branch
// is one whose first node is its trailing placeholder.
const getConditionalBranchSlots = (
  operatorId: string,
  outgoingBySource: Map<string, OutgoingTarget[]>,
  nodesById: Map<string, GraphNode>,
): BranchSlot[] =>
  (outgoingBySource.get(operatorId) ?? [])
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
// Empty branches start where the content of their siblings starts. When all
// branches are empty, one ELK inter-layer gap after the operator — identical
// to ELK's natural position for a direct operator → placeholder edge (same
// arrow length as the empty branch of a mixed conditional).
const getEmptyBranchFlowStart = (
  operatorNode: GraphNode,
  nonEmptySlots: BranchSlot[],
  { isVertical, config }: PlacementContext,
): number =>
  nonEmptySlots.length
    ? Math.min(
        ...nonEmptySlots.map((s) =>
          getFlowCoordinate(s.node.position, isVertical),
        ),
      )
    : getFlowCoordinate(operatorNode.position, isVertical) +
      getFlowSize(
        getWorkflowNodeDimensions(operatorNode.type, config),
        isVertical,
      ) +
      FLOW_LAYER_GAP;
// With no non-empty anchor, the placeholders are spread evenly around the
// operator's spread-axis midpoint, one task-sized slot each (taskSize + ELK
// node-node spacing = 86 + 64 = 150 px, the spacing ELK produces for branches
// that each hold one task), centered within their slot.
const getEvenlySpreadLeadingEdges = (
  operatorNode: GraphNode,
  emptySlots: BranchSlot[],
  placement: PlacementContext,
): Map<string, number> => {
  const phSize = getSpreadSizeOf(ENodeType.BRANCH_PLACEHOLDER, placement);
  const slotSize = getSpreadSizeOf(ENodeType.TASK, placement);
  const pitch = slotSize + ELK_NODE_NODE_SPACING;
  const slotOffset = (slotSize - phSize) / 2;
  const operatorSpreadCenter = getAxisCenter(
    operatorNode.position,
    getWorkflowNodeDimensions(operatorNode.type, placement.config),
    placement.isVertical,
    "spread",
  );
  const totalSpan = (emptySlots.length - 1) * pitch;
  const firstSlotLeadingEdge =
    operatorSpreadCenter - totalSpan / 2 - slotSize / 2;

  return new Map(
    emptySlots.map(({ node: placeholder }, idx) => [
      placeholder.id,
      firstSlotLeadingEdge + idx * pitch + slotOffset,
    ]),
  );
};
// Per-branch spread pitch used to extrapolate past the outermost non-empty
// branch: measured between the outermost non-empty branches, else ELK's
// largest gap between consecutive branches, else a task's size plus 20px.
const getFallbackPitch = (
  slots: BranchSlot[],
  nonEmptySlots: BranchSlot[],
  placement: PlacementContext,
): number => {
  const { isVertical } = placement;
  const nodeCenter = (node: GraphNode): number =>
    (getSpreadCoordinate(node.position, isVertical) +
      placement.getSpreadExtent(node)) /
    2;
  let fallbackPitch = 0;

  if (nonEmptySlots.length >= 2) {
    const first = nonEmptySlots[0];
    const last = nonEmptySlots[nonEmptySlots.length - 1];
    const centerDiff = nodeCenter(last.node) - nodeCenter(first.node);
    const indexDiff = last.branchIndex - first.branchIndex;

    fallbackPitch = indexDiff > 0 ? centerDiff / indexDiff : 0;
  }

  if (fallbackPitch <= 0) {
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
    fallbackPitch = getSpreadSizeOf(ENodeType.TASK, placement) + 20;
  }

  return fallbackPitch;
};
// Places each empty placeholder relative to its nearest non-empty branches
// (in branch-index order) without moving those: empties between two of them
// share the gap evenly (equal padding before, between and after, packed from
// the center when the gap is too small); empties past the outermost one are
// extrapolated from it, one fallback pitch per branch.
const getAnchoredLeadingEdges = (
  slots: BranchSlot[],
  emptySlots: BranchSlot[],
  nonEmptySlots: BranchSlot[],
  placement: PlacementContext,
): Map<string, number> => {
  const { isVertical } = placement;
  const phSize = getSpreadSizeOf(ENodeType.BRANCH_PLACEHOLDER, placement);
  const nodeLeadingEdge = (node: GraphNode): number =>
    getSpreadCoordinate(node.position, isVertical);
  const nodeTrailingEdge = placement.getSpreadExtent;
  const fallbackPitch = getFallbackPitch(slots, nonEmptySlots, placement);
  // Empty slots grouped by their (above, below) anchor pair, in branch order.
  const emptyGroups = new Map<
    string,
    {
      above: BranchSlot | undefined;
      below: BranchSlot | undefined;
      slots: BranchSlot[];
    }
  >();
  const leadingEdges = new Map<string, number>();

  emptySlots.forEach((slot) => {
    const above = nonEmptySlots
      .filter((s) => s.branchIndex < slot.branchIndex)
      .at(-1);
    const below = nonEmptySlots.find((s) => s.branchIndex > slot.branchIndex);
    const key = `${above?.branchIndex ?? "none"}_${below?.branchIndex ?? "none"}`;

    if (!emptyGroups.has(key)) {
      emptyGroups.set(key, { above, below, slots: [] });
    }

    emptyGroups.get(key)!.slots.push(slot);
  });

  emptyGroups.forEach(({ above, below, slots: groupSlots }) => {
    const count = groupSlots.length;

    groupSlots.forEach(({ branchIndex, node: placeholder }, slotIdx) => {
      if (above && below) {
        const gapStart = nodeTrailingEdge(above.node);
        const gapEnd = nodeLeadingEdge(below.node);
        const totalPadding = Math.max(0, gapEnd - gapStart - count * phSize);
        const padding = totalPadding / (count + 1);

        leadingEdges.set(
          placeholder.id,
          gapStart + padding + slotIdx * (phSize + padding),
        );
      } else if (above) {
        leadingEdges.set(
          placeholder.id,
          nodeTrailingEdge(above.node) +
            (fallbackPitch - phSize) / 2 +
            (branchIndex - above.branchIndex - 1) * fallbackPitch,
        );
      } else if (below) {
        leadingEdges.set(
          placeholder.id,
          nodeLeadingEdge(below.node) -
            (fallbackPitch - phSize) / 2 -
            (below.branchIndex - branchIndex) * fallbackPitch,
        );
      }
    });
  });

  return leadingEdges;
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
export const alignEmptyBranchPlaceholders = (
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
  const placement: PlacementContext = {
    isVertical,
    config: ctx.config,
    // In horizontal mode attachments hang below the task (y + h) and extend
    // its spread-axis extent; in vertical mode they sit to its left.
    getSpreadExtent: (node) => {
      const extentOf = (extentNode: GraphNode) =>
        getSpreadCoordinate(extentNode.position, isVertical) +
        getSpreadSizeOf(extentNode.type, placement);
      let maxExtent = extentOf(node);

      if (!isVertical) {
        collectAttachmentDescendants(
          node.id,
          attachmentChildrenByParent,
          nodesById,
        ).forEach((childId) => {
          const child = nodesById.get(childId);

          if (child) {
            maxExtent = Math.max(maxExtent, extentOf(child));
          }
        });
      }

      return maxExtent;
    },
  };
  const overrides = new Map<string, NodePosition>();

  nodes
    .filter((node) => node.type === ENodeType.OPERATOR)
    .forEach((operatorNode) => {
      const slots = getConditionalBranchSlots(
        operatorNode.id,
        outgoingBySource,
        nodesById,
      );
      const emptySlots = slots.filter((s) => s.isEmpty);

      if (!emptySlots.length) {
        return;
      }

      const nonEmptySlots = slots.filter((s) => !s.isEmpty);
      const flowStart = getEmptyBranchFlowStart(
        operatorNode,
        nonEmptySlots,
        placement,
      );

      emptySlots.forEach(({ node: placeholder }) => {
        const currentFlow = getFlowCoordinate(placeholder.position, isVertical);

        if (Math.abs(currentFlow - flowStart) > 0.5) {
          overrides.set(
            placeholder.id,
            withFlowCoordinate(placeholder.position, isVertical, flowStart),
          );
        }
      });

      const leadingEdges = nonEmptySlots.length
        ? getAnchoredLeadingEdges(slots, emptySlots, nonEmptySlots, placement)
        : getEvenlySpreadLeadingEdges(operatorNode, emptySlots, placement);

      emptySlots.forEach(({ node: placeholder }) => {
        const leadingEdge = leadingEdges.get(placeholder.id);

        if (leadingEdge !== undefined) {
          overrides.set(
            placeholder.id,
            withSpreadCoordinate(
              overrides.get(placeholder.id) ?? placeholder.position,
              isVertical,
              leadingEdge,
            ),
          );
        }
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

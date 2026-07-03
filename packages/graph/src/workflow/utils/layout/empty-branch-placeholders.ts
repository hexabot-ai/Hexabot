/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
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
  withFlowCoordinate,
  withSpreadCoordinate,
} from "./geometry";
import {
  buildAttachmentMaps,
  buildOutgoingMap,
  collectAttachmentDescendants,
  parseConditionalBranchIndex,
} from "./graph-maps";

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
    const nodeTrailingEdge = nodeSpreadExtent;
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

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import type { GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import { runBranchGroupPass } from "./branch-group-pass";
import { FLOW_LAYER_GAP } from "./constants";
import type { AxisBounds, LayoutContext } from "./geometry";
import { collectAttachmentDescendants, countNodeIds } from "./graph-maps";

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
export const alignBranchFlowOrigins = (
  nodes: GraphNode[],
  edges: Edge[],
  groups: Map<string, GroupMeta>,
  ctx: LayoutContext,
): GraphNode[] =>
  runBranchGroupPass(
    nodes,
    edges,
    groups,
    ctx,
    "flow",
    ({ group, branchTargets, pass }) => {
      const {
        nodesById,
        moveNode,
        collectBranch,
        getNodeBounds,
        outgoingBySource,
        attachmentChildrenByParent,
      } = pass;
      const branches = branchTargets
        .map(({ targetId }) => {
          const { mainFlowNodeIds, allNodeIds } = collectBranch(
            targetId,
            group,
          );
          const leadings = [...mainFlowNodeIds]
            .map((nodeId) => getNodeBounds(nodeId, "flow")?.leading)
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

      const targetLeading = Math.max(
        ...branches.map((branch) => branch.leading),
      );
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

      const sharedNodeIds = [...branchCountByNodeId.entries()]
        .filter(([, count]) => count > 1)
        .map(([nodeId]) => nodeId);

      if (!sharedNodeIds.length) {
        return;
      }

      // A shared convergence node (e.g. a Parallel's join placeholder) is
      // deliberately left where ELK put it, on the assumption ELK already
      // placed it to clear every branch. That assumption can be wrong: ELK may
      // not rank real nested content (e.g. a task buried inside one branch's
      // own Conditional) as the deepest node, and the shared node must clear
      // not just individual branch nodes but the group's full padded bounding
      // box (the visual box drawn around the group) — otherwise it renders
      // inside the group instead of after it. Everything reachable *after* the
      // shared node (outside this group entirely — e.g. the step following the
      // whole Parallel) must shift by the same flow-axis amount, or it would
      // end up positioned before the node that now feeds it.
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
      // Measure only the group's *other* real content — not the shared node(s)
      // themselves, which are members of this group; including them would be
      // circular since the rendered box always grows to enclose wherever we
      // place them, so what they must clear is every other real member.
      const groupBounds = branches
        .flatMap((branch) => [...branch.nodeIds])
        .filter((nodeId) => (branchCountByNodeId.get(nodeId) ?? 0) <= 1)
        .map((nodeId) => getNodeBounds(nodeId, "flow"))
        .filter((bounds): bounds is AxisBounds => Boolean(bounds));

      if (!groupBounds.length) {
        return;
      }

      const groupTrailing =
        Math.max(...groupBounds.map((bounds) => bounds.trailing)) +
        FLOW_LAYER_GAP;

      sharedNodeIds.forEach((nodeId) => {
        const bounds = getNodeBounds(nodeId, "flow");

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
    },
  );

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";
import { isAttachmentSourceHandle } from "../port-rules";

import { appendMapValue } from "./geometry";

export const isAttachmentEdge = (edge: Edge) =>
  isAttachmentSourceHandle(edge.sourceHandle);

export const parseConditionalBranchIndex = (handle?: string | null): number => {
  const match = handle?.match(/operatorOut-(\d+)-\d+/);

  return match ? parseInt(match[1], 10) : -1;
};

export type BranchTraversal = {
  mainFlowNodeIds: Set<string>;
  allNodeIds: Set<string>;
};

export type OutgoingTarget = {
  targetId: string;
  sourceHandle?: string | null;
};

export const buildOutgoingMap = (
  edges: Edge[],
  includeAttachments = false,
): Map<string, OutgoingTarget[]> => {
  const outgoingBySource = new Map<string, OutgoingTarget[]>();

  edges.forEach((edge) => {
    if (includeAttachments || !isAttachmentEdge(edge)) {
      appendMapValue(outgoingBySource, edge.source, {
        targetId: edge.target,
        sourceHandle: edge.sourceHandle,
      });
    }
  });

  return outgoingBySource;
};

export const buildAttachmentMaps = (
  edges: Edge[],
  nodesById?: Map<string, GraphNode>,
) => {
  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();

  edges.forEach((edge) => {
    if (
      isAttachmentEdge(edge) &&
      (!nodesById || (nodesById.has(edge.source) && nodesById.has(edge.target)))
    ) {
      appendMapValue(childrenByParent, edge.source, edge.target);
      parentByChild.set(edge.target, edge.source);
    }
  });

  return { childrenByParent, parentByChild };
};

export const buildMainFlowMaps = (edges: Edge[]) => {
  const outgoingBySource = new Map<string, OutgoingTarget[]>();
  const attachmentChildrenByParent = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (isAttachmentEdge(edge)) {
      appendMapValue(attachmentChildrenByParent, edge.source, edge.target);
    } else {
      appendMapValue(outgoingBySource, edge.source, {
        targetId: edge.target,
        sourceHandle: edge.sourceHandle,
      });
    }
  });

  return { outgoingBySource, attachmentChildrenByParent };
};

export const collectAttachmentDescendants = (
  rootId: string,
  attachmentChildrenByParent: Map<string, string[]>,
  nodesById: Map<string, GraphNode>,
): string[] => {
  const result: string[] = [];
  const stack = [rootId];

  while (stack.length) {
    const children = attachmentChildrenByParent.get(stack.pop()!) ?? [];

    children.forEach((childId) => {
      if (nodesById.has(childId)) {
        result.push(childId);
        stack.push(childId);
      }
    });
  }

  return result;
};

export const collectNodeIdsWithAttachmentDescendants = (
  nodeIds: Iterable<string>,
  attachmentChildrenByParent: Map<string, string[]>,
  nodesById: Map<string, GraphNode>,
): Set<string> => {
  const result = new Set<string>();

  for (const nodeId of nodeIds) {
    result.add(nodeId);

    if (nodesById.has(nodeId)) {
      collectAttachmentDescendants(
        nodeId,
        attachmentChildrenByParent,
        nodesById,
      ).forEach((attachmentId) => result.add(attachmentId));
    }
  }

  return result;
};

export const getExistingNodes = (
  nodeIds: Iterable<string>,
  nodesById: Map<string, GraphNode>,
) =>
  [...nodeIds]
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is GraphNode => Boolean(node));

export const hasSharedNodeId = (left: Iterable<string>, right: Set<string>) =>
  [...left].some((nodeId) => right.has(nodeId));

export const collectNestedGroupOverlayIds = (
  group: GroupMeta,
  groups: Map<string, GroupMeta>,
  nodesById: Map<string, GraphNode>,
  requireOverlayNode = true,
) =>
  [...groups.entries()]
    .filter(
      ([candidateGroupId, candidateGroup]) =>
        candidateGroupId !== group.id &&
        candidateGroup.level > group.level &&
        (!requireOverlayNode || nodesById.has(candidateGroupId)) &&
        hasSharedNodeId(candidateGroup.memberNodeIds, group.memberNodeIds),
    )
    .map(([candidateGroupId]) => candidateGroupId);

export const collectGroupSubtreeIds = (
  group: GroupMeta,
  groups: Map<string, GroupMeta>,
  attachmentChildrenByParent: Map<string, string[]>,
  nodesById: Map<string, GraphNode>,
) => {
  const ids = collectNodeIdsWithAttachmentDescendants(
    group.memberNodeIds,
    attachmentChildrenByParent,
    nodesById,
  );

  if (nodesById.has(group.id)) {
    ids.add(group.id);
  }

  collectNestedGroupOverlayIds(group, groups, nodesById).forEach((id) =>
    ids.add(id),
  );

  return ids;
};

export const mapNodesToGroup = (
  groups: Map<string, GroupMeta>,
  preference: "innermost" | "outermost",
) => {
  const nodeToGroup = new Map<string, string>();

  groups.forEach((group, groupId) => {
    group.memberNodeIds.forEach((nodeId) => {
      const existingGroupId = nodeToGroup.get(nodeId);
      const existingLevel = existingGroupId
        ? (groups.get(existingGroupId)?.level ?? 0)
        : 0;
      const shouldReplace =
        !existingGroupId ||
        (preference === "innermost"
          ? group.level > existingLevel
          : group.level < existingLevel);

      if (shouldReplace) {
        nodeToGroup.set(nodeId, groupId);
      }
    });
  });

  return nodeToGroup;
};

export const getGroupOperatorNode = (
  group: GroupMeta,
  nodesById: Map<string, GraphNode>,
) => {
  for (const id of group.memberNodeIds) {
    const node = nodesById.get(id);

    if (
      node?.type === ENodeType.OPERATOR &&
      (node.data as { groupName?: string })?.groupName === group.id
    ) {
      return node;
    }
  }
};

export const collectBranchNodeIds = ({
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

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];

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

  collectNestedGroupOverlayIds(group, groups, nodesById)
    .filter((candidateGroupId) =>
      hasSharedNodeId(
        groups.get(candidateGroupId)!.memberNodeIds,
        mainFlowNodeIds,
      ),
    )
    .forEach((candidateGroupId) => allNodeIds.add(candidateGroupId));

  return { mainFlowNodeIds, allNodeIds };
};

export const countNodeIds = (nodeIdCollections: Iterable<Iterable<string>>) => {
  const counts = new Map<string, number>();

  for (const nodeIds of nodeIdCollections) {
    for (const nodeId of nodeIds) {
      counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
    }
  }

  return counts;
};

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
  if (!handle) {
    return -1;
  }

  const match = handle.match(/operatorOut-(\d+)-\d+/);

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
export const buildAttachmentMaps = (
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
export const buildMainFlowMaps = (edges: Edge[]) => {
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
export const collectAttachmentDescendants = (
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
export const collectNodeIdsWithAttachmentDescendants = (
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
export const mapNodesToGroup = (
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
export const getGroupOperatorNode = (
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
export const countNodeIds = (nodeIdCollections: Iterable<Iterable<string>>) => {
  const counts = new Map<string, number>();

  for (const nodeIds of nodeIdCollections) {
    for (const nodeId of nodeIds) {
      counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
    }
  }

  return counts;
};

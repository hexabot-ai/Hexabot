/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getNodesBounds, type Edge } from "@xyflow/react";

import { DEFAULT_NODE_PROPS } from "../../constants/workflow.constants";
import {
  ENodeType,
  type GraphNode,
  type INodeConfig,
} from "../../types/workflow-node.types";
import { withAlpha } from "../color.utils";
import type { GroupMeta } from "../graph-builder/types";

import { getGroupBackgroundAlpha, getGroupPadding } from "./constants";
import {
  buildAttachmentMaps,
  collectAttachmentDescendants,
} from "./graph-maps";

export const getGroupNodes = (
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
export const withFreshGroupNodes = (
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

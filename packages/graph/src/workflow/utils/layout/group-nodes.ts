/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";

import { DEFAULT_NODE_PROPS } from "../../constants/workflow.constants";
import {
  ENodeType,
  type GraphNode,
  type INodeConfig,
} from "../../types/workflow-node.types";
import { withAlpha } from "../color.utils";
import type { GroupMeta } from "../graph-builder/types";

import { getGroupBackgroundAlpha } from "./constants";
import { getGraphNodeDimensions, indexNodes } from "./geometry";
import {
  buildAttachmentMaps,
  collectAttachmentDescendants,
  collectNestedGroupOverlayIds,
  getExistingNodes,
} from "./graph-maps";

const getBounds = (nodes: GraphNode[], config: INodeConfig) => {
  const bounds = nodes.reduce(
    (acc, node) => {
      const dimensions = getGraphNodeDimensions(node, { config });

      return {
        left: Math.min(acc.left, node.position.x),
        top: Math.min(acc.top, node.position.y),
        right: Math.max(acc.right, node.position.x + dimensions.width),
        bottom: Math.max(acc.bottom, node.position.y + dimensions.height),
      };
    },
    {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity,
    },
  );

  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
};

export const getGroupNodes = (
  nodes: GraphNode[],
  groups: Map<string, GroupMeta>,
  config: INodeConfig,
  attachmentEdges: Edge[],
) => {
  const nodesById = indexNodes(nodes);
  const { childrenByParent: attachmentChildrenByParent } = buildAttachmentMaps(
    attachmentEdges,
    nodesById,
  );
  const groupNodes: GraphNode<ENodeType.GROUP>[] = [];
  const groupNodesById = new Map<string, GraphNode<ENodeType.GROUP>>();
  const groupsByDepth = [...groups.values()].sort((a, b) => b.level - a.level);

  groupsByDepth.forEach((group) => {
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
    const nestedGroupNodes = collectNestedGroupOverlayIds(
      group,
      groups,
      nodesById,
      false,
    )
      .map((candidateId) => groupNodesById.get(candidateId))
      .filter((node): node is GraphNode<ENodeType.GROUP> => Boolean(node));
    const boundsMembers = getExistingNodes(boundsMemberIds, nodesById);
    const color = config.highlights?.[group.operatorType]?.color;
    const padding = config.highlights?.[group.operatorType]?.padding ?? 0;
    const radius = config.highlights?.[group.operatorType]?.radius;
    const backgroundAlpha = getGroupBackgroundAlpha(group.level);
    const bounds = getBounds([...boundsMembers, ...nestedGroupNodes], config);
    const groupX = bounds.x - padding / 2;
    const groupY = bounds.y - padding / 2;
    const groupWidth = bounds.width + padding;
    const groupHeight = bounds.height + padding;
    const groupNode: GraphNode<ENodeType.GROUP> = {
      ...DEFAULT_NODE_PROPS,
      id: group.id,
      type: ENodeType.GROUP,
      position: { x: groupX, y: groupY },
      data: config.nodes[ENodeType.GROUP],
      zIndex: -1,
      style: {
        width: groupWidth,
        height: groupHeight,
        borderRadius: radius,
        backgroundColor: color ? withAlpha(color, backgroundAlpha) : undefined,
        border: `2px solid color-mix(in srgb, ${withAlpha(color || "", backgroundAlpha)} 85%, currentColor)`,
      },
    };

    groupNodesById.set(group.id, groupNode);
    groupNodes.push(groupNode);
  });

  return groupNodes.sort(
    (a, b) => (groups.get(a.id)?.level ?? 0) - (groups.get(b.id)?.level ?? 0),
  );
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

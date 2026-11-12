/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ENodeType } from "../../types/workflow-node.types";
import { areArraysEqual } from "../array.utils";
import { isAttachmentSourceHandle } from "../port-rules";

import { createEdgeId } from "./id-factory";
import { GraphRegistry } from "./registry";
import type { SemanticEdge, SemanticNode } from "./types";

const GROUP_EDGE_ELIGIBLE_NODE_TYPES = new Set<ENodeType>([
  ENodeType.INDICATOR,
  ENodeType.TASK,
  ENodeType.OPERATOR,
  ENodeType.BRANCH_PLACEHOLDER,
]);
const isPrefixPath = (prefix: string[], value: string[]): boolean => {
  if (prefix.length > value.length) {
    return false;
  }

  return prefix.every((part, index) => value[index] === part);
};
/**
 * Endpoints of the overlay edge standing for a direct edge that crosses a
 * group boundary: each end is replaced by its innermost group, except the
 * end that sits in a group enclosing the other one.
 */
const resolveGroupEdgeEndpoints = (
  source: { id: string; groupPath: string[] },
  target: { id: string; groupPath: string[] },
): { source: string; target: string } | undefined => {
  if (areArraysEqual(source.groupPath, target.groupPath)) {
    return;
  }

  const sourceGroupId = source.groupPath.at(-1);
  const targetGroupId = target.groupPath.at(-1);

  // Entering a group, from outside or from a group enclosing it.
  if (
    targetGroupId &&
    (!sourceGroupId || isPrefixPath(source.groupPath, target.groupPath))
  ) {
    return { source: source.id, target: targetGroupId };
  }

  // Leaving a group, to outside or to a group enclosing it.
  if (
    sourceGroupId &&
    (!targetGroupId || isPrefixPath(target.groupPath, source.groupPath))
  ) {
    return { source: sourceGroupId, target: target.id };
  }

  // Between two groups that do not enclose one another.
  return sourceGroupId && targetGroupId
    ? { source: sourceGroupId, target: targetGroupId }
    : undefined;
};
const toGroupOverlayEdge = (
  edge: SemanticEdge,
  sourceNode: SemanticNode,
  targetNode: SemanticNode,
): SemanticEdge | undefined => {
  // Attachment links stay direct: they never leave their owner's group.
  if (
    (edge.sourceHandle && isAttachmentSourceHandle(edge.sourceHandle)) ||
    !GROUP_EDGE_ELIGIBLE_NODE_TYPES.has(sourceNode.type) ||
    !GROUP_EDGE_ELIGIBLE_NODE_TYPES.has(targetNode.type)
  ) {
    return;
  }

  const endpoints = resolveGroupEdgeEndpoints(
    { id: sourceNode.id, groupPath: sourceNode.meta.groupPath },
    { id: targetNode.id, groupPath: targetNode.meta.groupPath },
  );

  if (!endpoints || endpoints.source === endpoints.target) {
    return;
  }

  // Handles only make sense on the ends that are still the original nodes.
  const sourceHandle =
    endpoints.source === sourceNode.id ? edge.sourceHandle : undefined;
  const targetHandle =
    endpoints.target === targetNode.id ? edge.targetHandle : undefined;

  return {
    id: createEdgeId({
      ...endpoints,
      sourceHandle,
      targetHandle,
      kind: "group",
    }),
    ...endpoints,
    sourceHandle,
    targetHandle,
    label: edge.label,
    insertPath: edge.insertPath,
    kind: "group",
  };
};

/**
 * Adds an overlay edge between groups for every direct edge crossing a group
 * boundary, and hides the direct edges the overlays replace (their insert
 * buttons move to the overlay) as well as edges leaving a placeholder for
 * real content.
 */
export const decorateSemanticGraph = (registry: GraphRegistry): void => {
  registry
    .listEdges()
    .filter((edge) => edge.kind === "direct")
    .forEach((edge) => {
      const sourceNode = registry.getNode(edge.source);
      const targetNode = registry.getNode(edge.target);

      if (!sourceNode || !targetNode) {
        return;
      }

      const overlayEdge = toGroupOverlayEdge(edge, sourceNode, targetNode);

      if (overlayEdge) {
        registry.upsertEdge(overlayEdge);
      }

      const shouldHideDirectEdge =
        Boolean(overlayEdge) ||
        Boolean(
          sourceNode.meta.isPlaceholder && !targetNode.meta.isPlaceholder,
        );

      registry.patchEdge(edge.id, {
        hidden: shouldHideDirectEdge || edge.hidden,
        insertPath: overlayEdge ? undefined : edge.insertPath,
      });
    });
};

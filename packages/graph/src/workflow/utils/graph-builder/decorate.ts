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
const resolveGroupEdgeEndpoints = (
  source: { id: string; groupPath: string[] },
  target: { id: string; groupPath: string[] },
): { source: string; target: string } | undefined => {
  if (areArraysEqual(source.groupPath, target.groupPath)) {
    return;
  }

  const sourceGroupId = source.groupPath[source.groupPath.length - 1];
  const targetGroupId = target.groupPath[target.groupPath.length - 1];

  if (!sourceGroupId && !targetGroupId) {
    return;
  }

  if (!sourceGroupId && targetGroupId) {
    return {
      source: source.id,
      target: targetGroupId,
    };
  }

  if (sourceGroupId && !targetGroupId) {
    return {
      source: sourceGroupId,
      target: target.id,
    };
  }

  if (!sourceGroupId || !targetGroupId) {
    return;
  }

  if (isPrefixPath(target.groupPath, source.groupPath)) {
    return {
      source: sourceGroupId,
      target: target.id,
    };
  }

  if (isPrefixPath(source.groupPath, target.groupPath)) {
    return {
      source: source.id,
      target: targetGroupId,
    };
  }

  return {
    source: sourceGroupId,
    target: targetGroupId,
  };
};

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

      const sourceMeta = sourceNode.meta;
      const targetMeta = targetNode.meta;
      const sourceType = sourceNode.type;
      const targetType = targetNode.type;
      const canCreateGroupEdge =
        (!edge.sourceHandle || !isAttachmentSourceHandle(edge.sourceHandle)) &&
        GROUP_EDGE_ELIGIBLE_NODE_TYPES.has(sourceType) &&
        GROUP_EDGE_ELIGIBLE_NODE_TYPES.has(targetType);
      const endpoints = canCreateGroupEdge
        ? resolveGroupEdgeEndpoints(
            {
              id: sourceNode.id,
              groupPath: sourceMeta.groupPath,
            },
            {
              id: targetNode.id,
              groupPath: targetMeta.groupPath,
            },
          )
        : undefined;
      const hasGroupEdge = Boolean(
        endpoints &&
          endpoints.source &&
          endpoints.target &&
          endpoints.source !== endpoints.target,
      );

      if (hasGroupEdge && endpoints) {
        const overlaySourceHandle =
          endpoints.source === sourceNode.id ? edge.sourceHandle : undefined;
        const overlayTargetHandle =
          endpoints.target === targetNode.id ? edge.targetHandle : undefined;

        registry.upsertEdge({
          id: createEdgeId({
            source: endpoints.source,
            target: endpoints.target,
            sourceHandle: overlaySourceHandle,
            targetHandle: overlayTargetHandle,
            kind: "group",
          }),
          source: endpoints.source,
          target: endpoints.target,
          sourceHandle: overlaySourceHandle,
          targetHandle: overlayTargetHandle,
          label: edge.label,
          insertPath: edge.insertPath,
          kind: "group",
        });
      }

      const shouldHideDirectEdge =
        hasGroupEdge ||
        Boolean(sourceMeta.isPlaceholder && !targetMeta.isPlaceholder);

      registry.patchEdge(edge.id, {
        hidden: shouldHideDirectEdge || edge.hidden,
        insertPath: hasGroupEdge ? undefined : edge.insertPath,
      });
    });
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";
import type { ResizeControlDirection } from "@xyflow/system";

import {
  EDGE_STYLES,
  NODE_DEFINITIONS,
  NODE_DIMENSIONS,
  NODE_METRICS,
  OPERATOR_HIGHLIGHTS,
} from "../constants/workflow.constants";
import type {
  GraphNode,
  IBuildNodesAndEdgesProps,
  INodeConfig,
} from "../types/workflow-node.types";

import { decorateSemanticGraph } from "./graph-builder/decorate";
import { projectSemanticGraph } from "./graph-builder/project";
import { traverseWorkflow } from "./graph-builder/traverse";
import { alignBranchFlowOrigins } from "./layout/branch-flow-origin";
import { symmetrizeBranchSiblings } from "./layout/branch-symmetry";
import { layoutNodesWithElk } from "./layout/elk-layout";
import { alignEmptyBranchPlaceholders } from "./layout/empty-branch-placeholders";
import { addExtraNodes } from "./layout/extra-nodes";
import { isAttachmentEdge } from "./layout/graph-maps";
import { alignGroupBoundaryNodesToGroupAxis } from "./layout/group-boundary-alignment";
import { alignGroupChainAxes } from "./layout/group-chain-alignment";
import { getGroupNodes, withFreshGroupNodes } from "./layout/group-nodes";
import { alignNextNodesWithPlaceholders } from "./layout/next-node-alignment";
import { alignAllNodesToStartAxis } from "./layout/start-axis-alignment";
import { tightenTrailingPlaceholders } from "./layout/trailing-placeholder-flow";

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
  const trailingTightenedNodes = tightenTrailingPlaceholders(
    emptyBranchAlignedNodes,
    projected.edges,
    traversal.groups,
    { config },
  );
  const flowAlignedNodes = alignBranchFlowOrigins(
    trailingTightenedNodes,
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
    withFreshGroupNodes(
      symmetrizeBranchSiblings(
        // Straighten group chains (e.g. Parallel → Conditional sequenced in
        // one branch) BEFORE the last packing pass: chain alignment can move a
        // chained group a long way onto its chain root's axis, and packing
        // with the pre-alignment bounds would reserve that group's old
        // position as a permanent oversized gap between sibling branches.
        alignGroupChainAxes(symmetricNodes, projected.edges, traversal.groups, {
          config,
        }),
        projected.edges,
        traversal.groups,
        { config },
      ),
      traversal.groups,
      config,
      attachmentEdges,
    ),
    projected.edges,
    traversal.groups,
    { config },
  );
  const boundaryAlignedNodes = alignGroupBoundaryNodesToGroupAxis(
    finalNodes,
    traversal.groups,
    { config },
  );

  return {
    edges: projected.edges,
    // Finally, straighten any chain of sibling groups sequenced inside a branch
    // (e.g. Parallel → Conditional → Conditional) onto a single spread axis.
    nodes: alignAllNodesToStartAxis(
      withFreshGroupNodes(
        alignGroupChainAxes(
          boundaryAlignedNodes,
          projected.edges,
          traversal.groups,
          { config },
        ),
        traversal.groups,
        config,
        attachmentEdges,
      ),
      projected.edges,
      traversal.groups,
      { config },
    ),
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

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
import { withFreshGroupNodes } from "./layout/group-nodes";
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

  const { registry, groups } = traverseWorkflow({
    flow,
    config,
    defs,
    actionCatalog,
    bindingCatalog,
  });

  decorateSemanticGraph(registry);

  const projected = projectSemanticGraph(registry, config);
  const { edges } = projected;
  const attachmentEdges = edges.filter(isAttachmentEdge);
  const ctx = { config };
  // Group overlays are sized from their content: rebuild them whenever a
  // pass may have moved it.
  const regroup = (nodes: GraphNode[]) =>
    withFreshGroupNodes(nodes, groups, config, attachmentEdges);
  const symmetrize = (nodes: GraphNode[]) =>
    regroup(symmetrizeBranchSiblings(nodes, edges, groups, ctx));
  /**
   * Straighten group chains (e.g. Parallel → Conditional sequenced in one
   * branch) BEFORE packing branches again: chain alignment can move a
   * chained group a long way onto its chain root's axis, and packing with the
   * pre-alignment bounds would reserve that group's old position as a
   * permanent oversized gap between sibling branches. Axis alignment runs
   * last, on the final group bounding boxes (which include padding and
   * attachment-shifted positions), so that groups, top-level nodes and
   * Start/Stop all land on the same perpendicular-axis line.
   */
  const straightenGroupChains = (nodes: GraphNode[]) =>
    alignAllNodesToStartAxis(
      symmetrize(regroup(alignGroupChainAxes(nodes, edges, groups, ctx))),
      edges,
      groups,
      ctx,
    );
  const elkNodes = await layoutNodesWithElk(projected.nodes, edges, ctx);
  const alignedNodes = alignNextNodesWithPlaceholders(
    elkNodes,
    edges,
    groups,
    ctx,
  );
  const positionedNodes = addExtraNodes(alignedNodes, attachmentEdges, ctx);
  const emptyBranchAlignedNodes = alignEmptyBranchPlaceholders(
    positionedNodes,
    edges,
    ctx,
  );
  const trailingTightenedNodes = tightenTrailingPlaceholders(
    emptyBranchAlignedNodes,
    edges,
    groups,
    ctx,
  );
  const flowAlignedNodes = alignBranchFlowOrigins(
    trailingTightenedNodes,
    edges,
    groups,
    ctx,
  );
  const symmetricNodes = symmetrize(symmetrize(regroup(flowAlignedNodes)));
  const boundaryAlignedNodes = alignGroupBoundaryNodesToGroupAxis(
    straightenGroupChains(symmetricNodes),
    groups,
    ctx,
  );

  return {
    edges,
    // Finally, straighten any chain of sibling groups sequenced inside a
    // branch (e.g. Parallel → Conditional → Conditional) onto a single
    // spread axis.
    nodes: straightenGroupChains(boundaryAlignedNodes),
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

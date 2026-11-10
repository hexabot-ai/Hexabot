/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { CSSProperties } from "react";

import {
  type ENodeType,
  type INodeConfig,
  type TNodeCardMetrics,
  type TNodeMetricsEntry,
} from "../types/workflow-node.types";

const DEFAULT_NODE_DIMENSIONS = { height: 0, width: 0 } as const;
const toPx = (value: number) => `${value}px`;
const getWorkflowNodeMetrics = (
  nodeType: ENodeType,
  config?: INodeConfig,
): TNodeMetricsEntry | undefined => {
  const nodeMetrics = config?.nodeMetrics?.[nodeType];

  if (nodeMetrics) {
    return nodeMetrics;
  }

  const dimensions = config?.dimensions?.[nodeType];

  if (!dimensions) {
    return;
  }

  return { dimensions };
};

export const getWorkflowNodeDimensions = (
  nodeType: ENodeType,
  config?: INodeConfig,
) =>
  getWorkflowNodeMetrics(nodeType, config)?.dimensions ??
  DEFAULT_NODE_DIMENSIONS;

export const getWorkflowNodeCardMetrics = (
  nodeType: ENodeType,
  config?: INodeConfig,
): TNodeCardMetrics | undefined =>
  getWorkflowNodeMetrics(nodeType, config)?.card;

export const getWorkflowNodeCardStyleVariables = (
  card: TNodeCardMetrics | undefined,
): CSSProperties | undefined => {
  if (!card) {
    return;
  }

  return {
    "--workflow-node-padding-x": toPx(card.paddingX),
    "--workflow-node-padding-y": toPx(card.paddingY),
    "--workflow-node-border-width": toPx(card.borderWidth),
    "--workflow-node-border-radius": toPx(card.borderRadius),
    "--workflow-node-title-min-height": toPx(card.titleMinHeight),
    "--workflow-node-description-indent": toPx(card.descriptionIndent),
    "--workflow-node-card-content-variant": card.contentVariant,
  } as CSSProperties;
};

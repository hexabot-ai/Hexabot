/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Position } from "@xyflow/react";
import type { ResizeControlDirection } from "@xyflow/system";
import type { CSSProperties } from "react";

import type { WorkflowPort } from "../types/workflow-node.types";

const LINK = {
  BINDING_SINGLE_IN: "bindingSingleIn",
  BINDING_MULTI_IN: "bindingMultiIn",
  BINDING_PLACEHOLDER_IN: "bindingPlaceholderIn",
  TASK_IN: "taskIn",
  TASK_OUT: "taskOut",
  BINDING_OUT: "bindingOut",
  INDICATOR_IN: "indicatorIn",
  INDICATOR_OUT: "indicatorOut",
  OPERATOR_IN: "operatorIn",
  OPERATOR_OUT: "operatorOut",
  GROUP_IN: "groupIn",
  GROUP_OUT: "groupOut",
  BRANCH_PLACEHOLDER_IN: "branchPlaceholderIn",
  BRANCH_PLACEHOLDER_OUT: "branchPlaceholderOut",
} as const;

type LinkType = (typeof LINK)[keyof typeof LINK];
type HandleType = "target" | "source";

const CONDITIONAL_OPERATOR_OUT_PATTERN = /^operatorOut-(\d+)-(\d+)$/;
const BINDING_OUT_PATTERN = /^bindingOut-(\d+)-(\d+)-(.+)$/;
// Parses an "<index>-<total>" indexed handle id and validates 0 <= index < total.
const parseIndexedHandle = (id: WorkflowPort | string, pattern: RegExp) => {
  const match = String(id).match(pattern);

  if (!match) {
    return;
  }

  const index = Number(match[1]);
  const total = Number(match[2]);

  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    index < 0 ||
    total < 1 ||
    index >= total
  ) {
    return;
  }

  return { index, total, match } as const;
};

export const getConditionalOperatorOutHandleMeta = (
  id: WorkflowPort | string,
) => {
  const meta = parseIndexedHandle(id, CONDITIONAL_OPERATOR_OUT_PATTERN);

  if (!meta) {
    return;
  }

  return { index: meta.index, total: meta.total } as const;
};

export const getBindingOutHandleMeta = (id: WorkflowPort | string) => {
  const meta = parseIndexedHandle(id, BINDING_OUT_PATTERN);

  if (!meta) {
    return;
  }

  let bindingKind: string;

  try {
    bindingKind = decodeURIComponent(meta.match[3]);
  } catch {
    return;
  }

  if (!bindingKind) {
    return;
  }

  return {
    baseId: LINK.BINDING_OUT,
    index: meta.index,
    total: meta.total,
    bindingKind,
  } as const;
};

export const isAttachmentSourceHandle = (
  id: WorkflowPort | string | null | undefined,
): boolean => {
  if (!id) {
    return false;
  }

  return Boolean(getBindingOutHandleMeta(String(id)));
};

const getPortBaseId = (id: WorkflowPort): LinkType => {
  const conditionalMeta = getConditionalOperatorOutHandleMeta(id);

  if (conditionalMeta) {
    return LINK.OPERATOR_OUT;
  }

  const bindingMeta = getBindingOutHandleMeta(id);

  if (bindingMeta) {
    return bindingMeta.baseId;
  }

  return id as LinkType;
};
// Spreads sibling handles evenly along the node edge named by `key`.
const buildProgressStyle = (
  meta: { index: number; total: number } | undefined,
  key: "top" | "left",
): CSSProperties | undefined =>
  meta
    ? { [key]: `${((meta.index + 1) / (meta.total + 1)) * 100}%` }
    : undefined;
const getConditionalOperatorOutStyle = (
  id: WorkflowPort,
  direction: ResizeControlDirection,
): CSSProperties | undefined =>
  buildProgressStyle(
    getConditionalOperatorOutHandleMeta(id),
    direction === "horizontal" ? "top" : "left",
  );
const getBindingOutStyle = (
  id: WorkflowPort,
  direction: ResizeControlDirection,
): CSSProperties | undefined =>
  buildProgressStyle(
    getBindingOutHandleMeta(id),
    direction === "horizontal" ? "left" : "top",
  );

type PortRule = {
  type: HandleType;
  position: {
    horizontal: Position;
    vertical: Position;
  };
  style?: (
    id: WorkflowPort,
    direction: ResizeControlDirection,
  ) => CSSProperties | undefined;
};

// A flow-axis input/output handle (Left/Right in horizontal, Top/Bottom in vertical).
const FLOW_IN_RULE: PortRule = {
  type: "target",
  position: { horizontal: Position.Left, vertical: Position.Top },
};
const FLOW_OUT_RULE: PortRule = {
  type: "source",
  position: { horizontal: Position.Right, vertical: Position.Bottom },
};
// A binding attachment input handle, centered on the edge facing the parent node.
const BINDING_IN_RULE: PortRule = {
  type: "target",
  position: { horizontal: Position.Top, vertical: Position.Right },
  style: (_, direction) =>
    direction === "horizontal" ? { left: "50%" } : undefined,
};
const PORT_RULES: Partial<Record<LinkType, PortRule>> = {
  [LINK.GROUP_IN]: FLOW_IN_RULE,
  [LINK.GROUP_OUT]: FLOW_OUT_RULE,
  [LINK.INDICATOR_IN]: FLOW_IN_RULE,
  [LINK.INDICATOR_OUT]: FLOW_OUT_RULE,
  [LINK.OPERATOR_IN]: FLOW_IN_RULE,
  [LINK.OPERATOR_OUT]: {
    ...FLOW_OUT_RULE,
    style: getConditionalOperatorOutStyle,
  },
  [LINK.TASK_IN]: FLOW_IN_RULE,
  [LINK.TASK_OUT]: FLOW_OUT_RULE,
  [LINK.BINDING_OUT]: {
    type: "source",
    position: { horizontal: Position.Bottom, vertical: Position.Left },
    style: getBindingOutStyle,
  },
  [LINK.BINDING_MULTI_IN]: BINDING_IN_RULE,
  [LINK.BINDING_PLACEHOLDER_IN]: BINDING_IN_RULE,
  [LINK.BINDING_SINGLE_IN]: BINDING_IN_RULE,
  [LINK.BRANCH_PLACEHOLDER_IN]: FLOW_IN_RULE,
  [LINK.BRANCH_PLACEHOLDER_OUT]: FLOW_OUT_RULE,
};
const DEFAULT_PORT_RULE: PortRule = FLOW_IN_RULE;
const SPECIAL_DIMENSION_HANDLES = new Set<LinkType>([
  LINK.BINDING_MULTI_IN,
  LINK.BINDING_PLACEHOLDER_IN,
  LINK.BINDING_SINGLE_IN,
  LINK.BINDING_OUT,
]);

export const resolveWorkflowPortRule = (
  id: WorkflowPort,
  direction: ResizeControlDirection,
): {
  baseId: LinkType;
  type: HandleType;
  position: Position;
  style?: CSSProperties;
} => {
  const baseId = getPortBaseId(id);
  const rule = PORT_RULES[baseId] || DEFAULT_PORT_RULE;

  return {
    baseId,
    type: rule.type,
    position: rule.position[direction],
    style: rule.style?.(id, direction),
  };
};

export const getWorkflowPortDimensions = (
  id: WorkflowPort,
  position: Position,
  direction: ResizeControlDirection,
): CSSProperties | undefined => {
  const baseId = getPortBaseId(id);
  const isHorizontalLeftRight =
    direction === "horizontal" &&
    [Position.Left, Position.Right].includes(position);
  const isVerticalTopBottom =
    direction === "vertical" &&
    [Position.Top, Position.Bottom].includes(position);

  if (isHorizontalLeftRight) {
    return {
      width: "6px",
      height: "14px",
    };
  }

  if (isVerticalTopBottom) {
    return {
      width: "14px",
      height: "6px",
    };
  }

  if (SPECIAL_DIMENSION_HANDLES.has(baseId)) {
    return direction === "horizontal"
      ? { width: "14px", height: "6px" }
      : { width: "6px", height: "14px" };
  }
};

export const getWorkflowPortBorderRadius = (
  position: Position,
  direction: ResizeControlDirection,
): CSSProperties => {
  const radiusMap = {
    [Position.Left]: {
      horizontal: { borderTopRightRadius: "0", borderBottomRightRadius: "0" },
      vertical: { borderBottomLeftRadius: "0", borderBottomRightRadius: "0" },
    },
    [Position.Right]: {
      horizontal: { borderTopLeftRadius: "0", borderBottomLeftRadius: "0" },
      vertical: { borderTopLeftRadius: "0", borderTopRightRadius: "0" },
    },
    [Position.Bottom]: {
      horizontal: { borderTopLeftRadius: "0", borderTopRightRadius: "0" },
      vertical: { borderBottomRightRadius: "0", borderTopRightRadius: "0" },
    },
    [Position.Top]: {
      horizontal: { borderBottomLeftRadius: "0", borderBottomRightRadius: "0" },
      vertical: { borderTopLeftRadius: "0", borderBottomLeftRadius: "0" },
    },
  } as const;

  return radiusMap[position][direction];
};

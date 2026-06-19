/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type CSSProperties, type PropsWithChildren } from "react";

import { useWorkflowNode } from "../../hooks/useWorkflowNode";
import {
  ENodeType,
  type NodeExecutionState,
  type TNodeCardContentVariant,
} from "../../types/workflow-node.types";

import { GenericNodeDeleteButton } from "./GenericNodeDeleteButton";
import { GenericNodeSeeCodeButton } from "./GenericNodeSeeCodeButton";

const ANIMATED_EXECUTION_BORDER_STATES = new Set<NodeExecutionState>([
  "running",
  "start",
  "suspended",
]);

export const GenericNodeRightContent = <T extends ENodeType = ENodeType>({
  children,
  variant = "title-only",
}: PropsWithChildren<{ variant?: TNodeCardContentVariant }>) => {
  const { executionState, resolvedTheme } = useWorkflowNode<T>();
  const { bgColor, borderColor } = resolvedTheme;
  const hasAnimatedExecutionBorder =
    executionState !== undefined &&
    ANIMATED_EXECUTION_BORDER_STATES.has(executionState);
  const style = {
    "--workflow-node-bg-color": bgColor,
    "--workflow-node-border-color": borderColor,
  } as CSSProperties;
  const className = [
    "workflow-node-card",
    `workflow-node-card--${variant}`,
    hasAnimatedExecutionBorder
      ? "workflow-node-card--animated-execution-border"
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} style={style}>
      <GenericNodeSeeCodeButton />
      <GenericNodeDeleteButton />
      {children}
    </div>
  );
};

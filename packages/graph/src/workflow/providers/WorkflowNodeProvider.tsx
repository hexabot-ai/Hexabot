/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ActionStatus } from "@hexabot-ai/agentic";
import { useMemo, type FC } from "react";

import { useWorkflowGraphHost } from "../contexts/workflow-graph-host.context";
import { WorkflowNodeContext } from "../contexts/workflow-node.context";
import type {
  ENodeType,
  IWorkflowNodeContext,
  IWorkflowNodeProps,
  NodeExecutionState,
} from "../types/workflow-node.types";
import { resolveWorkflowStepTheme } from "../utils/workflow-theme.utils";

const toActionStatus = (
  executionState?: NodeExecutionState,
): ActionStatus | undefined => {
  switch (executionState) {
    case "running":
    case "start":
      return "running";
    case "suspended":
      return "suspended";
    case "cancelled":
      return "cancelled";
    case "error":
      return "failed";
    case "finish":
      return "completed";
    default:
      return undefined;
  }
};

export const WorkflowNodeProvider: FC<IWorkflowNodeProps> = ({
  node,
  children,
}) => {
  const { actionCatalog, colorMode } = useWorkflowGraphHost();
  const {
    data,
    id,
    type,
    width,
    height,
    sourcePosition,
    targetPosition,
    dragHandle,
    parentId,
    dragging,
    zIndex,
    selectable,
    deletable,
    selected,
    draggable,
    positionAbsoluteX,
    positionAbsoluteY,
  } = node;
  const nodeData = data as {
    actionName?: unknown;
    executionState?: NodeExecutionState;
  };
  const actionName =
    typeof nodeData.actionName === "string" ? nodeData.actionName : undefined;
  const action = actionName ? actionCatalog.get(actionName) : undefined;
  const executionState = nodeData.executionState;
  const resolvedTheme = useMemo(
    () =>
      resolveWorkflowStepTheme({
        baseTheme: data.theme,
        action,
        status: toActionStatus(executionState),
        mode: colorMode,
      }),
    [action, colorMode, data.theme, executionState],
  );
  const contextValue = useMemo(
    () =>
      ({
        ...data,
        id,
        type: type as ENodeType,
        position: {
          x: positionAbsoluteX,
          y: positionAbsoluteY,
        },
        width,
        height,
        sourcePosition,
        targetPosition,
        dragHandle,
        parentId,
        dragging,
        zIndex,
        selectable,
        deletable,
        selected,
        draggable,
        action,
        executionState,
        resolvedTheme,
      }) as IWorkflowNodeContext,
    [
      action,
      data,
      deletable,
      dragHandle,
      draggable,
      dragging,
      executionState,
      height,
      id,
      parentId,
      positionAbsoluteX,
      positionAbsoluteY,
      resolvedTheme,
      selectable,
      selected,
      sourcePosition,
      targetPosition,
      type,
      width,
      zIndex,
    ],
  );

  return (
    <WorkflowNodeContext.Provider value={contextValue}>
      {children}
    </WorkflowNodeContext.Provider>
  );
};

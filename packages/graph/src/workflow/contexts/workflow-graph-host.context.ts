/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ResizeControlDirection } from "@xyflow/system";
import { createContext, useContext } from "react";

import type {
  WorkflowAction,
  WorkflowBindingAddPayload,
  WorkflowBindingRemovePayload,
} from "../types/workflow-node.types";
import type { FlowStepPath } from "../types/workflow-path.types";

export type WorkflowGraphTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export type WorkflowGraphHostContextValue = {
  translate: WorkflowGraphTranslate;
  colorMode: "light" | "dark";
  direction?: ResizeControlDirection;
  actionCatalog: ReadonlyMap<string, WorkflowAction>;
  onRemoveStep: (stepPath: FlowStepPath, nodeId?: string) => void;
  onAddBinding?: (payload: WorkflowBindingAddPayload) => void;
  onRemoveBinding?: (payload: WorkflowBindingRemovePayload) => void;
  onViewNodeCode?: (defName: string) => void;
  activeCodeDefName?: string;
};

export const WorkflowGraphHostContext =
  createContext<WorkflowGraphHostContextValue | null>(null);

export const useWorkflowGraphHost = (): WorkflowGraphHostContextValue => {
  const context = useContext(WorkflowGraphHostContext);

  if (!context) {
    throw new Error(
      "useWorkflowGraphHost must be used within WorkflowGraphHostContext.Provider",
    );
  }

  return context;
};

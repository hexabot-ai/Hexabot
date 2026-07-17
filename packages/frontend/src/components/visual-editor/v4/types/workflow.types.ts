/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  CompiledStep,
  TaskDefinition,
  WorkflowDefinition,
  WorkflowValidationIssue,
  WorkflowValidationIssueCode,
} from "@hexabot-ai/agentic";
import type {
  FlowStepPath,
  WorkflowSelectionSnapshot,
} from "@hexabot-ai/graph";
import type { Workflow } from "@hexabot-ai/types";
import type { Cancelable } from "@mui/utils/debounce";
import type { UseMutateFunction } from "@tanstack/react-query";
import type { ResizeControlDirection } from "@xyflow/system";
import type { Dispatch, ReactNode, SetStateAction } from "react";

import { EntityType } from "@/services/types";
import type { IAction } from "@/types/action.types";
import type { EntityAttributes } from "@/types/base.types";

import type { UpdateWorkflowDefinitionStateOptions } from "../utils/workflow-definition-state.utils";

type WorkflowAttributes = EntityAttributes<EntityType.WORKFLOW>;

export type WorkflowIssueCode =
  | WorkflowValidationIssueCode
  // Frontend-only codes: catalog loading and defensive compilation failures.
  | "catalog_error"
  | "compile_error";

/**
 * A workflow definition problem ready for display: `message` is localized,
 * `rawMessage` keeps the original validator string (Monaco markers, debug).
 */
export type WorkflowIssue = Omit<WorkflowValidationIssue, "code"> & {
  code: WorkflowIssueCode;
  rawMessage: string;
};

/**
 * Raw issue as produced by validation, before localization. Same shape as the
 * agentic issue but widened to include frontend-only codes.
 */
export type RawWorkflowIssue = Omit<WorkflowValidationIssue, "code"> & {
  code: WorkflowIssueCode;
};

export type WorkflowDefinitionStatus =
  | "loading"
  | "empty"
  | "invalid"
  | "ready";
type UpdateWorkflowDefinitionState = (
  nextDefinition: string | WorkflowDefinition,
  options?: UpdateWorkflowDefinitionStateOptions,
) => void;

export interface IWorkflowContext {
  getWorkflowFromCache: (id: string) => Workflow | undefined;
  graphSelection: WorkflowSelectionSnapshot;
  selectedNodeIds: string[];
  setGraphSelection: (selection: WorkflowSelectionSnapshot) => void;
  selectedFlowId?: string;
  openSearchPanel: boolean;
  setOpenSearchPanel: Dispatch<SetStateAction<boolean>>;
  getQuery: (key: string) => string;
  direction?: ResizeControlDirection;
  setDirection?: Dispatch<SetStateAction<ResizeControlDirection>>;
  removeWorkflowParams: () => Promise<void>;
  updateWorkflowURL: (workflowIid: string, nodeIds?: string[]) => Promise<void>;
  yaml: string;
  updateDefinitionState: UpdateWorkflowDefinitionState;
  workflow?: Workflow;
  workflows?: Workflow[];
  debouncedWorkflowUpdate: ((params: Partial<WorkflowAttributes>) => void) &
    Cancelable;
  updateWorkflow: UseMutateFunction<
    Workflow,
    Error,
    {
      id: string;
      params: Partial<WorkflowAttributes>;
    },
    Workflow
  >;
  persistDefinition: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  publishVersion: (versionId?: string) => void;
  unpublishVersion: () => void;
  restoreVersion: (parentVersion: string, definitionYml: string) => void;
  updateVersionMessage: (versionId: string, message: string) => void;
  isDefinitionDirty: boolean;
  isSaving: boolean;
  isExportingWorkflow: boolean;
  isImportingWorkflow: boolean;
  exportWorkflow: (workflowId: string) => void;
  importWorkflowBundle: (file: File) => void;
  addActionStep: (action: IAction, insertPath?: FlowStepPath | null) => void;
  addConditionalStep: (insertPath?: FlowStepPath | null) => void;
  addLoopStep: (insertPath?: FlowStepPath | null) => void;
  addParallelStep: (insertPath?: FlowStepPath | null) => void;
  removeStepAtPath: (stepPath: FlowStepPath, nodeId?: string) => void;
  definition?: WorkflowDefinition;
  flow?: CompiledStep[];
  definitionStatus: WorkflowDefinitionStatus;
  definitionIssues: WorkflowIssue[];
  taskDefinitions: Record<string, TaskDefinition>;
}

export interface WorkflowContextProps {
  children: ReactNode;
  workflow?: Workflow;
}

export type {
  SubscribeWorkflowProps,
  WorkflowEvent,
} from "@/websocket/types/workflow.types";

export type NodeExecutionState =
  | "idle"
  | "running"
  | "start"
  | "finish"
  | "suspended"
  | "cancelled"
  | "error";

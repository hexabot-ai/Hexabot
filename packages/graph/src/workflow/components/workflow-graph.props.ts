/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { CompiledStep, WorkflowDefinition } from "@hexabot-ai/agentic";
import type { Node, NodeMouseHandler, Viewport } from "@xyflow/react";
import type { ResizeControlDirection } from "@xyflow/system";
import type { PropsWithChildren } from "react";

import type { WorkflowGraphTranslate } from "../contexts/workflow-graph-host.context";
import type {
  WorkflowAction,
  WorkflowBindingAddPayload,
  WorkflowBindingCatalog,
  WorkflowBindingRemovePayload,
  WorkflowExecutionStateMap,
} from "../types/workflow-node.types";
import type {
  EdgeInsertType,
  FlowStepPath,
} from "../types/workflow-path.types";
import type { WorkflowSelectionSnapshot } from "../types/workflow-selection.types";
import { areArraysEqual } from "../utils/array.utils";
import type { ViewportState } from "../utils/workflow-graph.utils";

/**
 * A single reason the workflow could not be compiled. `line` is the 1-based
 * YAML line the issue maps to, when the host can resolve one, enabling a
 * jump-to-line link in the error panel.
 */
export type WorkflowGraphIssue = {
  message: string;
  line?: number;
};

export type WorkflowGraphModel = {
  definition?: WorkflowDefinition;
  compiledFlow?: CompiledStep[];
  actionCatalog: ReadonlyMap<string, WorkflowAction>;
  bindingCatalog: WorkflowBindingCatalog;
  executionStates: WorkflowExecutionStateMap;
  layoutDirection?: ResizeControlDirection;
  activeCodeDefName?: string;
  /**
   * Reasons why the workflow could not be compiled (missing actions, validation
   * errors, …). When set, a blocking error panel is overlaid on the canvas —
   * over the last-good graph when the host keeps providing one via
   * `compiledFlow`, or over the empty canvas otherwise.
   */
  issues?: WorkflowGraphIssue[];
};

export type WorkflowGraphSelection = {
  selectedNodeIds: string[];
  focusNodeIds?: string[];
  onChange?: (selection: WorkflowSelectionSnapshot) => void;
  onFocusComplete?: () => void;
};

export type WorkflowGraphInsertion = {
  onInsertAtPath?: (insertType: EdgeInsertType, path: FlowStepPath) => void;
  onInsertAtRoot?: (insertType: EdgeInsertType) => void;
};

export type WorkflowGraphViewport = {
  value?: ViewportState | null;
  onChange: ({ zoom, x, y }: Viewport) => void;
};

export type WorkflowGraphCallbacks = {
  onNodeClick?: NodeMouseHandler<Node>;
  onRemoveStep: (stepPath: FlowStepPath, nodeId?: string) => void;
  onAddBinding?: (payload: WorkflowBindingAddPayload) => void;
  onRemoveBinding?: (payload: WorkflowBindingRemovePayload) => void;
  onRotate: (nextDirection: "horizontal" | "vertical") => Promise<boolean>;
  onViewNodeCode?: (defName: string) => void;
  onOpenYamlEditor?: (line?: number) => void;
};

export type WorkflowGraphColorMode = "light" | "dark" | "system";

export type WorkflowGraphProps = PropsWithChildren<{
  t: WorkflowGraphTranslate;
  model: WorkflowGraphModel;
  selection: WorkflowGraphSelection;
  insertion?: WorkflowGraphInsertion;
  viewport: WorkflowGraphViewport;
  callbacks: WorkflowGraphCallbacks;
  colorMode?: WorkflowGraphColorMode;
}>;

export type WorkflowGraphHandle = {
  animateFocus: (nodeIds?: string[]) => Promise<void>;
  requestCenterAfterFirstInsert: () => void;
  clearCenterAfterFirstInsert: () => void;
};

/**
 * One comparator per field, so adding a field to a props type without
 * deciding how it is compared fails type checking.
 */
type FieldComparators<T> = {
  [K in keyof T]-?: (
    left: T[K] | undefined,
    right: T[K] | undefined,
  ) => boolean;
};

const isSame = <V>(left: V, right: V): boolean => left === right;
const haveSameFields = <T extends object>(
  comparators: FieldComparators<T>,
  left: T | undefined,
  right: T | undefined,
): boolean =>
  (Object.keys(comparators) as Array<keyof T>).every((key) =>
    (comparators[key] as (left: unknown, right: unknown) => boolean)(
      left?.[key],
      right?.[key],
    ),
  );
const isSameWorkflowIssue = (
  left: WorkflowGraphIssue,
  right: WorkflowGraphIssue,
): boolean => left.message === right.message && left.line === right.line;
const isSameViewportState = (
  left: ViewportState | null | undefined,
  right: ViewportState | null | undefined,
): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.id === right.id &&
    left.x === right.x &&
    left.y === right.y &&
    left.zoom === right.zoom
  );
};
const MODEL_COMPARATORS: FieldComparators<WorkflowGraphModel> = {
  // Only the definition's defs feed the graph.
  definition: (left, right) => left?.defs === right?.defs,
  compiledFlow: isSame,
  actionCatalog: isSame,
  bindingCatalog: isSame,
  executionStates: isSame,
  layoutDirection: isSame,
  activeCodeDefName: isSame,
  issues: (left, right) => areArraysEqual(left, right, isSameWorkflowIssue),
};
const SELECTION_COMPARATORS: FieldComparators<WorkflowGraphSelection> = {
  selectedNodeIds: (left, right) => areArraysEqual(left, right),
  focusNodeIds: (left, right) => areArraysEqual(left, right),
  onChange: isSame,
  onFocusComplete: isSame,
};
const INSERTION_COMPARATORS: FieldComparators<WorkflowGraphInsertion> = {
  onInsertAtPath: isSame,
  onInsertAtRoot: isSame,
};
const VIEWPORT_COMPARATORS: FieldComparators<WorkflowGraphViewport> = {
  value: isSameViewportState,
  onChange: isSame,
};
const CALLBACK_COMPARATORS: FieldComparators<WorkflowGraphCallbacks> = {
  onNodeClick: isSame,
  onRemoveStep: isSame,
  onAddBinding: isSame,
  onRemoveBinding: isSame,
  onRotate: isSame,
  onViewNodeCode: isSame,
  onOpenYamlEditor: isSame,
};
const PROPS_COMPARATORS: FieldComparators<WorkflowGraphProps> = {
  children: isSame,
  colorMode: isSame,
  t: isSame,
  model: (left, right) => haveSameFields(MODEL_COMPARATORS, left, right),
  selection: (left, right) =>
    haveSameFields(SELECTION_COMPARATORS, left, right),
  insertion: (left, right) =>
    haveSameFields(INSERTION_COMPARATORS, left, right),
  viewport: (left, right) => haveSameFields(VIEWPORT_COMPARATORS, left, right),
  callbacks: (left, right) => haveSameFields(CALLBACK_COMPARATORS, left, right),
};

/**
 * `WorkflowGraph` memo comparator: callbacks and catalogs by reference, id
 * lists, issues and the viewport by value.
 */
export const areWorkflowGraphPropsEqual = (
  previous: WorkflowGraphProps,
  next: WorkflowGraphProps,
): boolean => haveSameFields(PROPS_COMPARATORS, previous, next);

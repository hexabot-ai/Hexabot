/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType } from "@hexabot-ai/agentic";
import {
  ENodeType,
  type FlowStepPath,
  type WorkflowSelectionNode,
  type WorkflowSelectionSnapshot,
} from "@hexabot-ai/graph";
import { useMemo } from "react";

import { useWorkflow } from "./useWorkflow";

type OperatorStepType =
  | StepType.Conditional
  | StepType.Loop
  | StepType.Parallel;

export type SelectedActionNode = WorkflowSelectionNode & {
  type: ENodeType.TASK;
  taskName: string;
};

export type SelectedOperatorNode<TStepType extends OperatorStepType> =
  WorkflowSelectionNode & {
    type: ENodeType.OPERATOR;
    operatorType: TStepType;
    stepPath: FlowStepPath;
  };

export const getSingleSelectedNode = (
  selection: WorkflowSelectionSnapshot,
): WorkflowSelectionNode | undefined => {
  if (selection.nodeIds.length !== 1) {
    return undefined;
  }

  const [selectedNodeId] = selection.nodeIds;

  return selection.nodes.find((node) => node.id === selectedNodeId);
};

export const getSelectedActionNode = (
  selection: WorkflowSelectionSnapshot,
): SelectedActionNode | undefined => {
  const selectedNode = getSingleSelectedNode(selection);

  if (
    !selectedNode ||
    selectedNode.type !== ENodeType.TASK ||
    typeof selectedNode.taskName !== "string"
  ) {
    return undefined;
  }

  return selectedNode as SelectedActionNode;
};

export const getSelectedOperatorNode = <TStepType extends OperatorStepType>(
  selection: WorkflowSelectionSnapshot,
  stepType: TStepType,
): SelectedOperatorNode<TStepType> | undefined => {
  const selectedNode = getSingleSelectedNode(selection);

  if (
    !selectedNode ||
    selectedNode.type !== ENodeType.OPERATOR ||
    selectedNode.operatorType !== stepType ||
    !Array.isArray(selectedNode.stepPath)
  ) {
    return undefined;
  }

  return selectedNode as SelectedOperatorNode<TStepType>;
};

export const useSelectedActionNode = (): SelectedActionNode | undefined => {
  const { graphSelection } = useWorkflow();

  return useMemo(() => getSelectedActionNode(graphSelection), [graphSelection]);
};

export const useSelectedOperatorNode = <TStepType extends OperatorStepType>(
  stepType: TStepType,
): SelectedOperatorNode<TStepType> | undefined => {
  const { graphSelection } = useWorkflow();

  return useMemo(
    () => getSelectedOperatorNode(graphSelection, stepType),
    [graphSelection, stepType],
  );
};

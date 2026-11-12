/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType } from "@hexabot-ai/agentic";

import {
  ENodeType,
  type EOperatorType,
  type GraphNode,
} from "../types/workflow-node.types";
import type { FlowStepPath } from "../types/workflow-path.types";
import type {
  WorkflowSelectionNode,
  WorkflowSelectionSnapshot,
} from "../types/workflow-selection.types";

import { areArraysEqual } from "./array.utils";

const isOperatorType = (value: unknown): value is EOperatorType => {
  return (
    value === StepType.Conditional ||
    value === StepType.Loop ||
    value === StepType.Parallel
  );
};
const toStepPath = (value: unknown): FlowStepPath | undefined => {
  return Array.isArray(value) ? (value as FlowStepPath) : undefined;
};
const toStringValue = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

export const createWorkflowSelectionNode = (
  node: GraphNode,
): WorkflowSelectionNode => {
  const nodeData = node.data as {
    stepId?: unknown;
    stepPath?: unknown;
    operatorType?: unknown;
    title?: unknown;
    actionName?: unknown;
  };

  return {
    id: node.id,
    type: node.type,
    stepId: toStringValue(nodeData.stepId),
    stepPath: toStepPath(nodeData.stepPath),
    operatorType: isOperatorType(nodeData.operatorType)
      ? nodeData.operatorType
      : undefined,
    taskName:
      node.type === ENodeType.TASK ? toStringValue(nodeData.title) : undefined,
    actionName:
      node.type === ENodeType.TASK
        ? toStringValue(nodeData.actionName)
        : undefined,
  };
};

export const createWorkflowSelectionSnapshot = (
  requestedNodeIds: string[],
  nodes: GraphNode[],
): WorkflowSelectionSnapshot => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return createWorkflowSelectionSnapshotFromMap(requestedNodeIds, nodesById);
};

export const createWorkflowSelectionSnapshotFromMap = (
  requestedNodeIds: string[],
  nodesById: ReadonlyMap<string, GraphNode>,
): WorkflowSelectionSnapshot => {
  const nodeIds: string[] = [];
  const selectionNodes: WorkflowSelectionNode[] = [];

  requestedNodeIds.forEach((nodeId) => {
    const node = nodesById.get(nodeId);

    if (!node) {
      return;
    }

    nodeIds.push(nodeId);
    selectionNodes.push(createWorkflowSelectionNode(node));
  });

  return {
    nodeIds,
    nodes: selectionNodes,
  };
};

export const isSameWorkflowSelectionNode = (
  leftNode: WorkflowSelectionNode,
  rightNode: WorkflowSelectionNode,
): boolean => {
  return (
    leftNode.id === rightNode.id &&
    leftNode.type === rightNode.type &&
    leftNode.stepId === rightNode.stepId &&
    leftNode.operatorType === rightNode.operatorType &&
    leftNode.taskName === rightNode.taskName &&
    leftNode.actionName === rightNode.actionName &&
    areArraysEqual(leftNode.stepPath, rightNode.stepPath)
  );
};

export const isSameWorkflowSelection = (
  leftSelection: WorkflowSelectionSnapshot,
  rightSelection: WorkflowSelectionSnapshot,
): boolean =>
  areArraysEqual(leftSelection.nodeIds, rightSelection.nodeIds) &&
  areArraysEqual(
    leftSelection.nodes,
    rightSelection.nodes,
    isSameWorkflowSelectionNode,
  );

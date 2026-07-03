/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  CompiledStep,
  DefDefinitions,
  StepType,
} from "@hexabot-ai/agentic";
import type {
  Edge,
  EdgeTypes,
  Node,
  NodeProps,
  NodeTypes,
} from "@xyflow/react";
import type {
  EdgeMarkerType,
  NodeConnection,
  ResizeControlDirection,
} from "@xyflow/system";
import { memo } from "react";
import type { CSSProperties, JSXElementConstructor, ReactNode } from "react";

import { EdgeWithButton } from "../components/edges/EdgeWithButton";
import { BindingMulti } from "../components/workflow-nodes/BindingMulti";
import { BindingPlaceholder } from "../components/workflow-nodes/BindingPlaceholder";
import { BindingSingle } from "../components/workflow-nodes/BindingSingle";
import { BranchPlaceholder } from "../components/workflow-nodes/BranchPlaceholder";
import { Group } from "../components/workflow-nodes/Group";
import { Indicator } from "../components/workflow-nodes/Indicator";
import { Operator } from "../components/workflow-nodes/Operator";
import { Task } from "../components/workflow-nodes/Task";

import type { FlowStepPath, OnOpenInsertMenu } from "./workflow-path.types";

export type WorkflowIcon = JSXElementConstructor<any>;

export type WorkflowAction = {
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  supportedBindings?: readonly string[];
};

export type NodeExecutionState =
  | "idle"
  | "running"
  | "start"
  | "finish"
  | "suspended"
  | "cancelled"
  | "error";

export type WorkflowExecutionState = {
  state: NodeExecutionState;
  t: number;
};

export type WorkflowExecutionStateMap = Record<
  string,
  WorkflowExecutionState[]
>;
export type WorkflowBindingSchema = unknown;
export type WorkflowBindingDefinition = {
  schema: WorkflowBindingSchema;
  multiple: boolean;
  color?: string;
  icon?: string;
  supportedBindings?: readonly string[];
  actionPolicy?: "forbidden" | "optional" | "required";
};
export type WorkflowBindingCatalog = ReadonlyMap<
  string,
  WorkflowBindingDefinition
>;

type NodeDataTitle =
  | { title: string; i18nTitle?: undefined }
  | { i18nTitle: string; title?: undefined };

export type WorkflowNodeTheme = {
  Icon?: WorkflowIcon;
  icon?: string;
  color?: CSSProperties["color"];
  bgColor?: CSSProperties["color"];
  iconColor?: CSSProperties["color"];
  borderColor?: CSSProperties["color"];
};

export type CommonNodeDadaTypes = NodeDataTitle & {
  stepId?: string;
  taskName?: string;
  ownerDefName?: string;
  ownerBindingKind?: string;
  bindingKind?: string;
  bindingName?: string;
  description?: string;
  groupName?: string;
  stepPath?: FlowStepPath;
  theme: WorkflowNodeTheme;
  level?: number;
  executionState?: NodeExecutionState;
};

type CommonNodeData<T extends ENodeType> = CommonNodeDadaTypes & {
  ports: WorkflowNodePort<T>[];
};

export type BindingSingleData = CommonNodeData<ENodeType.BINDING_SINGLE>;
export type BindingMultiData = CommonNodeData<ENodeType.BINDING_MULTI>;

export type TaskData = CommonNodeData<ENodeType.TASK> & {
  actionName?: string;
};

export type IndicatorData = CommonNodeData<ENodeType.INDICATOR> & {
  indicator?: EIndicatorType;
};

export type BranchPlaceholderData =
  CommonNodeData<ENodeType.BRANCH_PLACEHOLDER> & {
    insertPath?: FlowStepPath;
    onOpenInsertMenu?: OnOpenInsertMenu;
  };
export type BindingPlaceholderData =
  CommonNodeData<ENodeType.BINDING_PLACEHOLDER> & {
    ownerDefName?: string;
    bindingKind?: string;
  };

export type WorkflowBindingBasePayload = {
  stepId?: string;
  stepPath?: FlowStepPath;
  ownerDefName: string;
  bindingKind: string;
  nodeId?: string;
};

export type WorkflowBindingAddPayload = WorkflowBindingBasePayload;

export type WorkflowBindingRemovePayload = WorkflowBindingBasePayload & {
  bindingName: string;
};

export enum EIndicatorType {
  WORKFLOW_START = "workflowStart",
  WORKFLOW_END = "workflowEnd",
}

export type EOperatorType = Extract<
  StepType,
  StepType.Conditional | StepType.Loop | StepType.Parallel
>;

export type OperatorData = CommonNodeData<ENodeType.OPERATOR> & {
  operatorType?: EOperatorType;
  strategy?: "wait_all" | "wait_any";
};

export type GroupData = {
  ports: WorkflowNodePort<ENodeType.GROUP>[];
  theme: {
    bgColor: string;
  };
  groupName?: never;
};

export type EdgeLink = Edge & { id: string; source: string; target: string };

export enum EHandleType {
  TARGET = "target",
  SOURCE = "source",
}

export enum ELinkType {
  BINDING_SINGLE_IN = "bindingSingleIn",
  BINDING_MULTI_IN = "bindingMultiIn",
  BINDING_PLACEHOLDER_IN = "bindingPlaceholderIn",
  TASK_IN = "taskIn",
  TASK_OUT = "taskOut",
  BINDING_OUT = "bindingOut",
  INDICATOR_IN = "indicatorIn",
  INDICATOR_OUT = "indicatorOut",
  OPERATOR_IN = "operatorIn",
  OPERATOR_OUT = "operatorOut",
  GROUP_IN = "groupIn",
  GROUP_OUT = "groupOut",
  BRANCH_PLACEHOLDER_IN = "branchPlaceholderIn",
  BRANCH_PLACEHOLDER_OUT = "branchPlaceholderOut",
}

export type ConditionalOperatorOutPort =
  `${ELinkType.OPERATOR_OUT}-${number}-${number}`;
export type BindingOutPort =
  `${ELinkType.BINDING_OUT}-${number}-${number}-${string}`;

export type WorkflowPort =
  | ELinkType
  | ConditionalOperatorOutPort
  | BindingOutPort;

type WorkflowPortPrefix<P extends string> = P extends
  | ENodeType.TASK
  | ENodeType.BINDING_MULTI
  | ENodeType.BINDING_SINGLE
  ? P | "bindingOut"
  : P;

export type Port<P extends string> = Extract<
  WorkflowPort,
  `${WorkflowPortPrefix<P>}${string}`
>;
export type WorkflowPortObject<P extends string> = {
  id: Port<P>;
  label?: string;
};
export type WorkflowNodePort<P extends string> =
  | Port<P>
  | WorkflowPortObject<P>;

export const getWorkflowPortId = <P extends string>(
  port: WorkflowNodePort<P>,
): Port<P> => (typeof port === "string" ? port : port.id);

export type THighlightGroups = {
  [K in EOperatorType]?: {
    padding?: number;
    color?: string;
    radius?: string | number;
  };
};

export type TNodeCardContentVariant = "title-only" | "title-with-description";

export type TNodeCardMetrics = {
  paddingX: number;
  paddingY: number;
  borderWidth: number;
  borderRadius: number;
  titleMinHeight: number;
  descriptionIndent: number;
  contentVariant: TNodeCardContentVariant;
};

export type TNodeMetricsEntry = {
  dimensions: { width: number; height: number };
  card?: TNodeCardMetrics;
};

export type TNodeMetrics = {
  [K in ENodeType]?: TNodeMetricsEntry;
};

export type TNodeDimensions = {
  [K in ENodeType]?: TNodeMetricsEntry["dimensions"];
};

export type TEdgeStyles = {
  [K in EEdgeType]?: { style?: CSSProperties; markerEnd?: EdgeMarkerType };
};

export interface INodeConfig {
  highlights?: THighlightGroups;
  direction?: ResizeControlDirection;
  nodeMetrics?: TNodeMetrics;
  dimensions?: TNodeDimensions;
  edges?: TEdgeStyles;
  nodes: {
    [K in ENodeType]: K extends ENodeType.OPERATOR
      ? { [O in EOperatorType]: OperatorData }
      : K extends ENodeType.INDICATOR
        ? { [I in EIndicatorType]: IndicatorData }
        : NodeDataTypes[K];
  };
}

export interface IBuildNodesAndEdgesProps {
  config: INodeConfig;
  flow?: CompiledStep[];
  defs?: DefDefinitions;
  actionCatalog: ReadonlyMap<string, WorkflowAction>;
  bindingCatalog: WorkflowBindingCatalog;
}

export type NodeDataTypes = {
  [ENodeType.BINDING_SINGLE]: BindingSingleData;
  [ENodeType.BINDING_MULTI]: BindingMultiData;
  [ENodeType.INDICATOR]: IndicatorData;
  [ENodeType.OPERATOR]: OperatorData;
  [ENodeType.TASK]: TaskData;
  [ENodeType.GROUP]: GroupData;
  [ENodeType.BRANCH_PLACEHOLDER]: BranchPlaceholderData;
  [ENodeType.BINDING_PLACEHOLDER]: BindingPlaceholderData;
};

export type NodeType<V, T = NodeDataTypes> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];

export type GraphNode<T extends keyof NodeDataTypes | null = null> =
  T extends keyof NodeDataTypes
    ? Node<NodeDataTypes[T], T>
    :
        | Node<BindingSingleData, ENodeType.BINDING_SINGLE>
        | Node<BindingMultiData, ENodeType.BINDING_MULTI>
        | Node<IndicatorData, ENodeType.INDICATOR>
        | Node<OperatorData, ENodeType.OPERATOR>
        | Node<TaskData, ENodeType.TASK>
        | Node<GroupData, ENodeType.GROUP>
        | Node<BranchPlaceholderData, ENodeType.BRANCH_PLACEHOLDER>
        | Node<BindingPlaceholderData, ENodeType.BINDING_PLACEHOLDER>;

export enum ENodeType {
  BINDING_SINGLE = "bindingSingle",
  BINDING_MULTI = "bindingMulti",
  INDICATOR = "indicator",
  OPERATOR = "operator",
  TASK = "task",
  GROUP = "group",
  BRANCH_PLACEHOLDER = "branchPlaceholder",
  BINDING_PLACEHOLDER = "bindingPlaceholder",
}

export enum EEdgeType {
  EDGE_WITH_BUTTON = "edgeWithButton",
}

export const NODE_TYPES = {
  [ENodeType.BINDING_SINGLE]: memo(BindingSingle),
  [ENodeType.BINDING_MULTI]: memo(BindingMulti),
  [ENodeType.INDICATOR]: memo(Indicator),
  [ENodeType.OPERATOR]: memo(Operator),
  [ENodeType.TASK]: memo(Task),
  [ENodeType.GROUP]: memo(Group),
  [ENodeType.BRANCH_PLACEHOLDER]: memo(BranchPlaceholder),
  [ENodeType.BINDING_PLACEHOLDER]: memo(BindingPlaceholder),
} satisfies NodeTypes;

export const EDGE_TYPES = {
  [EEdgeType.EDGE_WITH_BUTTON]: memo(EdgeWithButton),
} satisfies EdgeTypes;

type FlattenedNodeData<T extends ENodeType = ENodeType> = Omit<
  GraphNode<T>,
  "data"
> &
  GraphNode<T>["data"];

export type IWorkflowNodeContext<T extends ENodeType = ENodeType> = Omit<
  FlattenedNodeData<T>,
  "action"
> &
  Partial<CommonNodeDadaTypes> & {
    action?: WorkflowAction | undefined;
    connections: NodeConnection[];
    resolvedTheme: WorkflowNodeTheme & { Icon: WorkflowIcon };
  };

export interface IWorkflowNodeProps {
  node: NodeProps<GraphNode>;
  children: ReactNode;
}

export type WorkflowGraphData = { nodes: GraphNode[]; edges: Edge[] };

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType } from "@hexabot-ai/agentic";
import { MarkerType, type Node } from "@xyflow/react";
import {
  Brain,
  ChartNoAxesGantt,
  CircleStop,
  GitBranch,
  ListTree,
  Play,
  Plus,
  Repeat,
  Zap,
  type LucideIcon,
} from "lucide-react";

import {
  EEdgeType,
  EIndicatorType,
  ELinkType,
  ENodeType,
  type INodeConfig,
  type TNodeCardMetrics,
  type WorkflowGraphData,
} from "../types/workflow-node.types";
import type { EdgeInsertType } from "../types/workflow-path.types";

const WORKFLOW_OPERATOR_GRAPH_THEME = {
  [StepType.Parallel]: {
    Icon: ListTree,
    nodeTheme: {
      Icon: ListTree,
      borderColor: "#0c9ba0",
    },
    i18nTitle: "message.parallel_indicator",
  },
  [StepType.Conditional]: {
    Icon: GitBranch,
    nodeTheme: {
      Icon: GitBranch,
      borderColor: "#2162fb",
    },
    i18nTitle: "message.conditional_indicator",
  },
  [StepType.Loop]: {
    Icon: Repeat,
    nodeTheme: {
      Icon: Repeat,
      borderColor: "#0c9ba0",
    },
    i18nTitle: "message.loop_indicator",
  },
} as const;

export type WorkflowInsertMenuItem = {
  id: string;
  type: EdgeInsertType;
  Icon: LucideIcon;
  i18nTitle: string;
};

export const WORKFLOW_INSERT_MENU_ITEMS: WorkflowInsertMenuItem[] = [
  {
    id: "step",
    type: "step",
    Icon: ChartNoAxesGantt,
    i18nTitle: "label.step_trace.type_step",
  },
  {
    id: StepType.Conditional,
    type: StepType.Conditional,
    Icon: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Conditional].Icon,
    i18nTitle: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Conditional].i18nTitle,
  },
  {
    id: StepType.Loop,
    type: StepType.Loop,
    Icon: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Loop].Icon,
    i18nTitle: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Loop].i18nTitle,
  },
  {
    id: StepType.Parallel,
    type: StepType.Parallel,
    Icon: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Parallel].Icon,
    i18nTitle: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Parallel].i18nTitle,
  },
];

export const VIEWPORT_EPSILON = 0.01;
export const DEFAULT_WORKFLOW_VIEWPORT = { x: 0, y: 0, zoom: 1 } as const;
export const WORKFLOW_VIEWPORT_MIN_ZOOM = 0.05;
export const WORKFLOW_VIEWPORT_MAX_ZOOM = 4;
export const WORKFLOW_VIEWPORT_AUTO_FIT_MAX_ZOOM = 1;
export const WORKFLOW_VIEWPORT_FIT_PADDING = 0.15;
export const WORKFLOW_VIEWPORT_FOCUS_DURATION = 200;
export const WORKFLOW_LARGE_GRAPH_ELEMENT_THRESHOLD = 250;
export const WORKFLOW_LARGE_GRAPH_MIN_INSERT_ZOOM = 0.55;
export const EMPTY_WORKFLOW_GRAPH: WorkflowGraphData = { nodes: [], edges: [] };

export const DEFAULT_NODE_PROPS = {
  draggable: false,
  focusable: false,
  selectable: false,
} satisfies Omit<Node, "id" | "data" | "position">;

const BASE_CARD_METRICS = {
  paddingX: 16,
  paddingY: 16,
  borderWidth: 2,
  borderRadius: 14,
  titleMinHeight: 20,
  descriptionIndent: 29,
} as const;
const TITLE_ONLY_CARD_METRICS = {
  ...BASE_CARD_METRICS,
  contentVariant: "title-only",
} satisfies TNodeCardMetrics;
const BINDING_CARD_METRICS = {
  ...BASE_CARD_METRICS,
  paddingY: 12,
  contentVariant: "title-with-description",
} satisfies TNodeCardMetrics;
const TITLE_WITH_DESCRIPTION_CARD_METRICS = {
  ...BASE_CARD_METRICS,
  contentVariant: "title-with-description",
} satisfies TNodeCardMetrics;

export const NODE_METRICS: Exclude<INodeConfig["nodeMetrics"], undefined> = {
  [ENodeType.BINDING_SINGLE]: {
    dimensions: { width: 200, height: 76 },
    card: BINDING_CARD_METRICS,
  },
  [ENodeType.BINDING_MULTI]: {
    dimensions: { width: 200, height: 76 },
    card: BINDING_CARD_METRICS,
  },
  [ENodeType.BINDING_PLACEHOLDER]: {
    dimensions: { width: 64, height: 64 },
  },
  [ENodeType.INDICATOR]: {
    dimensions: { width: 128, height: 68 },
    card: TITLE_ONLY_CARD_METRICS,
  },
  [ENodeType.TASK]: {
    dimensions: { width: 256, height: 86 },
    card: TITLE_WITH_DESCRIPTION_CARD_METRICS,
  },
  [ENodeType.OPERATOR]: {
    dimensions: { width: 156, height: 68 },
    card: TITLE_ONLY_CARD_METRICS,
  },
  [ENodeType.BRANCH_PLACEHOLDER]: {
    dimensions: { width: 64, height: 64 },
  },
};

export const NODE_DIMENSIONS = Object.fromEntries(
  Object.entries(NODE_METRICS).map(([nodeType, nodeMetrics]) => [
    nodeType,
    nodeMetrics.dimensions,
  ]),
) as Exclude<INodeConfig["dimensions"], undefined>;

export const OPERATOR_HIGHLIGHTS = {
  [StepType.Loop]: { color: "#faf4d0", padding: 48, radius: "1rem" },
  [StepType.Parallel]: { color: "#faf4d0", padding: 48, radius: "1rem" },
  [StepType.Conditional]: { color: "#faf4d0", padding: 48, radius: "1rem" },
} satisfies INodeConfig["highlights"];

export const EDGE_STYLES = {
  [EEdgeType.EDGE_WITH_BUTTON]: {
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#777",
      strokeWidth: 2,
    },
    style: { stroke: "#777", strokeWidth: "2px" },
  },
} satisfies INodeConfig["edges"];

export const NODE_DEFINITIONS = {
  [ENodeType.BINDING_MULTI]: {
    title: "",
    ports: [ELinkType.BINDING_MULTI_IN],
    theme: {
      Icon: Zap,
      borderColor: "orange",
    },
  },
  [ENodeType.BINDING_PLACEHOLDER]: {
    title: "",
    description: "",
    bindingKind: "",
    ports: [ELinkType.BINDING_PLACEHOLDER_IN],
    theme: {
      Icon: Plus,
      borderColor: "#7f8ea3",
    },
  },
  [ENodeType.BINDING_SINGLE]: {
    title: "",
    ports: [ELinkType.BINDING_SINGLE_IN],
    theme: {
      Icon: Brain,
      borderColor: "#ad46fc",
    },
  },
  [ENodeType.INDICATOR]: {
    [EIndicatorType.WORKFLOW_START]: {
      theme: {
        Icon: Play,
        borderColor: "#37b765",
      },
      ports: [ELinkType.INDICATOR_OUT],
      i18nTitle: "message.start",
    },
    [EIndicatorType.WORKFLOW_END]: {
      theme: {
        Icon: CircleStop,
        borderColor: "#e95d32",
      },
      ports: [ELinkType.INDICATOR_IN],
      i18nTitle: "message.stop",
    },
  },
  [ENodeType.OPERATOR]: {
    [StepType.Parallel]: {
      operatorType: StepType.Parallel,
      theme: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Parallel].nodeTheme,
      i18nTitle: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Parallel].i18nTitle,
      ports: [ELinkType.OPERATOR_IN, ELinkType.OPERATOR_OUT],
    },
    [StepType.Conditional]: {
      operatorType: StepType.Conditional,
      theme: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Conditional].nodeTheme,
      i18nTitle: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Conditional].i18nTitle,
      ports: [ELinkType.OPERATOR_IN, ELinkType.OPERATOR_OUT],
    },
    [StepType.Loop]: {
      operatorType: StepType.Loop,
      theme: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Loop].nodeTheme,
      i18nTitle: WORKFLOW_OPERATOR_GRAPH_THEME[StepType.Loop].i18nTitle,
      ports: [ELinkType.OPERATOR_IN, ELinkType.OPERATOR_OUT],
    },
  },
  [ENodeType.TASK]: {
    title: "",
    actionName: "",
    description: "",
    ports: [ELinkType.TASK_IN, ELinkType.TASK_OUT],
    theme: {},
  },
  [ENodeType.GROUP]: {
    ports: [ELinkType.GROUP_IN, ELinkType.GROUP_OUT],
    theme: {
      bgColor: "#7bb0ff",
    },
  },
  [ENodeType.BRANCH_PLACEHOLDER]: {
    i18nTitle: "button.add",
    ports: [ELinkType.BRANCH_PLACEHOLDER_IN, ELinkType.BRANCH_PLACEHOLDER_OUT],
    theme: {
      Icon: Plus,
      borderColor: "#7f8ea3",
    },
  },
} satisfies INodeConfig["nodes"];

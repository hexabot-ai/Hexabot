/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ActionStatus } from "@hexabot-ai/agentic";
import * as Icons from "lucide-react";
import { createElement, type ComponentProps } from "react";

import type {
  WorkflowAction,
  WorkflowIcon,
  WorkflowNodeTheme,
} from "../types/workflow-node.types";

type WorkflowStateConfig = {
  icon: WorkflowIcon;
  color?: string;
};

type WorkflowThemeInput = {
  baseTheme?: WorkflowNodeTheme;
  action?: WorkflowAction;
  status?: ActionStatus;
  mode?: "light" | "dark" | "system";
};

export type ResolvedWorkflowTheme = WorkflowNodeTheme & { Icon: WorkflowIcon };

// Per color mode: the default text color, and how a node's background is
// tinted from its border color toward the canvas color.
const MODE_PALETTES = {
  light: { textColor: "#51627a", mixTarget: "#ffffff", mixWeight: "95%" },
  dark: { textColor: "#ffffff", mixTarget: "#000000", mixWeight: "85%" },
} as const;
const appendClassName = (className: string | undefined, name: string) => {
  return className ? `${className} ${name}` : name;
};
const WorkflowRunningIcon: WorkflowIcon = ({
  className,
  ...props
}: ComponentProps<typeof Icons.LoaderCircle>) => {
  return createElement(Icons.LoaderCircle, {
    ...props,
    className: appendClassName(className, "workflow-icon-spin"),
  });
};
const WORKFLOW_STATE_ICONS: Partial<Record<ActionStatus, WorkflowIcon>> = {
  running: WorkflowRunningIcon,
  failed: Icons.TriangleAlert,
  suspended: Icons.SquarePause,
  cancelled: Icons.Ban,
};
const WORKFLOW_STATE_COLOR_OVERRIDES: Partial<Record<ActionStatus, string>> = {
  failed: "#FF0000",
  cancelled: "#64748B",
};

export const getWorkflowStateConfig = (
  status?: ActionStatus,
): WorkflowStateConfig | undefined => {
  if (!status) {
    return undefined;
  }

  const icon = WORKFLOW_STATE_ICONS[status];

  if (!icon) {
    return undefined;
  }

  const color = WORKFLOW_STATE_COLOR_OVERRIDES[status];

  return color ? { icon, color } : { icon };
};

const getNamedIcon = (
  iconName: string | undefined,
): WorkflowIcon | undefined =>
  iconName && iconName in Icons
    ? (Icons[iconName as keyof typeof Icons] as WorkflowIcon)
    : undefined;
const resolveThemeIcon = ({
  baseTheme,
  action,
  status,
}: WorkflowThemeInput): WorkflowIcon =>
  getWorkflowStateConfig(status)?.icon ??
  getNamedIcon(baseTheme?.icon ?? action?.icon) ??
  baseTheme?.Icon ??
  Icons.Zap;
const tintBackground = (
  color: string | undefined,
  palette: (typeof MODE_PALETTES)[keyof typeof MODE_PALETTES],
): string | undefined =>
  color
    ? `color-mix(in srgb, ${color}, ${palette.mixTarget} ${palette.mixWeight})`
    : undefined;

/**
 * A step node's visuals: the execution state's icon and color win over the
 * node's own theme, which wins over its action's metadata.
 */
export const resolveWorkflowStepTheme = (
  input: WorkflowThemeInput,
): ResolvedWorkflowTheme => {
  const { baseTheme, action, status, mode } = input;
  const palette = MODE_PALETTES[mode === "dark" ? "dark" : "light"];
  const stateColor = status
    ? WORKFLOW_STATE_COLOR_OVERRIDES[status]
    : undefined;
  const borderColor = stateColor ?? baseTheme?.borderColor ?? action?.color;

  return {
    Icon: resolveThemeIcon(input),
    color: baseTheme?.color ?? palette.textColor,
    bgColor: baseTheme?.bgColor ?? tintBackground(borderColor, palette),
    iconColor: stateColor ?? baseTheme?.iconColor ?? borderColor,
    borderColor,
  };
};

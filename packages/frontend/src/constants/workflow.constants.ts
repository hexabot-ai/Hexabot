/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from "@hexabot-ai/agentic";
import { WorkflowType } from "@hexabot-ai/types";
import {
  Check,
  Clock,
  Hand,
  MessagesSquare,
  Pause,
  Play,
  UserRoundCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import type { TTranslationKeys } from "@/i18n/i18n.types";
import { theme } from "@/layout/theme";

import type { FlowTypeInfo } from "../components/visual-editor/v4/components/main/FlowsDrawer/types";
import { WORKFLOW_STEP_GRAPH_THEME } from "../components/visual-editor/v4/constants/workflow-graph-theme.constants";

export const WORKFLOW_STATUS: Record<EWorkflowRunStatus, FlowTypeInfo> = {
  [EWorkflowRunStatus.FAILED]: {
    key: WorkflowType.conversational,
    icon: X,
    color: theme.palette.error.main,
    labelKey: "label.workflow_run_status.failed",
  },
  [EWorkflowRunStatus.FINISHED]: {
    key: WorkflowType.conversational,
    icon: Check,
    color: theme.palette.success.main,
    labelKey: "label.workflow_run_status.finished",
  },
  [EWorkflowRunStatus.IDLE]: {
    key: WorkflowType.conversational,
    icon: WORKFLOW_STEP_GRAPH_THEME.Icon,
    color: WORKFLOW_STEP_GRAPH_THEME.color,
    labelKey: "label.workflow_run_status.idle",
  },
  [EWorkflowRunStatus.RUNNING]: {
    key: WorkflowType.conversational,
    icon: Play,
    color: theme.palette.success.main,
    labelKey: "label.workflow_run_status.running",
  },
  [EWorkflowRunStatus.SUSPENDED]: {
    key: WorkflowType.conversational,
    icon: Pause,
    color: theme.palette.warning.main,
    labelKey: "label.workflow_run_status.suspended",
  },
};

/** Suspended run that only an admin can resume (approval or resume wait). */
export const WORKFLOW_RUN_AWAITING_OPERATOR_STATUS: FlowTypeInfo = {
  key: WorkflowType.conversational,
  icon: UserRoundCheck,
  color: theme.palette.warning.main,
  labelKey: "label.workflow_run_status.awaiting_operator",
};

type WorkflowTypeInfo = {
  key: WorkflowType;
  labelKey: TTranslationKeys;
  icon: LucideIcon;
  color: string;
};

export const WORKFLOW_TYPES: Record<WorkflowType, WorkflowTypeInfo> = {
  [WorkflowType.conversational]: {
    key: WorkflowType.conversational,
    labelKey: "label.conversational",
    icon: MessagesSquare,
    color: theme.palette.info.main,
  },
  [WorkflowType.scheduled]: {
    key: WorkflowType.scheduled,
    labelKey: "label.scheduled",
    icon: Clock,
    color: theme.palette.warning.main,
  },
  [WorkflowType.manual]: {
    key: WorkflowType.manual,
    labelKey: "label.manual",
    icon: Hand,
    color: theme.palette.success.main,
  },
};

export const WORKFLOW_TYPE_ORDER: Record<WorkflowType, number> = {
  [WorkflowType.conversational]: 0,
  [WorkflowType.scheduled]: 1,
  [WorkflowType.manual]: 2,
};

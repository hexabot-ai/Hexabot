/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { Activity, Play, UserRoundCheck, Webhook, XCircle } from "lucide-react";

import { EntityType, RouterType } from "@/services/types";

import type {
  DashboardKpiId,
  DashboardPermissionChecker,
  DashboardPermissionRequirement,
  DashboardQuickAction,
  DashboardVisibleItem,
} from "../types";

const DASHBOARD_KPI_REQUIREMENTS = {
  totalWorkflows: [
    [EntityType.STATS, Action.READ],
    [EntityType.WORKFLOW, Action.READ],
  ],
  totalRuns: [
    [EntityType.STATS, Action.READ],
    [EntityType.WORKFLOW_RUN, Action.READ],
  ],
  successRate: [
    [EntityType.STATS, Action.READ],
    [EntityType.WORKFLOW_RUN, Action.READ],
  ],
  messages: [
    [EntityType.STATS, Action.READ],
    [EntityType.MESSAGE, Action.READ],
  ],
} satisfies Record<DashboardKpiId, readonly DashboardPermissionRequirement[]>;

export const DASHBOARD_WIDGET_REQUIREMENTS = {
  latestWorkflows: [[EntityType.WORKFLOW, Action.READ]],
  recentRuns: [[EntityType.WORKFLOW_RUN, Action.READ]],
  attentionRequired: [
    [EntityType.STATS, Action.READ],
    [EntityType.WORKFLOW_RUN, Action.READ],
  ],
  pendingApprovals: [[EntityType.WORKFLOW_RUN, Action.READ]],
  threadSnapshot: [
    [EntityType.STATS, Action.READ],
    [EntityType.THREAD, Action.READ],
  ],
  activity: [[EntityType.AUDIT_LOG, Action.READ]],
  upcomingSchedules: [[EntityType.WORKFLOW, Action.READ]],
  integrations: [
    [EntityType.STATS, Action.READ],
    [EntityType.SOURCE, Action.READ],
  ],
} satisfies Record<string, readonly DashboardPermissionRequirement[]>;

const DASHBOARD_QUICK_ACTIONS = [
  {
    id: "create",
    label: "button.create_workflow",
    icon: Activity,
    url: `/${RouterType.WORKFLOW_EDITOR}`,
    requires: [
      [EntityType.WORKFLOW, Action.READ],
      [EntityType.WORKFLOW, Action.CREATE],
    ],
  },
  {
    id: "run",
    label: "button.run_manual_workflow",
    icon: Play,
    url: `/${RouterType.WORKFLOW_EDITOR}`,
    requires: [
      [EntityType.WORKFLOW, Action.READ],
      [EntityType.WORKFLOW, Action.CREATE],
    ],
  },
  {
    id: "connect",
    label: "menu.channels",
    icon: Webhook,
    url: "/settings/sources",
    requires: [
      [EntityType.SOURCE, Action.READ],
      [EntityType.SOURCE, Action.CREATE],
    ],
  },
  {
    id: "approvals",
    label: "button.review_approvals",
    icon: UserRoundCheck,
    url: "/workflow/approvals",
    requires: [[EntityType.WORKFLOW_RUN, Action.READ]],
  },
  {
    id: "failed",
    label: "button.view_failed_runs",
    icon: XCircle,
    url: "/workflow/runs?status=failed",
    requires: [[EntityType.WORKFLOW_RUN, Action.READ]],
  },
] satisfies readonly DashboardQuickAction[];

export const hasDashboardPermissions = (
  requirements: readonly DashboardPermissionRequirement[] | undefined,
  hasPermission: DashboardPermissionChecker,
): boolean =>
  !requirements?.length ||
  requirements.every(([entity, action]) => hasPermission(entity, action));

const isDashboardItemVisible = <T extends DashboardVisibleItem>(
  item: T,
  hasPermission: DashboardPermissionChecker,
): boolean =>
  item.isVisible
    ? item.isVisible(hasPermission)
    : hasDashboardPermissions(item.requires, hasPermission);

export const filterVisibleDashboardItems = <T extends DashboardVisibleItem>(
  items: readonly T[],
  hasPermission: DashboardPermissionChecker,
): T[] => items.filter((item) => isDashboardItemVisible(item, hasPermission));

export const getVisibleDashboardKpis = (
  hasPermission: DashboardPermissionChecker,
): DashboardKpiId[] =>
  (Object.keys(DASHBOARD_KPI_REQUIREMENTS) as DashboardKpiId[]).filter((id) =>
    hasDashboardPermissions(DASHBOARD_KPI_REQUIREMENTS[id], hasPermission),
  );

export const getVisibleQuickActions = (
  hasPermission: DashboardPermissionChecker,
): DashboardQuickAction[] =>
  filterVisibleDashboardItems(DASHBOARD_QUICK_ACTIONS, hasPermission);

export const formatDashboardNumber = (
  value: number | undefined,
  fallback: string,
): string => (typeof value === "number" ? value.toLocaleString() : fallback);

export const formatDashboardSuccessRate = (
  value: number | undefined,
  fallback: string,
): string =>
  typeof value === "number" ? `${(value * 100).toFixed(1)}%` : fallback;

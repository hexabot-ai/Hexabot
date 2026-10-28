/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Grid from "@mui/material/Grid";
import { Home } from "lucide-react";

import { useHasPermission } from "@/hooks/useHasPermission";
import { useTranslate } from "@/hooks/useTranslate";
import { PageHeader } from "@/layout/content/PageHeader";

import { DashboardWidgetState } from "./components/DashboardWidgetState";
import type { DashboardWidgetConfig } from "./types";
import {
  DASHBOARD_WIDGET_REQUIREMENTS,
  filterVisibleDashboardItems,
  getVisibleDashboardKpis,
  hasDashboardPermissions,
  getVisibleQuickActions,
} from "./utils/permissions.util";
import { AttentionRequired } from "./widgets/AttentionRequired";
import { IntegrationsHealth } from "./widgets/IntegrationsHealth";
import { KPICards } from "./widgets/KPICards";
import { LatestWorkflows } from "./widgets/LatestWorkflows";
import { QuickActions } from "./widgets/QuickActions";
import { RecentActivityTimeline } from "./widgets/RecentActivityTimeline";
import { RecentRuns } from "./widgets/RecentRuns";
import { ThreadSnapshot } from "./widgets/ThreadSnapshot";
import { UpcomingScheduleTimeline } from "./widgets/UpcomingScheduleTimeline";

const DASHBOARD_WIDGETS = [
  {
    id: "kpis",
    Component: KPICards,
    area: "full",
    size: { xs: 12 },
    isVisible: (hasPermission) =>
      getVisibleDashboardKpis(hasPermission).length > 0,
  },
  {
    id: "quick-actions",
    Component: QuickActions,
    area: "full",
    size: { xs: 12 },
    isVisible: (hasPermission) =>
      getVisibleQuickActions(hasPermission).length > 0,
  },
  {
    id: "latest-workflows",
    Component: LatestWorkflows,
    area: "main",
    size: { xs: 12 },
    requires: DASHBOARD_WIDGET_REQUIREMENTS.latestWorkflows,
  },
  {
    id: "attention-required",
    Component: AttentionRequired,
    area: "side",
    size: { xs: 12 },
    isVisible: (hasPermission) =>
      hasDashboardPermissions(
        DASHBOARD_WIDGET_REQUIREMENTS.pendingApprovals,
        hasPermission,
      ) ||
      hasDashboardPermissions(
        DASHBOARD_WIDGET_REQUIREMENTS.attentionRequired,
        hasPermission,
      ),
  },
  {
    id: "recent-runs",
    Component: RecentRuns,
    area: "main",
    size: { xs: 12 },
    requires: DASHBOARD_WIDGET_REQUIREMENTS.recentRuns,
  },
  {
    id: "upcoming-schedules",
    Component: UpcomingScheduleTimeline,
    area: "side",
    size: { xs: 12 },
    requires: DASHBOARD_WIDGET_REQUIREMENTS.upcomingSchedules,
  },
  {
    id: "thread-snapshot",
    Component: ThreadSnapshot,
    area: "main",
    size: { xs: 12, md: 6 },
    requires: DASHBOARD_WIDGET_REQUIREMENTS.threadSnapshot,
  },
  {
    id: "recent-activity",
    Component: RecentActivityTimeline,
    area: "main",
    size: { xs: 12, md: 6 },
    requires: DASHBOARD_WIDGET_REQUIREMENTS.activity,
  },
  {
    id: "integrations-health",
    Component: IntegrationsHealth,
    area: "side",
    size: { xs: 12 },
    requires: DASHBOARD_WIDGET_REQUIREMENTS.integrations,
  },
] satisfies DashboardWidgetConfig[];

export const Dashboard = () => {
  const { t } = useTranslate();
  const hasPermission = useHasPermission();
  const visibleWidgets = filterVisibleDashboardItems(
    DASHBOARD_WIDGETS,
    hasPermission,
  );
  const fullWidthWidgets = visibleWidgets.filter(({ area }) => area === "full");
  const mainWidgets = visibleWidgets.filter(({ area }) => area === "main");
  const sideWidgets = visibleWidgets.filter(({ area }) => area === "side");
  const hasMainWidgets = mainWidgets.length > 0;
  const hasSideWidgets = sideWidgets.length > 0;

  return (
    <Grid container gap={3} flexDirection="column">
      <PageHeader icon={Home} title={t("title.dashboard")} />
      <Grid size={12} container spacing={3} alignItems="flex-start">
        {visibleWidgets.length ? (
          <>
            {fullWidthWidgets.map(({ Component, id, size }) => (
              <Grid key={id} size={size}>
                <Component />
              </Grid>
            ))}
            {hasMainWidgets || hasSideWidgets ? (
              <Grid size={12} container spacing={3} alignItems="flex-start">
                {hasMainWidgets ? (
                  <Grid
                    size={{ xs: 12, md: hasSideWidgets ? 8 : 12 }}
                    container
                    spacing={3}
                    alignItems="flex-start"
                  >
                    {mainWidgets.map(({ Component, id, size }) => (
                      <Grid key={id} size={size}>
                        <Component />
                      </Grid>
                    ))}
                  </Grid>
                ) : null}
                {hasSideWidgets ? (
                  <Grid
                    size={{ xs: 12, md: hasMainWidgets ? 4 : 12 }}
                    container
                    spacing={3}
                    flexDirection="column"
                  >
                    {sideWidgets.map(({ Component, id }) => (
                      <Grid key={id} size={12}>
                        <Component />
                      </Grid>
                    ))}
                  </Grid>
                ) : null}
              </Grid>
            ) : null}
          </>
        ) : (
          <Grid size={12}>
            <DashboardWidgetState
              title={t("dashboard.empty.title")}
              description={t("dashboard.empty.description")}
            />
          </Grid>
        )}
      </Grid>
    </Grid>
  );
};

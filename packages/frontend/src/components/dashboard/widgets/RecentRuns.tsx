/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow, WorkflowRun } from "@hexabot-ai/types";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { ArrowRight, ListChecks } from "lucide-react";

import { WorkflowBadgeWithTitle } from "@/app-components/workflow/WorkflowBadgeWithTitle";
import { WorkflowRunStatusBadge } from "@/app-components/workflow/WorkflowRunStatusBadge";
import { useFind } from "@/hooks/crud/useFind";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import { formatDurationMs, formatSmartDate } from "@/utils/date";

import { DashboardWidgetState } from "../components/DashboardWidgetState";
import { TitleWithActions } from "../components/TitleWithActions";

const RECENT_RUN_LIMIT = 5;
const resolveEntityId = (
  value?: string | { id?: string } | null,
): string | undefined => {
  if (!value) return undefined;

  return typeof value === "string" ? value : value.id;
};

export const RecentRuns = () => {
  const router = useAppRouter();
  const { i18n, t } = useTranslate();
  const getWorkflowFromCache = useGetFromCache(EntityType.WORKFLOW);
  const {
    data: workflowRuns,
    isError,
    isLoading,
  } = useFind(
    { entity: EntityType.WORKFLOW_RUN, format: Format.FULL },
    {
      hasCount: false,
      initialSortState: [{ field: "createdAt", sort: "desc" }],
      initialPaginationState: {
        page: 0,
        pageSize: RECENT_RUN_LIMIT,
      },
    },
  );
  const openRun = (run: WorkflowRun) => {
    const workflowId = resolveEntityId(run.workflow);
    const initiatorId = resolveEntityId(run.triggeredBy);
    const runId = resolveEntityId(run.id);

    if (workflowId && initiatorId && runId) {
      router.push(`/workflow/${workflowId}/runs/${initiatorId}/${runId}`);
    }
  };
  const resolveWorkflow = (run: WorkflowRun): Workflow | null => {
    if (run.workflow && typeof run.workflow !== "string") {
      return run.workflow as Workflow;
    }

    const workflowId = resolveEntityId(run.workflow);

    return workflowId
      ? ((getWorkflowFromCache(workflowId) as Workflow | undefined) ?? null)
      : null;
  };

  return (
    <Box>
      <TitleWithActions
        title={t("title.recent_runs")}
        actions={
          <Button
            size="small"
            variant="text"
            onClick={() => router.push("/workflow/runs")}
          >
            {t("button.view_all")}
          </Button>
        }
      />
      {isLoading ? (
        <DashboardWidgetState
          loading
          title={t("message.loading_runs")}
          description={t("dashboard.recent_runs_state.loading_description")}
        />
      ) : isError ? (
        <DashboardWidgetState
          tone="error"
          title={t("dashboard.recent_runs_state.error_title")}
          description={t("dashboard.recent_runs_state.error_description")}
        />
      ) : workflowRuns.length ? (
        <Stack gap={1}>
          {workflowRuns.map((run) => {
            const workflow = resolveWorkflow(run);
            const workflowId = resolveEntityId(run.workflow);
            const initiatorId = resolveEntityId(run.triggeredBy);
            const canView = Boolean(workflowId && initiatorId);

            return (
              <Paper
                key={run.id}
                elevation={0}
                sx={{
                  p: 1.5,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  gap={1.5}
                  alignItems={{ xs: "flex-start", sm: "center" }}
                >
                  <Box minWidth={0} flex={1}>
                    {workflow ? (
                      <WorkflowBadgeWithTitle workflow={workflow} />
                    ) : (
                      <Typography variant="subtitle2" fontWeight={700}>
                        {t("label.unknown")}
                      </Typography>
                    )}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      mt={0.5}
                    >
                      {formatSmartDate(run.createdAt, i18n.language)}
                      {" · "}
                      {formatDurationMs(run.duration)}
                    </Typography>
                  </Box>
                  <WorkflowRunStatusBadge workflowRun={run} />
                  <Button
                    size="small"
                    variant="outlined"
                    endIcon={<ArrowRight size={16} />}
                    disabled={!canView}
                    onClick={() => openRun(run)}
                  >
                    {t("button.view")}
                  </Button>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      ) : (
        <DashboardWidgetState
          icon={ListChecks}
          title={t("message.no_runs_found")}
          description={t("dashboard.recent_runs_state.empty_description")}
          action={
            <Button
              size="small"
              variant="outlined"
              onClick={() => router.push("/workflow/runs")}
            >
              {t("button.view_all")}
            </Button>
          }
        />
      )}
    </Box>
  );
};

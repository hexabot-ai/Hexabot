/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowRunFull } from "@hexabot-ai/types";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CheckCircle, XCircle } from "lucide-react";

import { useApiClientQuery } from "@/hooks/useApiClient";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useTranslate } from "@/hooks/useTranslate";
import { formatSmartDate } from "@/utils/date";

import { DashboardWidgetState } from "../components/DashboardWidgetState";
import { IconContainer } from "../components/IconContainer";
import { TitleWithActions } from "../components/TitleWithActions";

const FAILED_RUN_LIMIT = 3;
const resolveEntityId = (
  value?: string | { id?: string } | null,
): string | undefined => {
  if (!value) return undefined;

  return typeof value === "string" ? value : value.id;
};

export const AttentionRequired = () => {
  const theme = useTheme();
  const router = useAppRouter();
  const { i18n, t } = useTranslate();
  const { data, isError, isLoading } = useApiClientQuery(
    "getFailedWorkflowRunsLast24h",
    {
      params: [FAILED_RUN_LIMIT],
      refetchInterval: 60000,
    },
  );
  const failedRuns = data?.runs ?? [];
  const total = data?.total ?? 0;
  const hasOverflow = total > failedRuns.length;
  const countLabel = isLoading || isError ? t("dashboard.kpi.loading") : total;
  const handleViewRun = (run: WorkflowRunFull) => {
    const workflowId = resolveEntityId(run.workflow);
    const initiatorId = resolveEntityId(run.triggeredBy);
    const runId = resolveEntityId(run.id);

    if (!workflowId || !initiatorId) {
      return;
    }

    router.push(`/workflow/${workflowId}/runs/${initiatorId}/${runId}`);
  };

  return (
    <Box>
      <TitleWithActions
        title={t("dashboard.attention.title")}
        actions={
          <Stack direction="row" alignItems="center" gap={1}>
            {hasOverflow ? (
              <Button
                size="small"
                variant="text"
                onClick={() => router.push("/workflow/runs?status=failed")}
              >
                {t("dashboard.attention.view_more", {
                  0: total - failedRuns.length,
                })}
              </Button>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              {t("dashboard.attention.range")}
            </Typography>
            <Chip
              label={countLabel}
              color={total > 0 ? "error" : isError ? "default" : "success"}
              size="small"
            />
          </Stack>
        }
      />
      <Stack gap={1.5} mt={1}>
        {isLoading ? (
          <DashboardWidgetState
            loading
            title={t("dashboard.attention.loading")}
            description={t("dashboard.attention.loading_description")}
          />
        ) : isError ? (
          <DashboardWidgetState
            tone="error"
            title={t("dashboard.attention.error")}
            description={t("dashboard.attention.error_description")}
          />
        ) : failedRuns.length > 0 ? (
          failedRuns.map((run) => {
            const workflowName =
              typeof run.workflow === "string"
                ? run.workflow
                : run.workflow?.name || t("label.unknown");
            const failedAt = run.failedAt
              ? formatSmartDate(run.failedAt, i18n.language)
              : t("dashboard.attention.failed_at_unknown");
            const error =
              run.error || t("dashboard.attention.no_error_details");
            const canView = Boolean(
              resolveEntityId(run.workflow) && resolveEntityId(run.triggeredBy),
            );

            return (
              <Paper
                key={run.id}
                elevation={0}
                sx={{
                  p: 2,
                  borderRadius: 3,
                  bgcolor: alpha(theme.palette.error.main, 0.05),
                  border: `1px solid ${alpha(theme.palette.error.main, 0.12)}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  transition: "transform 0.2s, background-color 0.2s",
                  "&:hover": {
                    transform: "translateX(4px)",
                    bgcolor: alpha(theme.palette.error.main, 0.08),
                  },
                }}
              >
                <IconContainer
                  icon={XCircle}
                  color={theme.palette.error.main}
                  borderRadius="16px"
                  size={20}
                />
                <Box minWidth={0} flex={1}>
                  <Typography variant="subtitle2" fontWeight="bold" noWrap>
                    {t("dashboard.attention.failed_run_title", {
                      0: workflowName,
                    })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {error}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {failedAt}
                  </Typography>
                </Box>

                <Button
                  size="small"
                  variant="outlined"
                  disabled={!canView}
                  onClick={() => handleViewRun(run)}
                  sx={{
                    flexShrink: 0,
                    borderColor: alpha(theme.palette.error.main, 0.3),
                    color: theme.palette.error.main,
                    "&:hover": {
                      borderColor: theme.palette.error.main,
                      bgcolor: alpha(theme.palette.error.main, 0.05),
                    },
                  }}
                >
                  {t("button.view")}
                </Button>
              </Paper>
            );
          })
        ) : (
          <DashboardWidgetState
            tone="success"
            icon={CheckCircle}
            title={t("dashboard.attention.empty_title")}
            description={t("dashboard.attention.empty_description")}
          />
        )}
      </Stack>
    </Box>
  );
};

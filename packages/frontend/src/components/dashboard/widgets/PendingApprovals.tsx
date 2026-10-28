/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CheckCircle, UserRoundCheck } from "lucide-react";

import { usePendingApprovalsCount } from "@/components/workflow-approvals/PendingApprovalsBadge";
import { useOperatorDialogs } from "@/components/workflow-run-debugger/hooks/useOperatorDialogs";
import {
  describeOperatorWait,
  getOperatorWaits,
} from "@/components/workflow-run-debugger/operator.utils";
import { resolveEntityId } from "@/components/workflow-run-debugger/utils";
import { useFind } from "@/hooks/crud/useFind";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import { formatSmartDate } from "@/utils/date";

import { DashboardWidgetState } from "../components/DashboardWidgetState";
import { IconContainer } from "../components/IconContainer";
import { TitleWithActions } from "../components/TitleWithActions";

const PENDING_RUN_LIMIT = 3;

/**
 * Latest runs waiting on an admin, each with a button opening the dialog
 * that resolves its first request.
 */
export const PendingApprovals = () => {
  const theme = useTheme();
  const router = useAppRouter();
  const { i18n, t } = useTranslate();
  const { openForWait } = useOperatorDialogs();
  const getWorkflowFromCache = useGetFromCache(EntityType.WORKFLOW);
  const total = usePendingApprovalsCount();
  const {
    data: runs,
    isLoading,
    isError,
  } = useFind(
    { entity: EntityType.WORKFLOW_RUN_PENDING, format: Format.FULL },
    {
      hasCount: false,
      initialPaginationState: { page: 0, pageSize: PENDING_RUN_LIMIT },
      initialSortState: [{ field: "suspendedAt", sort: "desc" }],
    },
  );
  const hasOverflow = total > runs.length;

  return (
    <Box>
      <TitleWithActions
        title={t("dashboard.attention.waiting_title")}
        actions={
          <Stack direction="row" alignItems="center" gap={1}>
            {hasOverflow ? (
              <Button
                size="small"
                variant="text"
                onClick={() => router.push("/workflow/approvals")}
              >
                {t("dashboard.attention.view_all_approvals")}
              </Button>
            ) : null}
            <Chip
              label={total}
              color={total > 0 ? "warning" : "success"}
              size="small"
            />
          </Stack>
        }
      />
      <Stack gap={1.5} mt={1}>
        {isLoading ? (
          <DashboardWidgetState
            loading
            title={t("dashboard.attention.waiting_loading")}
          />
        ) : isError ? (
          <DashboardWidgetState
            tone="error"
            title={t("dashboard.attention.waiting_error")}
            description={t("dashboard.attention.error_description")}
          />
        ) : runs.length > 0 ? (
          runs.map((run) => {
            const [wait] = getOperatorWaits(run);
            const workflowId = resolveEntityId(run.workflow);
            const workflowName =
              (workflowId && getWorkflowFromCache(workflowId)?.name) ||
              t("label.unknown");
            const message =
              (wait && describeOperatorWait(wait)?.message) ||
              t("message.operator_wait_no_message");

            return (
              <Paper
                key={run.id}
                elevation={0}
                sx={{
                  p: 2,
                  borderRadius: 3,
                  bgcolor: alpha(theme.palette.warning.main, 0.05),
                  border: `1px solid ${alpha(theme.palette.warning.main, 0.16)}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <IconContainer
                  icon={UserRoundCheck}
                  color={theme.palette.warning.main}
                  borderRadius="16px"
                  size={20}
                />
                <Box minWidth={0} flex={1}>
                  <Typography variant="subtitle2" fontWeight="bold" noWrap>
                    {workflowName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {message}
                  </Typography>
                  {run.suspendedAt ? (
                    <Typography variant="caption" color="text.disabled">
                      {formatSmartDate(
                        new Date(run.suspendedAt),
                        i18n.language,
                      )}
                    </Typography>
                  ) : null}
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  disabled={!wait}
                  onClick={() => wait && void openForWait(run, wait)}
                  sx={{ flexShrink: 0 }}
                >
                  {t("button.review")}
                </Button>
              </Paper>
            );
          })
        ) : (
          <DashboardWidgetState
            tone="success"
            icon={CheckCircle}
            title={t("dashboard.attention.waiting_empty")}
          />
        )}
      </Stack>
    </Box>
  );
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ActionStatus } from "@hexabot-ai/agentic";
import { Box, Tooltip } from "@mui/material";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Circle,
  Ban,
  Loader2,
  PauseCircle,
  SkipForward,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

import { useTranslate } from "@/hooks/useTranslate";

type StatusIndicator = {
  Icon: LucideIcon;
  color: string;
  label: string;
};

type ActionStatusIndicatorProps = {
  status: ActionStatus;
  size?: number;
};

export type StatusLabels = Record<ActionStatus, string>;

const getStatusIndicator = (
  status: ActionStatus,
  labels: StatusLabels,
): StatusIndicator => {
  switch (status) {
    case "completed":
      return {
        Icon: CheckCircle2,
        color: "success.main",
        label: labels.completed,
      };
    case "running":
      return { Icon: Loader2, color: "info.main", label: labels.running };
    case "failed":
      return { Icon: XCircle, color: "error.main", label: labels.failed };
    case "skipped":
      return {
        Icon: SkipForward,
        color: "text.secondary",
        label: labels.skipped,
      };
    case "suspended":
      return {
        Icon: PauseCircle,
        color: "warning.main",
        label: labels.suspended,
      };
    case "cancelled":
      return {
        Icon: Ban,
        color: "text.secondary",
        label: labels.cancelled,
      };
    default:
      return { Icon: Circle, color: "text.secondary", label: labels.pending };
  }
};

export const useActionStatusLabels = (): StatusLabels => {
  const { t } = useTranslate();

  return useMemo(
    () => ({
      completed: t("label.step_trace.status_completed"),
      running: t("label.step_trace.status_running"),
      failed: t("label.step_trace.status_failed"),
      skipped: t("label.step_trace.status_skipped"),
      suspended: t("label.step_trace.status_suspended"),
      cancelled: t("label.step_trace.status_cancelled"),
      pending: t("label.step_trace.status_pending"),
    }),
    [t],
  );
};

export const ActionStatusIndicator = ({
  status,
  size = 16,
}: ActionStatusIndicatorProps) => {
  const statusLabels = useActionStatusLabels();
  const statusConfig = getStatusIndicator(status, statusLabels);

  return (
    <Tooltip title={statusConfig.label}>
      <Box
        component="span"
        display="inline-flex"
        sx={{ color: statusConfig.color }}
      >
        <statusConfig.Icon size={size} />
      </Box>
    </Tooltip>
  );
};

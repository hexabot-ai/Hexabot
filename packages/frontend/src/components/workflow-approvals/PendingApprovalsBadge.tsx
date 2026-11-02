/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { Box, Chip } from "@mui/material";

import { useCount } from "@/hooks/crud/useCount";
import { useHasPermission } from "@/hooks/useHasPermission";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

export type PendingApprovalsBadgeProps = {
  /** `count` next to a label, `dot` over an icon. */
  variant?: "count" | "dot";
};

const MAX_DISPLAYED_COUNT = 99;

/**
 * Count of the runs waiting on an admin, kept live by
 * `usePendingWorkflowRunsSync`. Renders nothing when none waits.
 */
export const usePendingApprovalsCount = () => {
  const hasPermission = useHasPermission();
  const canRead = hasPermission(EntityType.WORKFLOW_RUN, Action.READ);
  const { data } = useCount(EntityType.WORKFLOW_RUN_PENDING, undefined, {
    enabled: canRead,
  });

  return canRead ? (data?.count ?? 0) : 0;
};

export const PendingApprovalsBadge = ({
  variant = "count",
}: PendingApprovalsBadgeProps) => {
  const { t } = useTranslate();
  const count = usePendingApprovalsCount();

  if (count === 0) {
    return null;
  }

  const label = t("label.pending_approvals_count", { 0: String(count) });

  if (variant === "dot") {
    return (
      <Box
        component="span"
        role="status"
        aria-label={label}
        sx={{
          // Top-right corner of the sidebar icon (18px wide)
          position: "absolute",
          top: -4,
          right: -6,
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: "warning.main",
          boxShadow: (theme) => `0 0 0 2px ${theme.palette.background.paper}`,
        }}
      />
    );
  }

  return (
    <Chip
      size="small"
      color="warning"
      aria-label={label}
      label={count > MAX_DISPLAYED_COUNT ? `${MAX_DISPLAYED_COUNT}+` : count}
      sx={{ height: 20, minWidth: 24, fontWeight: 600, ml: 1 }}
    />
  );
};

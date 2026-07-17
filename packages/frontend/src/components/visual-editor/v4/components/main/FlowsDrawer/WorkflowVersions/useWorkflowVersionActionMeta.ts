/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowVersionAction } from "@hexabot-ai/types";
import type { ChipProps } from "@mui/material";
import { useTheme } from "@mui/material";
import { useCallback } from "react";

import { useTranslate } from "@/hooks/useTranslate";

export const useWorkflowVersionActionMeta = () => {
  const theme = useTheme();
  const { t } = useTranslate();

  return useCallback(
    (action?: WorkflowVersionAction | null) => {
      const fallback = {
        label: t("visual_editor.workflow_versions.actions.unknown"),
        color: theme.palette.text.secondary,
        chipColor: "default" as ChipProps["color"],
      };

      switch (action) {
        case WorkflowVersionAction.create:
          return {
            label: t("visual_editor.workflow_versions.actions.create"),
            color: theme.palette.success.main,
            chipColor: "success" as ChipProps["color"],
          };
        case WorkflowVersionAction.update:
          return {
            label: t("visual_editor.workflow_versions.actions.update"),
            color: theme.palette.info.main,
            chipColor: "info" as ChipProps["color"],
          };
        case WorkflowVersionAction.restore:
          return {
            label: t("visual_editor.workflow_versions.actions.restore"),
            color: theme.palette.warning.main,
            chipColor: "warning" as ChipProps["color"],
          };
        case WorkflowVersionAction.import:
          return {
            label: t("visual_editor.workflow_versions.actions.import"),
            color: theme.palette.secondary.main,
            chipColor: "secondary" as ChipProps["color"],
          };
        default:
          return fallback;
      }
    },
    [t, theme],
  );
};

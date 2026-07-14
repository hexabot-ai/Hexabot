/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";
import { Box, Tooltip, Typography } from "@mui/material";
import type { MouseEvent } from "react";

import { useGetFromCache } from "@/hooks/crud/useGet";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import { formatSmartDate, normalizeDate } from "@/utils/date";

import { WorkflowTypeBadge } from "../../../../../../app-components/workflow/WorkflowTypeBadge";
import { WorkflowActionButtons } from "../WorkflowActionButtons";

import { TitleBarCard } from "./TitleBarCard";
import { WorkflowMetaInfo } from "./WorkflowMetaInfo";
import { WorkflowSaveButton } from "./WorkflowSaveButton";
import { WorkflowSettingsButton } from "./WorkflowSettingsButton";
import { WorkflowUndoRedoButtons } from "./WorkflowUndoRedoButtons";

type WorkflowTitleBarProps = {
  workflow: Workflow;
  onEdit?: (workflow: Workflow) => void;
  onOpenMenu: (event: MouseEvent<HTMLElement>, flowId: string) => void;
  onOpenSettings?: () => void;
  settingsLabel: string;
  settingsDisabled?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  undoLabel: string;
  redoLabel: string;
  undoDisabled?: boolean;
  redoDisabled?: boolean;
  onSave?: () => void;
  saveLabel: string;
  saveDisabled?: boolean;
  saveLoading?: boolean;
  renameLabel: string;
  moreLabel: string;
};

export const WorkflowTitleBar = ({
  workflow,
  onEdit,
  onOpenMenu,
  onOpenSettings,
  settingsLabel,
  settingsDisabled = false,
  onUndo,
  onRedo,
  undoLabel,
  redoLabel,
  undoDisabled = false,
  redoDisabled = false,
  onSave,
  saveLabel,
  saveDisabled = false,
  saveLoading = false,
  renameLabel,
  moreLabel,
}: WorkflowTitleBarProps) => {
  const { t, i18n } = useTranslate();
  const getVersionFromCache = useGetFromCache(EntityType.WORKFLOW_VERSION);
  const isDraft = !workflow.publishedVersion;
  const statusLabel = isDraft
    ? t("visual_editor.flows_drawer.status.draft")
    : t("visual_editor.flows_drawer.status.published");
  const currentVersion = workflow.currentVersion
    ? getVersionFromCache(workflow.currentVersion)
    : undefined;
  const lastSavedAt =
    currentVersion?.updatedAt ??
    currentVersion?.createdAt ??
    workflow.updatedAt ??
    workflow.createdAt;
  const lastSavedText = lastSavedAt
    ? formatSmartDate(lastSavedAt, i18n.language)
    : t("message.no_data_to_display");
  const lastSavedLabel = t("visual_editor.workflow_title_bar.last_saved", {
    0: lastSavedText,
  });
  const lastSavedExact = lastSavedAt
    ? normalizeDate(i18n.language, lastSavedAt)
    : undefined;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "stretch",
        gap: 1,
        minWidth: 0,
      }}
    >
      <TitleBarCard
        sx={{
          gap: 1,
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            flex: 1,
          }}
        >
          <WorkflowTypeBadge
            workflow={workflow}
            width="32px"
            height="32px"
            padding="4px"
          />
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 0.25,
              minWidth: 0,
              flex: 1,
            }}
          >
            <Tooltip title={workflow.name} arrow>
              <Typography
                variant="subtitle1"
                noWrap
                sx={{
                  maxWidth: 320,
                  fontWeight: 600,
                }}
              >
                {workflow.name}
              </Typography>
            </Tooltip>
          </Box>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
          }}
        >
          <WorkflowActionButtons
            workflow={workflow}
            onEdit={onEdit}
            onOpenMenu={onOpenMenu}
            renameLabel={renameLabel}
            moreLabel={moreLabel}
          />
        </Box>
      </TitleBarCard>

      <WorkflowUndoRedoButtons
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        onUndo={onUndo}
        onRedo={onRedo}
        undoDisabled={undoDisabled}
        redoDisabled={redoDisabled}
      />

      <WorkflowSaveButton
        label={saveLabel}
        onSave={onSave}
        loading={saveLoading}
        disabled={saveDisabled}
      />

      <WorkflowSettingsButton
        label={settingsLabel}
        disabled={settingsDisabled}
        onOpen={onOpenSettings}
      />

      <WorkflowMetaInfo
        isDraft={isDraft}
        statusLabel={statusLabel}
        workflowVersion={currentVersion ?? null}
        lastSavedLabel={lastSavedLabel}
        lastSavedExact={lastSavedExact}
      />
    </Box>
  );
};

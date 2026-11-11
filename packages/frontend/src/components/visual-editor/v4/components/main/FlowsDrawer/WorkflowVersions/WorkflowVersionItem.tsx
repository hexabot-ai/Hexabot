/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowVersion } from "@hexabot-ai/types";
import {
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
  TimelineSeparator,
} from "@mui/lab";
import { Paper } from "@mui/material";

import { useTranslate } from "@/hooks/useTranslate";
import { formatSmartDate, normalizeDate } from "@/utils/date";

import { useWorkflowVersionActionMeta } from "./useWorkflowVersionActionMeta";
import { WorkflowVersionMetaRow } from "./WorkflowVersionMetaRow";

export type WorkflowVersionItemProps = {
  version: WorkflowVersion;
  index: number;
  total: number;
  currentVersionId?: string | null;
  publishedVersionId?: string | null;
  isSaving: boolean;
  onRestore: (id: string, definitionYml: string) => void;
  onPublish: (id: string) => void;
  onUnpublish: () => void;
  onUpdateMessage: (id: string, message: string) => void;
  getUserLabel: (createdBy: string | null) => string;
  language: string;
};

export const WorkflowVersionItem = ({
  version,
  index,
  total,
  currentVersionId,
  publishedVersionId,
  isSaving,
  onRestore,
  onPublish,
  onUnpublish,
  onUpdateMessage,
  getUserLabel,
  language,
}: WorkflowVersionItemProps) => {
  const { t } = useTranslate();
  const getActionMeta = useWorkflowVersionActionMeta();
  const actionMeta = getActionMeta(version.action);
  const isCurrent = currentVersionId === version.id;
  const createdAt = version.createdAt ? new Date(version.createdAt) : null;
  const timeLabel = createdAt
    ? formatSmartDate(createdAt, language)
    : t("message.no_data_to_display");
  const exactDate = createdAt ? normalizeDate(language, createdAt) : undefined;
  const createdByLabel = getUserLabel(version.createdBy);
  const canRestore = !isCurrent && Boolean(version.definitionYml);
  const isPublished = version.id === publishedVersionId;
  const canPublish = Boolean(version.definitionYml) && !isPublished;
  const canUnpublish = isPublished;

  return (
    <TimelineItem
      sx={{
        minHeight: "auto",
        "&::before": {
          flex: 0.35,
          px: 0,
          py: 0.7,
        },
      }}
    >
      <TimelineSeparator>
        <TimelineDot
          variant={isCurrent ? "filled" : "outlined"}
          sx={{
            borderColor: actionMeta.color,
            bgcolor: isCurrent ? actionMeta.color : "background.paper",
            color: isCurrent ? "common.white" : actionMeta.color,
            boxShadow: isCurrent ? "none" : undefined,
          }}
        />
        {index < total - 1 && <TimelineConnector sx={{ bgcolor: "divider" }} />}
      </TimelineSeparator>
      <TimelineContent sx={{ pt: 1, pb: 1, pr: 1, minWidth: 0 }}>
        <Paper
          variant="spaced"
          sx={(theme) => ({
            "&:hover .workflow-version-actions, &:focus-within .workflow-version-actions":
              {
                opacity: 1,
                pointerEvents: "auto",
                maxHeight: 40,
                mt: 0.75,
                pt: 0.75,
                borderTopColor: theme.palette.divider,
              },
          })}
        >
          <WorkflowVersionMetaRow
            versionNumber={version.version}
            timeLabel={timeLabel}
            exactDate={exactDate}
            actionMeta={actionMeta}
            isCurrent={isCurrent}
            isPublished={isPublished}
            createdByLabel={createdByLabel}
            message={version.message}
            canRestore={canRestore}
            canPublish={canPublish}
            canUnpublish={canUnpublish}
            isSaving={isSaving}
            onRestore={() => {
              if (version.definitionYml) {
                onRestore(version.id, version.definitionYml);
              }
            }}
            onPublish={() => {
              onPublish(version.id);
            }}
            onUnpublish={onUnpublish}
            onUpdateMessage={(nextMessage) => {
              onUpdateMessage(version.id, nextMessage);
            }}
          />
        </Paper>
      </TimelineContent>
    </TimelineItem>
  );
};

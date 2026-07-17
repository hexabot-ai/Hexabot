/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ChipProps } from "@mui/material";
import { Button, Chip, Stack, Typography, useTheme } from "@mui/material";
import { CloudOff, CloudUpload, Pencil, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EditableTypography } from "@/app-components/inputs/EditableTypography";
import { useTranslate } from "@/hooks/useTranslate";

type WorkflowVersionMetaRowProps = {
  versionNumber: number;
  timeLabel: string;
  exactDate?: string;
  actionMeta: { label: string; color: string; chipColor: ChipProps["color"] };
  isCurrent: boolean;
  isPublished: boolean;
  createdByLabel: string;
  message?: string | null;
  canRestore: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
  isSaving: boolean;
  onRestore: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onUpdateMessage: (nextMessage: string) => void;
};

export const WorkflowVersionMetaRow = ({
  versionNumber,
  timeLabel,
  exactDate,
  actionMeta,
  isCurrent,
  isPublished,
  createdByLabel,
  message,
  canRestore,
  canPublish,
  canUnpublish,
  isSaving,
  onRestore,
  onPublish,
  onUnpublish,
  onUpdateMessage,
}: WorkflowVersionMetaRowProps) => {
  const { t } = useTranslate();
  const theme = useTheme();
  const iconSize = theme.typography.pxToRem(14);
  const editableMessageRef = useRef<HTMLElement | null>(null);
  const [messageValue, setMessageValue] = useState((message ?? "").trim());
  const [isAddingNote, setIsAddingNote] = useState(false);
  const versionLabel = useMemo(
    () =>
      t("visual_editor.workflow_versions.version", {
        0: versionNumber,
      }),
    [t, versionNumber],
  );

  useEffect(() => {
    setMessageValue((message ?? "").trim());
  }, [message]);

  useEffect(() => {
    if (!isAddingNote) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      editableMessageRef.current?.click();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isAddingNote]);

  const handleCommitMessage = useCallback(
    (nextMessage: string) => {
      const normalizedMessage = nextMessage.trim();
      const previousMessage = messageValue.trim();

      setMessageValue(normalizedMessage);
      setIsAddingNote(false);

      if (normalizedMessage === previousMessage) {
        return;
      }

      onUpdateMessage(normalizedMessage);
    },
    [messageValue, onUpdateMessage],
  );
  const handleCancelMessage = useCallback(() => {
    const previousMessage = (message ?? "").trim();

    setMessageValue(previousMessage);

    if (!previousMessage) {
      setIsAddingNote(false);
    }
  }, [message]);
  const hasActions = canRestore || canPublish || canUnpublish;
  const trimmedMessage = messageValue.trim();
  const hasMessage = Boolean(trimmedMessage);
  const showEditableMessage = hasMessage || isAddingNote;
  const hasFooterActions = hasActions || (!hasMessage && !isAddingNote);

  return (
    <Stack spacing={0.5} minWidth={0}>
      <Stack
        direction="row"
        spacing={1}
        justifyContent="space-between"
        minWidth={0}
      >
        <Typography
          variant="subtitle2"
          noWrap
          title={versionLabel}
          sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}
        >
          {versionLabel}
        </Typography>
        <Stack
          direction="row"
          flexWrap="wrap"
          spacing={0.5}
          useFlexGap
          justifyContent="flex-end"
        >
          <Chip
            size="small"
            label={actionMeta.label}
            color={actionMeta.chipColor}
          />
          {isCurrent && (
            <Chip
              size="small"
              label={t("visual_editor.workflow_versions.current")}
              color="primary"
            />
          )}
          {isPublished && (
            <Chip
              size="small"
              label={t("visual_editor.flows_drawer.status.published")}
              color="success"
            />
          )}
        </Stack>
      </Stack>

      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        title={exactDate ?? timeLabel}
      >
        {t("visual_editor.workflow_versions.by", {
          0: createdByLabel,
        })}
        {" \u2022 "}
        {timeLabel}
      </Typography>

      {showEditableMessage && (
        <EditableTypography
          ref={editableMessageRef}
          component="div"
          value={messageValue}
          onCommit={handleCommitMessage}
          onCancel={handleCancelMessage}
          placeholder={t("visual_editor.workflow_versions.add_note")}
          disabled={isSaving}
          title={trimmedMessage || undefined}
          variant="body2"
          color={trimmedMessage ? "text.primary" : "text.secondary"}
        />
      )}

      {hasFooterActions && (
        <Stack
          className="workflow-version-actions"
          direction="row"
          alignItems="center"
          justifyContent="flex-end"
          useFlexGap
          spacing={0.5}
          sx={{
            mt: 0,
            pt: 0,
            opacity: 0,
            maxHeight: 0,
            overflow: "hidden",
            borderTop: "1px solid transparent",
            pointerEvents: "none",
            transition: theme.transitions.create(
              [
                "opacity",
                "max-height",
                "margin-top",
                "padding-top",
                "border-color",
              ],
              {
                duration: theme.transitions.duration.shortest,
              },
            ),
          }}
        >
          {!hasMessage && !isAddingNote && (
            <Button
              size="small"
              variant="text"
              color="inherit"
              disabled={isSaving}
              onClick={() => {
                setIsAddingNote(true);
              }}
              startIcon={<Pencil size={iconSize} />}
            >
              {t("visual_editor.workflow_versions.add_note")}
            </Button>
          )}
          {canPublish && (
            <Button
              size="small"
              variant="text"
              color="primary"
              disabled={isSaving}
              onClick={onPublish}
              startIcon={<CloudUpload size={iconSize} />}
            >
              {t("button.publish")}
            </Button>
          )}
          {canUnpublish && (
            <Button
              size="small"
              variant="text"
              color="warning"
              disabled={isSaving}
              onClick={onUnpublish}
              startIcon={<CloudOff size={iconSize} />}
              sx={{
                minWidth: 0,
                px: 1,
                fontSize: theme.typography.caption.fontSize,
                textTransform: "none",
              }}
            >
              {t("button.unpublish")}
            </Button>
          )}
          {canRestore && (
            <Button
              size="small"
              variant="text"
              color="warning"
              disabled={isSaving}
              onClick={onRestore}
              startIcon={<RotateCcw size={iconSize} />}
            >
              {t("button.restore")}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
};

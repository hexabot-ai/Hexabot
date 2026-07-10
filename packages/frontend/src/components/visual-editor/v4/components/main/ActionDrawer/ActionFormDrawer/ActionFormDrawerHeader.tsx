/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Button, Stack, Typography } from "@mui/material";
import { ArrowLeft } from "lucide-react";

import { EditableTypography } from "@/app-components/inputs/EditableTypography";
import { useTranslate } from "@/hooks/useTranslate";

export type ActionFormDrawerHeaderProps = {
  taskNameValue: string;
  taskNameValidationError: string | null;
  taskDescriptionValue: string;
  taskName?: string;
  isSaving: boolean;
  onTaskNameCommit: (nextTaskName: string) => void;
  onTaskNameCancel: () => void;
  onDescriptionCommit: (nextDescription: string) => void;
  onDescriptionCancel: () => void;
  onBack?: () => void;
};

export const ActionFormDrawerHeader = ({
  taskNameValue,
  taskNameValidationError,
  taskDescriptionValue,
  taskName,
  isSaving,
  onTaskNameCommit,
  onTaskNameCancel,
  onDescriptionCommit,
  onDescriptionCancel,
  onBack,
}: ActionFormDrawerHeaderProps) => {
  const { t } = useTranslate();

  return (
    <Stack spacing={0.25} minWidth={0}>
      {onBack ? (
        <Button
          variant="text"
          size="small"
          startIcon={<ArrowLeft size={16} />}
          onClick={onBack}
          sx={{ alignSelf: "flex-start" }}
        >
          {t("visual_editor.actions_drawer.form.back_to_actions")}
        </Button>
      ) : null}
      <EditableTypography
        component="div"
        variant="subtitle1"
        value={taskNameValue}
        onCommit={onTaskNameCommit}
        onCancel={onTaskNameCancel}
        placeholder={t("visual_editor.actions_drawer.form.step_id.placeholder")}
        disabled={!taskName || isSaving}
        sx={{
          fontFamily: "monospace",
        }}
      />
      {taskNameValidationError ? (
        <Typography variant="caption" color="error.main">
          {taskNameValidationError}
        </Typography>
      ) : null}
      <EditableTypography
        component="div"
        variant="body2"
        multiline
        value={taskDescriptionValue}
        onCommit={onDescriptionCommit}
        onCancel={onDescriptionCancel}
        placeholder={t(
          "visual_editor.actions_drawer.form.description.placeholder",
        )}
        disabled={!taskName || isSaving}
        color={taskDescriptionValue.trim() ? "text.primary" : "text.secondary"}
      />
    </Stack>
  );
};

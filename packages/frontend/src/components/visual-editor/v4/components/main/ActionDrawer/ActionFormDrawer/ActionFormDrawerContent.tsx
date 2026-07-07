/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Stack, Typography } from "@mui/material";
import type { RJSFSchema } from "@rjsf/utils";

import { hasSchemaProperties } from "@/app-components/inputs/JsonSchemaForm";
import { useTranslate } from "@/hooks/useTranslate";
import { IAction } from "@/types/action.types";

import { buildSettingsUiSchema } from "../../../../utils/settings-ui-schema.utils";
import { ActionSchemaPanel } from "../ActionSchemaPanel";

import { DynamicValueHelp } from "./DynamicValueHelp";
import { ExecutionSettingsPanel } from "./ExecutionSettingsPanel";

export type ActionFormDrawerContentProps = {
  isOpen: boolean;
  actionSchema?: IAction;
  inputData: Record<string, unknown>;
  actionSettingsData: Record<string, unknown>;
  executionSettingsData: Record<string, unknown>;
  isUsingWorkflowExecutionDefaults: boolean;
  panelKeyBase: string;
  emptyStateLabel: string;
  onInputDataChange: (data: Record<string, unknown>) => void;
  onActionSettingsDataChange: (data: Record<string, unknown>) => void;
  onExecutionSettingsDataChange: (data: Record<string, unknown>) => void;
  onExecutionSettingsModeChange: (useWorkflowDefaults: boolean) => void;
  onInputVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
  onActionSettingsVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
  onExecutionSettingsVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
};

export const ActionFormDrawerContent = ({
  isOpen,
  actionSchema,
  inputData,
  actionSettingsData,
  executionSettingsData,
  isUsingWorkflowExecutionDefaults,
  panelKeyBase,
  emptyStateLabel,
  onInputDataChange,
  onActionSettingsDataChange,
  onExecutionSettingsDataChange,
  onExecutionSettingsModeChange,
  onInputVisibleErrorsChange,
  onActionSettingsVisibleErrorsChange,
  onExecutionSettingsVisibleErrorsChange,
}: ActionFormDrawerContentProps) => {
  const { t } = useTranslate();

  if (!isOpen) return null;

  if (!actionSchema) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyStateLabel}
      </Typography>
    );
  }

  const hasInputSchema = hasSchemaProperties(actionSchema.inputSchema);
  const hasSettingsSchema = hasSchemaProperties(actionSchema.settingSchema);

  return (
    <Stack spacing={1}>
      {hasInputSchema ? (
        <ActionSchemaPanel
          title={t("visual_editor.actions_drawer.form.section.input")}
          schema={actionSchema.inputSchema}
          formData={inputData}
          onFormDataChange={onInputDataChange}
          onVisibleErrorsChange={onInputVisibleErrorsChange}
          panelKey={`${panelKeyBase}-input`}
          emptyLabel={t("visual_editor.actions_drawer.form.empty_schema.input")}
          expressionPolicy="input-default"
          headerAction={<DynamicValueHelp />}
        />
      ) : null}
      {hasSettingsSchema ? (
        <ActionSchemaPanel
          title={t("visual_editor.actions_drawer.form.section.settings")}
          schema={actionSchema.settingSchema}
          formData={actionSettingsData}
          onFormDataChange={onActionSettingsDataChange}
          onVisibleErrorsChange={onActionSettingsVisibleErrorsChange}
          panelKey={`${panelKeyBase}-settings`}
          emptyLabel={t(
            "visual_editor.actions_drawer.form.empty_schema.settings",
          )}
          uiSchema={buildSettingsUiSchema(
            actionSchema.settingSchema as RJSFSchema | undefined,
            actionSettingsData,
          )}
          expressionPolicy="opt-in"
          headerAction={<DynamicValueHelp />}
        />
      ) : null}
      <ExecutionSettingsPanel
        executionSettingsData={executionSettingsData}
        isUsingWorkflowExecutionDefaults={isUsingWorkflowExecutionDefaults}
        panelKeyBase={panelKeyBase}
        onExecutionSettingsDataChange={onExecutionSettingsDataChange}
        onExecutionSettingsModeChange={onExecutionSettingsModeChange}
        onExecutionSettingsVisibleErrorsChange={
          onExecutionSettingsVisibleErrorsChange
        }
      />
    </Stack>
  );
};

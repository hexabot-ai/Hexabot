/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Stack, Typography } from "@mui/material";
import { type RJSFSchema } from "@rjsf/utils";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DrawerPrimaryFooterAction } from "@/app-components/drawers/DrawerPrimaryFooterAction";
import { EditableTypography } from "@/app-components/inputs/EditableTypography";
import { hasSchemaProperties } from "@/app-components/inputs/JsonSchemaForm";
import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useTranslate } from "@/hooks/useTranslate";

import { useWorkflow } from "../../../hooks/useWorkflow";
import { normalizeBindingName } from "../../../utils/binding-name.utils";
import { buildSettingsUiSchema } from "../../../utils/settings-ui-schema.utils";
import {
  createToolBindingDefinitionMutation,
  TOOL_BINDING_KIND,
  updateToolBindingDefinitionMutation,
} from "../../../utils/tool-bindings.utils";
import { ActionSchemaPanel } from "../ActionDrawer/ActionSchemaPanel";
import {
  useStepDrawerClose,
  withStepDrawerLayout,
} from "../StepDrawer/withStepDrawerLayout";

type ToolFormDrawerContentProps = {
  isOpen: boolean;
  isEmptyState: boolean;
  emptyStateLabel: string;
  hasSettingsSchema: boolean;
  actionSettingsData: Record<string, unknown>;
  onActionSettingsDataChange: (data: Record<string, unknown>) => void;
  onActionSettingsVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
  actionSettingSchema?: unknown;
  panelKeyBase: string;
};

type ToolFormDrawerCreateTarget = {
  mode: "create";
  ownerDefName: string;
  bindingKind: typeof TOOL_BINDING_KIND;
  actionName: string;
  initialBindingName: string;
  initialDescription?: string;
  initialSettings: Record<string, unknown>;
};

type ToolFormDrawerEditTarget = {
  mode: "edit";
  ownerDefName: string;
  bindingKind: typeof TOOL_BINDING_KIND;
  bindingName: string;
};

export type ToolFormDrawerTarget =
  | ToolFormDrawerCreateTarget
  | ToolFormDrawerEditTarget;

type ToolFormDrawerProps = {
  target: ToolFormDrawerTarget | null;
  onClose: () => void;
};

type ResolvedToolTarget = {
  actionName: string;
  bindingName: string;
  description: string;
  settings: Record<string, unknown>;
};

const ToolFormDrawerContent = ({
  isOpen,
  isEmptyState,
  emptyStateLabel,
  hasSettingsSchema,
  actionSettingsData,
  onActionSettingsDataChange,
  onActionSettingsVisibleErrorsChange,
  actionSettingSchema,
  panelKeyBase,
}: ToolFormDrawerContentProps) => {
  const { t } = useTranslate();

  if (!isOpen) {
    return null;
  }

  if (isEmptyState) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyStateLabel}
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {hasSettingsSchema ? (
        <ActionSchemaPanel
          title={t("visual_editor.actions_drawer.form.section.settings")}
          schema={actionSettingSchema}
          formData={actionSettingsData}
          onFormDataChange={onActionSettingsDataChange}
          onVisibleErrorsChange={onActionSettingsVisibleErrorsChange}
          panelKey={`${panelKeyBase}-settings`}
          emptyLabel={t("visual_editor.tool_drawer.form.empty_schema.settings")}
          uiSchema={buildSettingsUiSchema(
            actionSettingSchema as RJSFSchema | undefined,
            actionSettingsData,
          )}
          expressionPolicy="opt-in"
        />
      ) : (
        <Typography variant="body2" color="text.secondary" px={1}>
          {t("visual_editor.tool_drawer.form.empty_schema.settings")}
        </Typography>
      )}
    </Stack>
  );
};
const ToolFormDrawerLayout = withStepDrawerLayout(ToolFormDrawerContent);
const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};
const resolveToolTarget = (
  target: ToolFormDrawerTarget | null,
  definition: ReturnType<typeof useWorkflow>["definition"],
): ResolvedToolTarget | null => {
  if (!target) {
    return null;
  }

  if (target.mode === "create") {
    return {
      actionName: target.actionName,
      bindingName: target.initialBindingName,
      description: target.initialDescription ?? "",
      settings: target.initialSettings,
    };
  }

  const toolDefinition = definition?.defs?.[target.bindingName];
  const toolAsRecord = asRecord(toolDefinition);

  if (!toolAsRecord || toolAsRecord.kind !== target.bindingKind) {
    return null;
  }

  const actionName =
    typeof toolAsRecord.action === "string" ? toolAsRecord.action : "";

  if (!actionName) {
    return null;
  }

  return {
    actionName,
    bindingName: target.bindingName,
    description:
      typeof toolAsRecord.description === "string"
        ? toolAsRecord.description
        : "",
    settings: asRecord(toolAsRecord.settings) ?? {},
  };
};

export const ToolFormDrawer = ({ target, onClose }: ToolFormDrawerProps) => {
  const { t } = useTranslate();
  const { definition, updateDefinitionState, isSaving } = useWorkflow();
  const { actionsByName } = useWorkflowActionsCatalog();
  const [toolNameValue, setToolNameValue] = useState("");
  const [toolDescriptionValue, setToolDescriptionValue] = useState("");
  const [actionSettingsData, setActionSettingsData] = useState<
    Record<string, unknown>
  >({});
  const [hasActionSettingsVisibleErrors, setHasActionSettingsVisibleErrors] =
    useState(false);
  const open = Boolean(target);
  const resolvedTarget = useMemo(
    () => resolveToolTarget(target, definition),
    [definition, target],
  );
  const actionName = resolvedTarget?.actionName;
  const actionSchema = actionName ? actionsByName.get(actionName) : undefined;
  const panelKeyBase = target
    ? target.mode === "create"
      ? `tool-create-${target.ownerDefName}-${target.initialBindingName}`
      : `tool-edit-${target.ownerDefName}-${target.bindingName}`
    : "tool";
  const targetKey = target
    ? target.mode === "create"
      ? `create:${target.ownerDefName}:${target.initialBindingName}:${target.actionName}`
      : `edit:${target.ownerDefName}:${target.bindingName}`
    : "";
  const hasSettingsSchema = useMemo(
    () => hasSchemaProperties(actionSchema?.settingSchema),
    [actionSchema?.settingSchema],
  );
  const normalizedToolName = useMemo(
    () => normalizeBindingName(toolNameValue),
    [toolNameValue],
  );
  const toolNameError = useMemo(() => {
    if (!target) {
      return null;
    }

    if (!toolNameValue.trim()) {
      return t("visual_editor.tool_drawer.form.tool_id.errors.required");
    }

    if (!normalizedToolName) {
      return t("visual_editor.tool_drawer.form.tool_id.errors.snake_case");
    }

    const currentName = target.mode === "edit" ? target.bindingName : undefined;

    if (
      currentName !== normalizedToolName &&
      Object.prototype.hasOwnProperty.call(
        definition?.defs ?? {},
        normalizedToolName,
      )
    ) {
      return t("visual_editor.tool_drawer.form.tool_id.errors.unique");
    }

    return null;
  }, [definition?.defs, normalizedToolName, t, target, toolNameValue]);
  const actionLabel = actionSchema
    ? actionSchema.name
    : (actionName ?? t("visual_editor.actions_drawer.form.action_label.none"));
  const handleClose = useStepDrawerClose(onClose);

  useEffect(() => {
    if (!open || !resolvedTarget) {
      return;
    }

    setToolNameValue(resolvedTarget.bindingName);
    setToolDescriptionValue(resolvedTarget.description);
    setActionSettingsData(resolvedTarget.settings);
    setHasActionSettingsVisibleErrors(false);
  }, [open, resolvedTarget, targetKey]);

  useEffect(() => {
    if (hasSettingsSchema) {
      return;
    }

    setHasActionSettingsVisibleErrors(false);
  }, [hasSettingsSchema]);

  const handleSave = () => {
    if (
      !definition ||
      !target ||
      !resolvedTarget?.actionName ||
      !normalizedToolName ||
      toolNameError ||
      hasActionSettingsVisibleErrors
    ) {
      return;
    }

    const nextDefinition =
      target.mode === "create"
        ? createToolBindingDefinitionMutation(definition, {
            ownerDefName: target.ownerDefName,
            bindingKind: target.bindingKind,
            bindingName: normalizedToolName,
            actionName: resolvedTarget.actionName,
            description: toolDescriptionValue,
            settings: actionSettingsData,
          })
        : updateToolBindingDefinitionMutation(definition, {
            ownerDefName: target.ownerDefName,
            bindingKind: target.bindingKind,
            currentBindingName: target.bindingName,
            nextBindingName: normalizedToolName,
            actionName: resolvedTarget.actionName,
            description: toolDescriptionValue,
            settings: actionSettingsData,
          });

    updateDefinitionState(nextDefinition);
    handleClose();
  };
  const handleToolNameCommit = (nextToolName: string) => {
    const nextNormalizedToolName = normalizeBindingName(nextToolName);

    setToolNameValue(nextNormalizedToolName || "");
  };
  const handleToolNameCancel = () => {
    setToolNameValue(resolvedTarget?.bindingName ?? "");
  };
  const handleDescriptionCommit = (nextDescription: string) => {
    setToolDescriptionValue(nextDescription);
  };
  const handleDescriptionCancel = () => {
    setToolDescriptionValue(resolvedTarget?.description ?? "");
  };

  return (
    <ToolFormDrawerLayout
      open={open}
      isOpen={open}
      isEmptyState={!resolvedTarget}
      emptyStateLabel={t("visual_editor.tool_drawer.form.empty_state.no_tool")}
      hasSettingsSchema={hasSettingsSchema}
      actionSettingsData={actionSettingsData}
      onActionSettingsDataChange={setActionSettingsData}
      onActionSettingsVisibleErrorsChange={setHasActionSettingsVisibleErrors}
      actionSettingSchema={actionSchema?.settingSchema}
      panelKeyBase={panelKeyBase}
      onClose={onClose}
      headerContent={
        <Stack spacing={0.25} minWidth={0}>
          <EditableTypography
            component="div"
            variant="subtitle1"
            value={toolNameValue}
            onCommit={handleToolNameCommit}
            onCancel={handleToolNameCancel}
            placeholder={t(
              "visual_editor.tool_drawer.form.tool_id.placeholder",
            )}
            disabled={!target || isSaving}
            sx={{
              fontFamily: "monospace",
            }}
          />
          {toolNameError ? (
            <Typography variant="caption" color="error.main">
              {toolNameError}
            </Typography>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            ({actionLabel})
          </Typography>
          <EditableTypography
            component="div"
            variant="body2"
            multiline
            value={toolDescriptionValue}
            onCommit={handleDescriptionCommit}
            onCancel={handleDescriptionCancel}
            placeholder={t(
              "visual_editor.tool_drawer.form.description.placeholder",
            )}
            disabled={!target || isSaving}
            color={
              toolDescriptionValue.trim() ? "text.primary" : "text.secondary"
            }
          />
        </Stack>
      }
      footerContent={
        <DrawerPrimaryFooterAction
          label={t("button.save")}
          ariaLabel={t("button.save")}
          onClick={handleSave}
          disabled={
            !definition ||
            !target ||
            !resolvedTarget?.actionName ||
            isSaving ||
            Boolean(toolNameError) ||
            hasActionSettingsVisibleErrors
          }
          startIcon={<Save size={18} />}
        />
      }
    />
  );
};

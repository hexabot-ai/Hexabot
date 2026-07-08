/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BaseSettingsSchema,
  type JsonValue,
  type Settings,
} from "@hexabot-ai/agentic";
import { Typography } from "@mui/material";
import type { RJSFSchema } from "@rjsf/utils";
import type { JSONSchema } from "monaco-yaml";
import { FC, Fragment, useEffect, useMemo, useState } from "react";

import {
  getSchemaDefaults,
  JsonSchemaForm,
} from "@/app-components/inputs/JsonSchemaForm";
import { useTranslate } from "@/hooks/useTranslate";
import { ComponentFormProps } from "@/types/common/dialogs.types";

import { buildSettingsUiSchema } from "../../../utils/settings-ui-schema.utils";

type WorkflowSettingsFormPreset = {
  onSave: (settings: Settings) => void;
  saveDisabled?: boolean;
};

const WORKFLOW_SETTINGS_SCHEMA = BaseSettingsSchema.toJSONSchema({
  target: "draft-07",
}) as RJSFSchema;
const WORKFLOW_SETTING_KEYS = new Set(
  Object.keys(WORKFLOW_SETTINGS_SCHEMA.properties ?? {}),
);

type WorkflowSettingsState = {
  settingsData: Record<string, unknown>;
  passthroughSettings: Record<string, JsonValue>;
};
const splitSettings = (settings?: Settings | null) => {
  const workflowSettings: Record<string, unknown> = {};
  const passthroughSettings: Record<string, JsonValue> = {};

  if (!settings || typeof settings !== "object") {
    return { workflowSettings, passthroughSettings };
  }

  for (const [key, value] of Object.entries(settings)) {
    if (WORKFLOW_SETTING_KEYS.has(key)) {
      workflowSettings[key] = value;
    } else {
      passthroughSettings[key] = value as JsonValue;
    }
  }

  return { workflowSettings, passthroughSettings };
};
const buildWorkflowSettingsState = (
  settings: Settings | null | undefined,
  defaults: Record<string, JsonValue>,
): WorkflowSettingsState => {
  const { workflowSettings, passthroughSettings } = splitSettings(settings);

  return {
    settingsData: {
      ...defaults,
      ...workflowSettings,
    },
    passthroughSettings,
  };
};

export const WorkflowSettingsForm: FC<
  ComponentFormProps<Settings, WorkflowSettingsFormPreset>
> = ({
  data: { defaultValues: settings, presetValues },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const defaults = useMemo(
    () =>
      getSchemaDefaults<Record<string, JsonValue>>(
        WORKFLOW_SETTINGS_SCHEMA as JSONSchema,
      ) ?? {},
    [],
  );
  const [settingsData, setSettingsData] = useState<Record<string, unknown>>(
    () => buildWorkflowSettingsState(settings, defaults).settingsData,
  );
  const [passthroughSettings, setPassthroughSettings] = useState<
    Record<string, JsonValue>
  >(() => buildWorkflowSettingsState(settings, defaults).passthroughSettings);
  const [hasVisibleErrors, setHasVisibleErrors] = useState(false);
  const saveDisabled = presetValues?.saveDisabled ?? false;

  useEffect(() => {
    const nextState = buildWorkflowSettingsState(settings, defaults);

    setSettingsData(nextState.settingsData);
    setPassthroughSettings(nextState.passthroughSettings);
    setHasVisibleErrors(false);
  }, [defaults, settings]);

  const handleSave = () => {
    if (!presetValues?.onSave || saveDisabled || hasVisibleErrors) {
      return;
    }

    presetValues.onSave({
      ...passthroughSettings,
      ...(settingsData as Settings),
    });
    rest.onSuccess?.();
  };

  return (
    <Wrapper
      {...WrapperProps}
      onSubmit={handleSave}
      confirmButtonProps={{
        ...WrapperProps?.confirmButtonProps,
        value: "button.save",
        disabled: !presetValues?.onSave || saveDisabled || hasVisibleErrors,
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("visual_editor.workflow_title_bar.settings.description")}
      </Typography>
      <JsonSchemaForm
        schema={WORKFLOW_SETTINGS_SCHEMA}
        formData={settingsData}
        onFormDataChange={setSettingsData}
        onVisibleErrorsChange={setHasVisibleErrors}
        uiSchema={buildSettingsUiSchema(WORKFLOW_SETTINGS_SCHEMA, settingsData)}
        enableJsonataTextWidget={false}
        idPrefix="workflow-default-settings"
      />
    </Wrapper>
  );
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BaseSettingsSchema,
  type JsonValue,
  type Settings,
  type WorkflowInputSchema,
} from "@hexabot-ai/agentic";
import { Divider, Typography } from "@mui/material";
import type { RJSFSchema } from "@rjsf/utils";
import type { JSONSchema } from "monaco-yaml";
import { FC, Fragment, useEffect, useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import {
  getSchemaDefaults,
  JsonSchemaForm,
} from "@/app-components/inputs/JsonSchemaForm";
import {
  JsonSchemaObjectBuilder,
  type SchemaNodeForm,
} from "@/app-components/inputs/JsonSchemaObjectBuilder";
import { useTranslate } from "@/hooks/useTranslate";
import { ComponentFormProps } from "@/types/common/dialogs.types";

import { buildSettingsUiSchema } from "../../../utils/settings-ui-schema.utils";
import {
  readWorkflowInputSchema,
  writeWorkflowInputSchema,
  type WorkflowInputsChange,
} from "../../../utils/workflow-input-schema.utils";

type WorkflowSettingsFormPreset = {
  /**
   * @param settings The default settings of the workflow.
   * @param inputs What `inputs.schema` becomes, when the form changed it.
   */
  onSave: (settings: Settings, inputs?: WorkflowInputsChange) => void;
  saveDisabled?: boolean;
  /**
   * Set for a workflow that declares its input (a manual one), with the
   * schema its definition holds: the form then edits it as well.
   */
  inputs?: { schema?: WorkflowInputSchema };
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
  const declaresInputs = presetValues?.inputs !== undefined;
  const declaredInputSchema = presetValues?.inputs?.schema;
  const inputsForm = useForm<{ inputSchema: SchemaNodeForm }>({
    defaultValues: {
      inputSchema: readWorkflowInputSchema(declaredInputSchema),
    },
  });

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

    const nextSettings: Settings = {
      ...passthroughSettings,
      ...(settingsData as Settings),
    };

    if (!declaresInputs) {
      presetValues.onSave(nextSettings);
      rest.onSuccess?.();

      return;
    }

    // Runs the checks of the input fields (a name, used once) first.
    void inputsForm.handleSubmit(({ inputSchema }) => {
      presetValues.onSave(
        nextSettings,
        writeWorkflowInputSchema(inputSchema, declaredInputSchema),
      );
      rest.onSuccess?.();
    })();
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
      {declaresInputs ? (
        <>
          <Divider sx={{ my: 2 }} />
          <FormProvider {...inputsForm}>
            <JsonSchemaObjectBuilder
              name="inputSchema"
              label={t("label.input_schema", { defaultValue: "Input schema" })}
              description={t("message.workflow_input_schema_description", {
                defaultValue:
                  "Define the input this workflow accepts when it runs. It is saved in the workflow definition, under inputs.schema.",
              })}
            />
          </FormProvider>
        </>
      ) : null}
    </Wrapper>
  );
};

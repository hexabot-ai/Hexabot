/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type Source,
  type SourceFull,
  type Workflow,
  WorkflowType,
} from "@hexabot-ai/types";
import {
  Alert,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { type FC, Fragment, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import AutoCompleteEntitySelect from "@/app-components/inputs/AutoCompleteEntitySelect";
import { JsonSchemaForm } from "@/app-components/inputs/JsonSchemaForm";
import { useCreate } from "@/hooks/crud/useCreate";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { IChannel } from "@/types/channel.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";

import {
  buildSourcePayload,
  buildSourceSettingsUiSchema,
  getSourceFormDefaults,
  getSourceDisplayChannelName,
  isSourceChannelRegistered,
  isSourceStateFieldHidden,
  isSourceStateToggleDisabled,
  resolveSourceChannel,
  resolveSourceSettingsSchema,
  shouldDisableSourceFormSubmit,
} from "./source-form.utils";

type SourceLike = Source | SourceFull;
type SourceAttributes = EntityAttributes<EntityType.SOURCE>;

export type SourceFormPresetValues = {
  channel?: string;
  channelsByName: Record<string, IChannel>;
};

type SourceFormData = {
  name: string;
  defaultWorkflow: string | null;
  state: boolean;
};

export const SourceForm: FC<
  ComponentFormProps<SourceLike, SourceFormPresetValues>
> = ({
  data: { defaultValues: source, presetValues },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const channelName = resolveSourceChannel(source, presetValues?.channel);
  const isRegisteredChannel = isSourceChannelRegistered(
    channelName,
    presetValues?.channelsByName,
  );
  const isUnregisteredChannel = Boolean(channelName) && !isRegisteredChannel;
  const sourceDefaults = useMemo(() => getSourceFormDefaults(source), [source]);
  const [settingsData, setSettingsData] = useState(sourceDefaults.settings);
  const [hasSettingsErrors, setHasSettingsErrors] = useState(false);
  const settingsSchema = useMemo(
    () =>
      resolveSourceSettingsSchema(
        channelName
          ? presetValues?.channelsByName?.[channelName]?.settingsSchema
          : undefined,
      ),
    [channelName, presetValues?.channelsByName],
  );
  const settingsUiSchema = useMemo(
    () => buildSourceSettingsUiSchema(settingsSchema),
    [settingsSchema],
  );
  const hasSettingsSchema = useMemo(
    () => Object.keys(settingsSchema.properties || {}).length > 0,
    [settingsSchema.properties],
  );
  const {
    control,
    register,
    reset,
    formState: { errors },
    handleSubmit,
  } = useForm<SourceFormData>({
    defaultValues: {
      name: sourceDefaults.name,
      defaultWorkflow: sourceDefaults.defaultWorkflow,
      state: sourceDefaults.state,
    },
  });
  const options = {
    onError: (error: Error) => {
      rest.onError?.();
      toast.error(error);
    },
    onSuccess() {
      rest.onSuccess?.();
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createSource } = useCreate(EntityType.SOURCE, options);
  const { mutate: updateSource } = useUpdate(EntityType.SOURCE, options);
  const isFormDisabled = isUnregisteredChannel;
  const isStateFieldHidden = isSourceStateFieldHidden({
    channelName,
    channelsByName: presetValues?.channelsByName,
  });
  const channelLabel = getSourceDisplayChannelName(
    channelName,
    presetValues?.channelsByName,
    t("label.admin_test_console"),
  );
  const isSubmitDisabled = shouldDisableSourceFormSubmit({
    channelName,
    isUnregisteredChannel,
    hasSettingsErrors,
    hasNameError: !!errors.name,
  });

  useEffect(() => {
    const nextDefaults = getSourceFormDefaults(source);

    reset({
      name: nextDefaults.name,
      defaultWorkflow: nextDefaults.defaultWorkflow,
      state: nextDefaults.state,
    });
    setSettingsData(nextDefaults.settings);
    setHasSettingsErrors(false);
  }, [channelName, reset, source]);

  const onSubmitForm = (params: SourceFormData) => {
    if (!channelName || isUnregisteredChannel || hasSettingsErrors) {
      return;
    }

    const payload = buildSourcePayload({
      channel: source?.channel ?? channelName,
      name: params.name,
      state: params.state,
      settings: settingsData,
      settingsSchema,
      defaultWorkflow: params.defaultWorkflow,
    });

    if (source?.id) {
      updateSource({
        id: source.id,
        params: payload as SourceAttributes,
      });
    } else {
      createSource(payload as SourceAttributes);
    }
  };

  return (
    <Wrapper
      onSubmit={handleSubmit(onSubmitForm)}
      {...WrapperProps}
      confirmButtonProps={{
        ...WrapperProps?.confirmButtonProps,
        disabled:
          isSubmitDisabled ||
          Boolean(WrapperProps?.confirmButtonProps?.disabled),
      }}
    >
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          {isUnregisteredChannel ? (
            <ContentItem>
              <Alert severity="warning">
                {t("message.source_channel_handler_not_registered")}
              </Alert>
            </ContentItem>
          ) : null}
          {isStateFieldHidden ? (
            <ContentItem>
              <Alert severity="info">{t("message.system_source_info")}</Alert>
            </ContentItem>
          ) : null}
          <ContentItem>
            <TextField
              label={t("label.name")}
              error={!!errors.name}
              required
              autoFocus
              disabled={isFormDisabled}
              helperText={errors.name ? errors.name.message : null}
              {...register("name", {
                required: t("message.name_is_required"),
              })}
            />
          </ContentItem>
          <ContentItem>
            <TextField
              label={t("label.channel")}
              value={channelLabel}
              disabled
              helperText={
                channelName
                  ? channelLabel === channelName
                    ? null
                    : channelName
                  : t("message.no_channel_selected_for_source")
              }
            />
          </ContentItem>
          <ContentItem>
            <Controller
              name="defaultWorkflow"
              control={control}
              render={({ field }) => (
                <AutoCompleteEntitySelect<Workflow, "name", false>
                  entity={EntityType.WORKFLOW}
                  format={Format.BASIC}
                  searchFields={["name"]}
                  label={t("label.workflow")}
                  labelKey="name"
                  multiple={false}
                  disabled={isFormDisabled}
                  value={field.value}
                  where={{ type: WorkflowType.conversational }}
                  onChange={(_event, selected) =>
                    field.onChange(selected?.id || null)
                  }
                />
              )}
            />
          </ContentItem>
          {!isStateFieldHidden ? (
            <ContentItem>
              <Controller
                name="state"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={field.value}
                        disabled={isSourceStateToggleDisabled({
                          channelName,
                          disabled: isFormDisabled,
                        })}
                        onChange={(_event, checked) => field.onChange(checked)}
                      />
                    }
                    label={t("label.enabled")}
                  />
                )}
              />
            </ContentItem>
          ) : null}
          {!isUnregisteredChannel ? (
            <ContentItem>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("label.settings")}
              </Typography>
              {hasSettingsSchema ? (
                <JsonSchemaForm
                  schema={settingsSchema}
                  formData={settingsData}
                  onFormDataChange={setSettingsData}
                  onVisibleErrorsChange={setHasSettingsErrors}
                  uiSchema={settingsUiSchema}
                  enableJsonataTextWidget={false}
                  idPrefix={`source-settings-${source?.id ?? "new"}-${
                    channelName || "unknown"
                  }`}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("message.no_settings_schema_for_source_channel")}
                </Typography>
              )}
            </ContentItem>
          ) : null}
        </ContentContainer>
      </form>
    </Wrapper>
  );
};

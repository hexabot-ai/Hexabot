/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";
import type {
  Credential,
  WebhookTriggerConfig,
  Workflow,
} from "@hexabot-ai/types";
import {
  WebhookAuthType,
  WebhookJwtAlgorithm,
  WorkflowType,
} from "@hexabot-ai/types";
import {
  Button,
  Collapse,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import { Code, Copy, KeyRound } from "lucide-react";
import type { JSONSchema } from "monaco-yaml";
import { FC, Fragment, useEffect, useMemo, useState } from "react";
import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import AutoCompleteEntitySelect from "@/app-components/inputs/AutoCompleteEntitySelect";
import { CronInput } from "@/app-components/inputs/CronInput";
import { getSchemaDefaults } from "@/app-components/inputs/JsonSchemaForm";
import { useGenerateWebhookToken } from "@/components/workflow-webhook/hooks/useGenerateWebhookToken";
import { WebhookSnippetDialog } from "@/components/workflow-webhook/WebhookSnippetDialog";
import { useCreate } from "@/hooks/crud/useCreate";
import { useTanstackQueryClient } from "@/hooks/crud/useTanstack";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useAuth } from "@/hooks/useAuth";
import { useConfig } from "@/hooks/useConfig";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format, QueryType } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";
import { writeToClipboard } from "@/utils/clipboard";

import { WorkflowTypeSelector } from "./WorkflowTypeSelector";

type WorkflowSubmitAttributes = EntityAttributes<EntityType.WORKFLOW> & {
  definitionYml?: string;
};

type WorkflowFormPreset = {
  definition?: WorkflowDefinition;
  definitionYaml?: string;
  /**
   * JSON Schema of the input the edited workflow is run with, when the
   * caller knows it: the webhook snippet shows a body made of its defaults.
   */
  inputSchema?: unknown;
  onCreated?: (workflow: Workflow) => void;
  onUpdated?: (workflow: Workflow) => void;
};

type WebhookTriggerFormValues = {
  enabled: boolean;
  authType: WebhookAuthType;
  username: string;
  passwordCredentialId: string | null;
  headerName: string;
  headerValueCredentialId: string | null;
  jwtSecretCredentialId: string | null;
  jwtAlgorithm: WebhookJwtAlgorithm;
};

type WorkflowFormValues = {
  name: string;
  description: string;
  type: WorkflowType;
  schedule: string;
  webhookTrigger: WebhookTriggerFormValues;
};

const DEFAULT_WEBHOOK_HEADER_NAME = "X-Webhook-Token";
const buildWebhookTriggerFormValues = (
  config?: WebhookTriggerConfig | null,
): WebhookTriggerFormValues => ({
  enabled: config?.enabled ?? false,
  authType: config?.authType ?? WebhookAuthType.none,
  username:
    config?.authType === WebhookAuthType.basic ? (config.username ?? "") : "",
  passwordCredentialId:
    config?.authType === WebhookAuthType.basic
      ? (config.passwordCredentialId ?? null)
      : null,
  headerName:
    config?.authType === WebhookAuthType.header
      ? (config.headerName ?? DEFAULT_WEBHOOK_HEADER_NAME)
      : DEFAULT_WEBHOOK_HEADER_NAME,
  headerValueCredentialId:
    config?.authType === WebhookAuthType.header
      ? (config.headerValueCredentialId ?? null)
      : null,
  jwtSecretCredentialId:
    config?.authType === WebhookAuthType.jwt
      ? (config.jwtSecretCredentialId ?? null)
      : null,
  jwtAlgorithm:
    config?.authType === WebhookAuthType.jwt
      ? (config.jwtAlgorithm ?? WebhookJwtAlgorithm.HS256)
      : WebhookJwtAlgorithm.HS256,
});
const buildWebhookTriggerPayload = (
  values: WebhookTriggerFormValues,
): WebhookTriggerConfig => {
  if (!values.enabled) {
    return { enabled: false, authType: WebhookAuthType.none };
  }

  switch (values.authType) {
    case WebhookAuthType.basic:
      return {
        enabled: true,
        authType: WebhookAuthType.basic,
        username: values.username.trim() || null,
        passwordCredentialId: values.passwordCredentialId || null,
      };
    case WebhookAuthType.header:
      return {
        enabled: true,
        authType: WebhookAuthType.header,
        headerName: values.headerName.trim() || null,
        headerValueCredentialId: values.headerValueCredentialId || null,
      };
    case WebhookAuthType.jwt:
      return {
        enabled: true,
        authType: WebhookAuthType.jwt,
        jwtSecretCredentialId: values.jwtSecretCredentialId || null,
        jwtAlgorithm: values.jwtAlgorithm,
      };
    case WebhookAuthType.none:
    default:
      return { enabled: true, authType: WebhookAuthType.none };
  }
};

export const WorkflowForm: FC<
  ComponentFormProps<Workflow, WorkflowFormPreset>
> = ({
  data: { defaultValues: workflow, presetValues },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const queryClient = useTanstackQueryClient();
  const { toast } = useToast();
  const { refetchUser } = useAuth();
  const { apiUrl } = useConfig();
  const { definition, definitionYaml, inputSchema, onCreated, onUpdated } =
    presetValues ?? {};
  const isEditing = Boolean(workflow?.id);
  const defaultValues = useMemo(() => {
    const workflowType = workflow?.type ?? WorkflowType.conversational;

    return workflow
      ? {
          name: workflow.name ?? "",
          description: workflow.description ?? "",
          type: workflowType,
          schedule: workflow.schedule ?? "",
          webhookTrigger: buildWebhookTriggerFormValues(
            workflow.webhookTrigger,
          ),
        }
      : {
          name: "",
          description: "",
          type: workflowType,
          schedule: "",
          webhookTrigger: buildWebhookTriggerFormValues(),
        };
  }, [workflow]);
  const form = useForm<WorkflowFormValues>({
    defaultValues,
  });
  const {
    control,
    register,
    reset,
    setValue,
    getValues,
    clearErrors,
    formState: { errors },
    handleSubmit,
  } = form;
  const typeValue = (useWatch({ control, name: "type" }) ??
    defaultValues.type) as WorkflowType;
  const isManualWorkflow = typeValue === WorkflowType.manual;
  const webhookEnabled = useWatch({
    control,
    name: "webhookTrigger.enabled",
  });
  const webhookAuthType = useWatch({
    control,
    name: "webhookTrigger.authType",
  });
  const webhookTriggerUrl = workflow?.id
    ? `${apiUrl}/webhook/${workflow.id}/trigger`
    : "";
  const nameRegister = register("name", {
    required: t("message.name_is_required"),
    setValueAs: (value: string) => value?.trim(),
  });
  const handleWebhookEnabledChange = (
    checked: boolean,
    onChange: (value: boolean) => void,
  ) => {
    onChange(checked);

    // Default to Header Auth the first time the trigger is enabled so the
    // endpoint is not left unauthenticated by accident.
    if (
      checked &&
      getValues("webhookTrigger.authType") === WebhookAuthType.none
    ) {
      setValue("webhookTrigger.authType", WebhookAuthType.header, {
        shouldDirty: true,
      });
    }
  };
  // Only enforced while the webhook is enabled with the matching auth type,
  // mirroring the API-side schema which rejects enabled webhooks with unset
  // credentials.
  const webhookCredentialRules = (authType: WebhookAuthType) => ({
    validate: (value: string | null) =>
      !getValues("webhookTrigger.enabled") ||
      getValues("webhookTrigger.authType") !== authType ||
      Boolean(value?.trim()) ||
      t("message.webhook_credential_required", {
        defaultValue:
          "This field is required when the webhook trigger is enabled.",
      }),
  });
  const handleCopyWebhookUrl = async () => {
    if (!webhookTriggerUrl) {
      return;
    }

    await writeToClipboard(webhookTriggerUrl);
    toast.success(
      t("message.webhook_trigger_url_copied", {
        defaultValue: "Webhook trigger URL copied.",
      }),
    );
  };
  // Token generation targets the SAVED workflow config: the server signs with
  // the persisted secret credential, so unsaved edits are irrelevant here.
  const canGenerateWebhookToken = Boolean(
    isEditing &&
      workflow?.webhookTrigger?.enabled &&
      workflow.webhookTrigger.authType === WebhookAuthType.jwt,
  );
  const {
    generateToken,
    tokenResult,
    isPending: isGeneratingToken,
  } = useGenerateWebhookToken(workflow?.id);
  const handleCopyToken = async () => {
    if (!tokenResult) {
      return;
    }

    await writeToClipboard(tokenResult.token);
    toast.success(
      t("message.webhook_token_copied", {
        defaultValue: "Token copied.",
      }),
    );
  };
  // Snapshotted when the dialog opens so snippets reflect the current
  // (possibly unsaved) webhook settings.
  const [snippetDialogState, setSnippetDialogState] = useState<{
    webhookTrigger: WebhookTriggerConfig | null;
    body: Record<string, unknown>;
  } | null>(null);
  const handleOpenSnippetDialog = () => {
    setSnippetDialogState({
      webhookTrigger:
        (getValues("webhookTrigger") as WebhookTriggerConfig | null) ?? null,
      body:
        (inputSchema
          ? getSchemaDefaults(inputSchema as JSONSchema)
          : undefined) ?? {},
    });
  };
  const handleTypeChange = (nextType: WorkflowType) => {
    const currentType = getValues("type");

    if (currentType === nextType) {
      return;
    }

    setValue("type", nextType, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };
  const options = {
    onError: (error: Error & { statusCode?: number }) => {
      if (error.statusCode === 403) {
        void refetchUser();
      }
      rest.onError?.();
      toast.error(error);
    },
    onSuccess: () => {
      rest.onSuccess?.();
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createWorkflow, isPending: isCreating } = useCreate<
    EntityType.WORKFLOW,
    WorkflowSubmitAttributes
  >(EntityType.WORKFLOW, {
    ...options,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: [QueryType.item, EntityType.WORKFLOW, created.id],
      });
      onCreated?.(created);
      options.onSuccess();
    },
  });
  const { mutate: updateWorkflow, isPending: isUpdating } = useUpdate<
    EntityType.WORKFLOW,
    WorkflowSubmitAttributes
  >(EntityType.WORKFLOW, {
    ...options,
    onSuccess: (updated) => {
      onUpdated?.(updated);
      options.onSuccess();
    },
  });
  const onSubmitForm = (params: WorkflowFormValues) => {
    const name = params.name.trim();
    const description = params.description.trim() || null;
    const schedule =
      params.type === WorkflowType.scheduled
        ? params.schedule.trim() || null
        : null;
    const payload: WorkflowSubmitAttributes = {
      name,
      description,
      type: params.type,
      schedule,
    };

    if (params.type === WorkflowType.manual) {
      payload.webhookTrigger = buildWebhookTriggerPayload(
        params.webhookTrigger,
      );
    }

    if (workflow?.id) {
      updateWorkflow({
        id: workflow.id,
        params: payload,
      });

      return;
    }

    if (!definition || !definitionYaml) {
      rest.onError?.();
      toast.error(t("message.unable_to_save"));

      return;
    }

    createWorkflow({
      ...payload,
      definitionYml: definitionYaml,
    });
  };

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  useEffect(() => {
    if (typeValue !== WorkflowType.scheduled) {
      clearErrors("schedule");
    }
  }, [clearErrors, typeValue]);

  return (
    <FormProvider {...form}>
      <Wrapper
        onSubmit={handleSubmit(onSubmitForm)}
        {...WrapperProps}
        confirmButtonProps={{
          ...WrapperProps?.confirmButtonProps,
          disabled: isCreating || isUpdating,
        }}
      >
        <form onSubmit={handleSubmit(onSubmitForm)}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <ContentContainer>
                <ContentItem display="flex">
                  <Controller
                    name="type"
                    control={control}
                    rules={{
                      required: t("message.type_is_required", {
                        defaultValue: "Workflow type is required.",
                      }),
                    }}
                    render={({ field }) => (
                      <WorkflowTypeSelector
                        name={field.name}
                        value={
                          (field.value as WorkflowType) ?? defaultValues.type
                        }
                        onBlur={field.onBlur}
                        onChange={handleTypeChange}
                        disabled={isEditing}
                        error={!!errors.type}
                        helperText={errors.type?.message}
                      />
                    )}
                  />
                </ContentItem>
                <ContentItem>
                  <TextField
                    label={t("label.name")}
                    error={!!errors.name}
                    required
                    autoFocus
                    helperText={errors.name ? errors.name.message : null}
                    {...nameRegister}
                  />
                </ContentItem>
                <ContentItem>
                  <TextField
                    label={t("label.description")}
                    multiline
                    minRows={3}
                    {...register("description")}
                  />
                </ContentItem>
              </ContentContainer>
            </Grid>

            <Grid size={{ xs: 12, md: 7 }}>
              <ContentContainer>
                {typeValue === WorkflowType.scheduled && (
                  <ContentItem>
                    <Paper variant="spaced">
                      <Stack spacing={1.5}>
                        <Typography variant="h6">
                          {t("label.schedule", {
                            defaultValue: "Schedule",
                          })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t("message.schedule_description", {
                            defaultValue:
                              "Choose how often this workflow runs automatically.",
                          })}
                        </Typography>
                        <Controller
                          name="schedule"
                          control={control}
                          rules={{
                            validate: (value) =>
                              (value && value.trim().length > 0) ||
                              t("message.schedule_is_required", {
                                defaultValue:
                                  "Schedule is required for scheduled workflows.",
                              }),
                          }}
                          render={({ field }) => (
                            <CronInput
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              error={!!errors.schedule}
                            />
                          )}
                        />
                      </Stack>
                    </Paper>
                  </ContentItem>
                )}
                {isManualWorkflow && (
                  <ContentItem>
                    <Paper variant="spaced">
                      <Stack spacing={1.5}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={1}
                        >
                          <Typography variant="h6">
                            {t("label.webhook_endpoint", {
                              defaultValue: "Webhook Endpoint",
                            })}
                          </Typography>
                          <Controller
                            name="webhookTrigger.enabled"
                            control={control}
                            render={({ field }) => (
                              <FormControlLabel
                                labelPlacement="start"
                                label={t("label.enable_endpoint", {
                                  defaultValue: "Enable endpoint",
                                })}
                                control={
                                  <Switch
                                    checked={!!field.value}
                                    onChange={(event) =>
                                      handleWebhookEnabledChange(
                                        event.target.checked,
                                        field.onChange,
                                      )
                                    }
                                    onBlur={field.onBlur}
                                  />
                                }
                              />
                            )}
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {t("message.webhook_endpoint_description", {
                            defaultValue:
                              "Create an HTTP endpoint that external services can call to start this workflow.",
                          })}
                        </Typography>
                        <Collapse in={webhookEnabled} unmountOnExit>
                          <Stack spacing={1.5}>
                            <Divider />
                            {isEditing ? (
                              <TextField
                                label={t("label.webhook_trigger_url", {
                                  defaultValue: "Webhook Trigger URL",
                                })}
                                value={webhookTriggerUrl}
                                slotProps={{
                                  input: {
                                    readOnly: true,
                                    endAdornment: (
                                      <InputAdornment position="end">
                                        <Tooltip
                                          title={t("button.copy", {
                                            defaultValue: "Copy",
                                          })}
                                        >
                                          <IconButton
                                            size="small"
                                            onClick={handleCopyWebhookUrl}
                                          >
                                            <Copy size={16} />
                                          </IconButton>
                                        </Tooltip>
                                        <Tooltip
                                          title={t("button.view_code_snippet")}
                                        >
                                          <IconButton
                                            edge="end"
                                            size="small"
                                            onClick={handleOpenSnippetDialog}
                                          >
                                            <Code size={16} />
                                          </IconButton>
                                        </Tooltip>
                                      </InputAdornment>
                                    ),
                                  },
                                }}
                                helperText={t(
                                  "message.webhook_trigger_url_hint",
                                  {
                                    defaultValue:
                                      "Send a POST request to this URL to trigger the workflow. The JSON body is used as the workflow input.",
                                  },
                                )}
                              />
                            ) : (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {t("message.webhook_trigger_url_after_save", {
                                  defaultValue:
                                    "The webhook trigger URL will be available after saving the workflow.",
                                })}
                              </Typography>
                            )}
                            <Controller
                              name="webhookTrigger.authType"
                              control={control}
                              render={({ field }) => (
                                <TextField
                                  select
                                  label={t("label.webhook_auth_type", {
                                    defaultValue: "Authentication",
                                  })}
                                  {...field}
                                >
                                  <MenuItem value={WebhookAuthType.none}>
                                    {t("label.webhook_auth_none", {
                                      defaultValue: "None",
                                    })}
                                  </MenuItem>
                                  <MenuItem value={WebhookAuthType.basic}>
                                    {t("label.webhook_auth_basic", {
                                      defaultValue: "Basic Auth",
                                    })}
                                  </MenuItem>
                                  <MenuItem value={WebhookAuthType.header}>
                                    {t("label.webhook_auth_header", {
                                      defaultValue: "Header Auth",
                                    })}
                                  </MenuItem>
                                  <MenuItem value={WebhookAuthType.jwt}>
                                    {t("label.webhook_auth_jwt", {
                                      defaultValue: "JWT Auth",
                                    })}
                                  </MenuItem>
                                </TextField>
                              )}
                            />
                            {webhookAuthType === WebhookAuthType.none && (
                              <Typography
                                variant="caption"
                                color="warning.main"
                              >
                                {t("message.webhook_auth_none_warning", {
                                  defaultValue:
                                    "Anyone with the URL will be able to trigger this workflow.",
                                })}
                              </Typography>
                            )}
                            {webhookAuthType === WebhookAuthType.basic && (
                              <>
                                <TextField
                                  label={t("label.username")}
                                  error={Boolean(
                                    errors.webhookTrigger?.username,
                                  )}
                                  helperText={
                                    errors.webhookTrigger?.username?.message
                                  }
                                  {...register(
                                    "webhookTrigger.username",
                                    webhookCredentialRules(
                                      WebhookAuthType.basic,
                                    ),
                                  )}
                                />
                                <Controller
                                  name="webhookTrigger.passwordCredentialId"
                                  control={control}
                                  rules={webhookCredentialRules(
                                    WebhookAuthType.basic,
                                  )}
                                  render={({ field, fieldState }) => {
                                    const { onChange, ...restField } = field;

                                    return (
                                      <AutoCompleteEntitySelect<
                                        Credential,
                                        "name",
                                        false
                                      >
                                        entity={EntityType.CREDENTIAL}
                                        format={Format.BASIC}
                                        searchFields={["name"]}
                                        labelKey="name"
                                        label={t(
                                          "label.webhook_password_credential",
                                          {
                                            defaultValue: "Password Credential",
                                          },
                                        )}
                                        multiple={false}
                                        onChange={(_event, selected) =>
                                          onChange(selected?.id || null)
                                        }
                                        enableEntityAddButton
                                        error={Boolean(fieldState.error)}
                                        helperText={fieldState.error?.message}
                                        {...restField}
                                      />
                                    );
                                  }}
                                />
                              </>
                            )}
                            {webhookAuthType === WebhookAuthType.header && (
                              <>
                                <TextField
                                  label={t("label.header_name", {
                                    defaultValue: "Header Name",
                                  })}
                                  error={Boolean(
                                    errors.webhookTrigger?.headerName,
                                  )}
                                  helperText={
                                    errors.webhookTrigger?.headerName?.message
                                  }
                                  {...register(
                                    "webhookTrigger.headerName",
                                    webhookCredentialRules(
                                      WebhookAuthType.header,
                                    ),
                                  )}
                                />
                                <Controller
                                  name="webhookTrigger.headerValueCredentialId"
                                  control={control}
                                  rules={webhookCredentialRules(
                                    WebhookAuthType.header,
                                  )}
                                  render={({ field, fieldState }) => {
                                    const { onChange, ...restField } = field;

                                    return (
                                      <AutoCompleteEntitySelect<
                                        Credential,
                                        "name",
                                        false
                                      >
                                        entity={EntityType.CREDENTIAL}
                                        format={Format.BASIC}
                                        searchFields={["name"]}
                                        labelKey="name"
                                        label={t(
                                          "label.webhook_header_value_credential",
                                          {
                                            defaultValue:
                                              "Header Value Credential",
                                          },
                                        )}
                                        multiple={false}
                                        onChange={(_event, selected) =>
                                          onChange(selected?.id || null)
                                        }
                                        enableEntityAddButton
                                        error={Boolean(fieldState.error)}
                                        helperText={fieldState.error?.message}
                                        {...restField}
                                      />
                                    );
                                  }}
                                />
                              </>
                            )}
                            {webhookAuthType === WebhookAuthType.jwt && (
                              <>
                                <Controller
                                  name="webhookTrigger.jwtAlgorithm"
                                  control={control}
                                  render={({ field }) => (
                                    <TextField
                                      select
                                      label={t("label.jwt_algorithm", {
                                        defaultValue: "Algorithm",
                                      })}
                                      {...field}
                                    >
                                      {Object.values(WebhookJwtAlgorithm).map(
                                        (algorithm) => (
                                          <MenuItem
                                            key={algorithm}
                                            value={algorithm}
                                          >
                                            {algorithm}
                                          </MenuItem>
                                        ),
                                      )}
                                    </TextField>
                                  )}
                                />
                                <Controller
                                  name="webhookTrigger.jwtSecretCredentialId"
                                  control={control}
                                  rules={webhookCredentialRules(
                                    WebhookAuthType.jwt,
                                  )}
                                  render={({ field, fieldState }) => {
                                    const { onChange, ...restField } = field;

                                    return (
                                      <AutoCompleteEntitySelect<
                                        Credential,
                                        "name",
                                        false
                                      >
                                        entity={EntityType.CREDENTIAL}
                                        format={Format.BASIC}
                                        searchFields={["name"]}
                                        labelKey="name"
                                        label={t(
                                          "label.webhook_jwt_secret_credential",
                                          {
                                            defaultValue:
                                              "Signing Secret Credential",
                                          },
                                        )}
                                        multiple={false}
                                        onChange={(_event, selected) =>
                                          onChange(selected?.id || null)
                                        }
                                        enableEntityAddButton
                                        error={Boolean(fieldState.error)}
                                        helperText={fieldState.error?.message}
                                        {...restField}
                                      />
                                    );
                                  }}
                                />
                                {canGenerateWebhookToken ? (
                                  <Stack spacing={1}>
                                    <Button
                                      variant="outlined"
                                      startIcon={<KeyRound size={16} />}
                                      loading={isGeneratingToken}
                                      onClick={() => generateToken()}
                                    >
                                      {t("button.generate_token", {
                                        defaultValue: "Generate token",
                                      })}
                                    </Button>
                                    {tokenResult ? (
                                      <TextField
                                        value={tokenResult.token}
                                        size="small"
                                        slotProps={{
                                          input: {
                                            readOnly: true,
                                            endAdornment: (
                                              <InputAdornment position="end">
                                                <Tooltip
                                                  title={t("button.copy")}
                                                >
                                                  <IconButton
                                                    edge="end"
                                                    size="small"
                                                    onClick={handleCopyToken}
                                                  >
                                                    <Copy size={16} />
                                                  </IconButton>
                                                </Tooltip>
                                              </InputAdornment>
                                            ),
                                          },
                                        }}
                                        helperText={t(
                                          "message.webhook_token_generated",
                                          {
                                            defaultValue:
                                              "Token generated. It does not expire; rotate the signing secret credential to revoke it.",
                                          },
                                        )}
                                      />
                                    ) : (
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                      >
                                        {t("message.webhook_token_hint", {
                                          defaultValue:
                                            "Tokens are signed with the saved secret. Save your changes first.",
                                        })}
                                      </Typography>
                                    )}
                                  </Stack>
                                ) : null}
                              </>
                            )}
                          </Stack>
                        </Collapse>
                      </Stack>
                    </Paper>
                  </ContentItem>
                )}
                {isManualWorkflow && (
                  <ContentItem>
                    <Typography variant="caption" color="text.secondary">
                      {t("message.workflow_input_schema_settings_hint", {
                        defaultValue:
                          "You can define input fields in the workflow settings.",
                      })}
                    </Typography>
                  </ContentItem>
                )}
              </ContentContainer>
            </Grid>
          </Grid>
          {isEditing ? (
            <WebhookSnippetDialog
              open={snippetDialogState !== null}
              onClose={() => setSnippetDialogState(null)}
              url={webhookTriggerUrl}
              workflowId={workflow?.id}
              webhookTrigger={snippetDialogState?.webhookTrigger}
              body={snippetDialogState?.body ?? {}}
            />
          ) : null}
        </form>
      </Wrapper>
    </FormProvider>
  );
};

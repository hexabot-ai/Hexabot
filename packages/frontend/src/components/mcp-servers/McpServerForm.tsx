/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Credential } from "@hexabot-ai/types";
import { FormControlLabel, MenuItem, Switch, TextField } from "@mui/material";
import { FC, Fragment, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import AutoCompleteEntitySelect from "@/app-components/inputs/AutoCompleteEntitySelect";
import MultipleInput from "@/app-components/inputs/MultipleInput";
import { useCreate } from "@/hooks/crud/useCreate";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";
import { McpServer, McpServerTransport } from "@/types/mcp-server.types";
import { isAbsoluteUrl } from "@/utils/URL";

type McpServerAttributes = EntityAttributes<EntityType.MCP_SERVER>;

export const McpServerForm: FC<ComponentFormProps<McpServer>> = ({
  data: { defaultValues: mcpServer },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const options = {
    onError: (error: Error) => {
      rest.onError?.();
      toast.error(error);
    },
    onSuccess(data: McpServer) {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createMcpServer } = useCreate(EntityType.MCP_SERVER, options);
  const { mutate: updateMcpServer } = useUpdate(EntityType.MCP_SERVER, options);
  const {
    watch,
    setValue,
    reset,
    register,
    control,
    formState: { errors },
    handleSubmit,
  } = useForm<McpServerAttributes>({
    defaultValues: {
      name: mcpServer?.name || "",
      enabled: mcpServer?.enabled ?? true,
      transport: mcpServer?.transport || McpServerTransport.http,
      url: mcpServer?.url || "",
      command: mcpServer?.command || "",
      args: mcpServer?.args || [],
      cwd: mcpServer?.cwd || "",
      credential: mcpServer?.credential || null,
    },
  });
  const transportValue = watch("transport");
  const credentialValue = watch("credential");
  const isHttpTransport = transportValue === McpServerTransport.http;
  const isStdioTransport = transportValue === McpServerTransport.stdio;
  const validationRules = {
    name: {
      required: t("message.name_is_required"),
    },
    url: {
      validate: (value: string | null) => {
        if (!isHttpTransport) {
          return true;
        }

        const normalized = typeof value === "string" ? value.trim() : "";

        if (!normalized) {
          return t("message.url_is_required");
        }

        return (
          isAbsoluteUrl(normalized, { requireTld: false }) ||
          t("message.url_is_invalid")
        );
      },
    },
    command: {
      validate: (value: string | null) => {
        if (!isStdioTransport) {
          return true;
        }

        const normalized = typeof value === "string" ? value.trim() : "";

        return Boolean(normalized) || t("message.command_is_required");
      },
    },
    transport: {
      required: t("message.type_is_required"),
    },
  };
  const onSubmitForm = (params: McpServerAttributes) => {
    const normalizedUrl =
      typeof params.url === "string" ? params.url.trim() : "";
    const normalizedCommand =
      typeof params.command === "string" ? params.command.trim() : "";
    const normalizedCwd =
      typeof params.cwd === "string" ? params.cwd.trim() : "";
    const normalizedArgs = Array.isArray(params.args)
      ? params.args.map((arg) => arg.trim()).filter(Boolean)
      : [];
    const payload: McpServerAttributes = {
      ...params,
      name: params.name.trim(),
      url:
        params.transport === McpServerTransport.http
          ? normalizedUrl || null
          : null,
      command:
        params.transport === McpServerTransport.stdio
          ? normalizedCommand || null
          : null,
      args:
        params.transport === McpServerTransport.stdio
          ? normalizedArgs.length
            ? normalizedArgs
            : null
          : null,
      cwd:
        params.transport === McpServerTransport.stdio
          ? normalizedCwd || null
          : null,
      credential:
        params.transport === McpServerTransport.http
          ? params.credential || null
          : null,
    };

    if (mcpServer) {
      updateMcpServer({ id: mcpServer.id, params: payload });
    } else {
      createMcpServer(payload);
    }
  };

  useEffect(() => {
    if (mcpServer) {
      reset({
        name: mcpServer.name,
        enabled: mcpServer.enabled,
        transport: mcpServer.transport,
        url: mcpServer.url || "",
        command: mcpServer.command || "",
        args: mcpServer.args || [],
        cwd: mcpServer.cwd || "",
        credential: mcpServer.credential || null,
      });
    } else {
      reset({
        name: "",
        enabled: true,
        transport: McpServerTransport.http,
        url: "",
        command: "",
        args: [],
        cwd: "",
        credential: null,
      });
    }
  }, [mcpServer, reset]);

  useEffect(() => {
    if (isStdioTransport && credentialValue) {
      setValue("credential", null, { shouldDirty: true });
    }
  }, [credentialValue, isStdioTransport, setValue]);

  return (
    <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          <ContentItem>
            <TextField
              label={t("label.name")}
              error={!!errors.name}
              required
              autoFocus
              helperText={errors.name ? errors.name.message : null}
              {...register("name", validationRules.name)}
            />
          </ContentItem>
          <ContentItem>
            <Controller
              name="transport"
              control={control}
              rules={validationRules.transport}
              render={({ field }) => (
                <TextField
                  select
                  required
                  label={t("label.transport")}
                  error={!!errors.transport}
                  helperText={
                    errors.transport ? errors.transport.message : null
                  }
                  {...field}
                >
                  {Object.values(McpServerTransport).map((transport) => (
                    <MenuItem key={transport} value={transport}>
                      {t(`label.${transport}`, {
                        defaultValue: transport.toUpperCase(),
                      })}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </ContentItem>
          {isHttpTransport ? (
            <>
              <ContentItem>
                <TextField
                  label={t("label.url")}
                  error={!!errors.url}
                  required
                  helperText={errors.url ? errors.url.message : null}
                  {...register("url", validationRules.url)}
                />
              </ContentItem>
              <ContentItem>
                <Controller
                  name="credential"
                  control={control}
                  render={({ field }) => {
                    const { onChange, ...restField } = field;

                    return (
                      <AutoCompleteEntitySelect<Credential, "name", false>
                        entity={EntityType.CREDENTIAL}
                        format={Format.BASIC}
                        searchFields={["name"]}
                        labelKey="name"
                        label={t("label.credential")}
                        multiple={false}
                        onChange={(_event, selected) =>
                          onChange(selected?.id || null)
                        }
                        enableEntityAddButton
                        {...restField}
                      />
                    );
                  }}
                />
              </ContentItem>
            </>
          ) : null}
          {isStdioTransport ? (
            <>
              <ContentItem>
                <TextField
                  label={t("label.command")}
                  error={!!errors.command}
                  required
                  helperText={errors.command ? errors.command.message : null}
                  {...register("command", validationRules.command)}
                />
              </ContentItem>
              <ContentItem>
                <Controller
                  name="args"
                  control={control}
                  render={({ field }) => (
                    <MultipleInput
                      label={t("label.args")}
                      value={field.value ?? []}
                      onChange={field.onChange}
                      minInput={1}
                      fullWidth={true}
                    />
                  )}
                />
              </ContentItem>
              <ContentItem>
                <TextField label={t("label.cwd")} {...register("cwd")} />
              </ContentItem>
            </>
          ) : null}
          <ContentItem>
            <Controller
              name="enabled"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch {...field} checked={field.value} />}
                  label={t("label.enabled")}
                />
              )}
            />
          </ContentItem>
        </ContentContainer>
      </form>
    </Wrapper>
  );
};

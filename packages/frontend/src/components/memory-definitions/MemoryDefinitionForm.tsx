/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MemoryScope } from "@hexabot-ai/types";
import type { MemoryDefinition } from "@hexabot-ai/types";
import { FormHelperText, MenuItem, TextField } from "@mui/material";
import Grid from "@mui/material/Grid";
import { FC, Fragment, useEffect } from "react";
import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import {
  JsonSchemaObjectBuilder,
  SchemaNodeForm,
  fromJsonSchema,
  makeDefaultSchemaNode,
  toJsonSchema,
} from "@/app-components/inputs/JsonSchemaObjectBuilder";
import { useCreate } from "@/hooks/crud/useCreate";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";
import { validateJsonSchema } from "@/utils/jsonSchemaValidation";
import { slugify } from "@/utils/string";

type MemoryDefinitionFormValues = {
  name: string;
  slug: string;
  scope: MemoryScope;
  ttlSeconds: number | null;
  schema: SchemaNodeForm;
};
type MemoryDefinitionAttributes =
  EntityAttributes<EntityType.MEMORY_DEFINITION>;

const buildDefaultSchema = () => makeDefaultSchemaNode("object");

export const MemoryDefinitionForm: FC<ComponentFormProps<MemoryDefinition>> = ({
  data: { defaultValues: memoryDefinition },
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
    onSuccess: (data: MemoryDefinition) => {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createMemoryDefinition } = useCreate(
    EntityType.MEMORY_DEFINITION,
    options,
  );
  const { mutate: updateMemoryDefinition } = useUpdate(
    EntityType.MEMORY_DEFINITION,
    options,
  );
  const form = useForm<MemoryDefinitionFormValues>({
    defaultValues: {
      name: "",
      slug: "",
      scope: MemoryScope.global,
      ttlSeconds: null,
      schema: buildDefaultSchema(),
    },
  });
  const {
    control,
    register,
    setValue,
    reset,
    setError,
    clearErrors,
    formState: { errors },
    handleSubmit,
  } = form;
  const schemaError = errors.schema as { message?: string } | undefined;
  const schemaValue = useWatch({ control, name: "schema" });
  const nameRegister = register("name", {
    required: t("message.name_is_required"),
  });
  const slugRegister = register("slug", {
    required: t("message.slug_is_required"),
    pattern: {
      value: /^[a-z0-9_]+$/,
      message: t("message.slug_is_invalid"),
    },
  });
  const onSubmitForm = (params: MemoryDefinitionFormValues) => {
    const name = params.name.trim();
    const schemaNode: SchemaNodeForm = { ...params.schema, title: name };
    const jsonSchema = toJsonSchema(schemaNode);
    const invalidSchemaMessage = t("message.schema_is_invalid", {
      defaultValue: "Invalid JSON schema.",
    });

    try {
      const schemaValidation = validateJsonSchema(jsonSchema);

      if (!schemaValidation.valid) {
        const schemaErrorMessage =
          schemaValidation.errors[0]?.stack ?? invalidSchemaMessage;

        setError("schema", { type: "manual", message: schemaErrorMessage });
        toast.error(invalidSchemaMessage);

        return;
      }
    } catch (error) {
      const schemaErrorMessage =
        error instanceof Error ? error.message : invalidSchemaMessage;

      setError("schema", { type: "manual", message: schemaErrorMessage });
      toast.error(invalidSchemaMessage);

      return;
    }

    clearErrors("schema");
    const payload: MemoryDefinitionAttributes = {
      name,
      slug: params.slug.trim(),
      scope: params.scope,
      schema: jsonSchema,
      ttlSeconds: params.ttlSeconds ?? null,
    };

    if (memoryDefinition?.id) {
      updateMemoryDefinition({ id: memoryDefinition.id, params: payload });
    } else {
      createMemoryDefinition(payload);
    }
  };

  useEffect(() => {
    if (schemaError?.message) {
      clearErrors("schema");
    }
  }, [schemaValue, schemaError?.message, clearErrors]);

  useEffect(() => {
    if (memoryDefinition) {
      const schemaNode = fromJsonSchema(memoryDefinition.schema);

      reset({
        name: memoryDefinition.name,
        slug: memoryDefinition.slug,
        scope: memoryDefinition.scope,
        ttlSeconds: memoryDefinition.ttlSeconds ?? null,
        schema: { ...schemaNode, title: memoryDefinition.name },
      });
    } else {
      reset({
        name: "",
        slug: "",
        scope: MemoryScope.global,
        ttlSeconds: null,
        schema: buildDefaultSchema(),
      });
    }
  }, [memoryDefinition, reset]);

  return (
    <FormProvider {...form}>
      <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
        <form onSubmit={handleSubmit(onSubmitForm)}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <ContentContainer>
                <ContentItem>
                  <TextField
                    label={t("label.name")}
                    error={!!errors.name}
                    required
                    autoFocus
                    helperText={errors.name ? errors.name.message : null}
                    {...nameRegister}
                    onChange={(event) => {
                      nameRegister.onChange(event);
                      setValue("schema.title", event.target.value, {
                        shouldDirty: true,
                      });
                      if (!memoryDefinition) {
                        setValue("slug", slugify(event.target.value));
                      }
                    }}
                  />
                </ContentItem>
                <ContentItem>
                  <TextField
                    label={t("label.slug")}
                    error={!!errors.slug}
                    required
                    helperText={errors.slug ? errors.slug.message : null}
                    {...slugRegister}
                  />
                </ContentItem>
                <ContentItem>
                  <Controller
                    control={control}
                    name="scope"
                    rules={{ required: t("message.scope_is_required") }}
                    render={({ field }) => (
                      <TextField
                        select
                        label={t("label.scope")}
                        error={!!errors.scope}
                        required
                        helperText={errors.scope ? errors.scope.message : null}
                        {...field}
                      >
                        {Object.values(MemoryScope).map((scope) => (
                          <MenuItem key={scope} value={scope}>
                            {t(`label.${scope}`)}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </ContentItem>
                <ContentItem>
                  <Controller
                    control={control}
                    name="ttlSeconds"
                    rules={{
                      validate: (value) => {
                        if (value == null) {
                          return true;
                        }

                        if (!Number.isInteger(value)) {
                          return t("message.ttl_seconds_invalid");
                        }

                        return value > 0 || t("message.ttl_seconds_min");
                      },
                    }}
                    render={({ field }) => (
                      <TextField
                        label={t("label.ttl_seconds")}
                        error={!!errors.ttlSeconds}
                        type="number"
                        slotProps={{ htmlInput: { min: 1, step: 1 } }}
                        helperText={
                          errors.ttlSeconds ? errors.ttlSeconds.message : null
                        }
                        value={field.value ?? ""}
                        name={field.name}
                        onBlur={field.onBlur}
                        inputRef={field.ref}
                        onChange={(event) => {
                          const raw = event.target.value;

                          field.onChange(raw === "" ? null : Number(raw));
                        }}
                      />
                    )}
                  />
                </ContentItem>
              </ContentContainer>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <ContentContainer>
                <ContentItem>
                  <JsonSchemaObjectBuilder
                    name="schema"
                    label={t("label.schema")}
                    hideTitle={true}
                    hideDescription={false}
                  />
                  {schemaError?.message && (
                    <FormHelperText error>{schemaError.message}</FormHelperText>
                  )}
                </ContentItem>
              </ContentContainer>
            </Grid>
          </Grid>
        </form>
      </Wrapper>
    </FormProvider>
  );
};

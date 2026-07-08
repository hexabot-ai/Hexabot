/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Credential } from "@hexabot-ai/types";
import { TextField } from "@mui/material";
import { FC, Fragment, useEffect } from "react";
import { useForm } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import { useCreate } from "@/hooks/crud/useCreate";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";

type CredentialWithValue = Credential & {
  value?: string;
};

type CredentialAttributes = EntityAttributes<EntityType.CREDENTIAL>;

export const CredentialForm: FC<ComponentFormProps<Credential>> = ({
  data: { defaultValues: credential },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const options = {
    onError: () => {
      rest.onError?.();
      toast.error(t("message.internal_server_error"));
    },
    onSuccess(data: Credential) {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createCredential } = useCreate(
    EntityType.CREDENTIAL,
    options,
  );
  const { mutate: updateCredential } = useUpdate(
    EntityType.CREDENTIAL,
    options,
  );
  const {
    reset,
    register,
    formState: { errors },
    handleSubmit,
  } = useForm<CredentialAttributes>({
    defaultValues: {
      name: credential?.name || "",
      value: (credential as CredentialWithValue | null)?.value || "",
    },
  });
  const validationRules = {
    name: {
      required: t("message.name_is_required"),
    },
    value: {
      required: t("message.value_is_required"),
    },
  };
  const onSubmitForm = (params: CredentialAttributes) => {
    if (credential) {
      updateCredential({ id: credential.id, params });
    } else {
      createCredential(params);
    }
  };

  useEffect(() => {
    if (credential) {
      reset({
        name: credential.name,
        value: (credential as CredentialWithValue | null)?.value || "",
      });
    } else {
      reset();
    }
  }, [credential, reset]);

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
            <TextField
              label={t("label.value")}
              error={!!errors.value}
              required
              multiline={true}
              minRows={3}
              helperText={errors.value ? errors.value.message : null}
              {...register("value", validationRules.value)}
            />
          </ContentItem>
        </ContentContainer>
      </form>
    </Wrapper>
  );
};

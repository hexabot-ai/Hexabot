/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Language } from "@hexabot-ai/types";
import { FormControlLabel, Switch, TextField } from "@mui/material";
import { FC, Fragment, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import { useCreate } from "@/hooks/crud/useCreate";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";

type LanguageAttributes = EntityAttributes<EntityType.LANGUAGE>;

export const LanguageForm: FC<ComponentFormProps<Language>> = ({
  data: { defaultValues: language },
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
    onSuccess(data: Language) {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createLanguage } = useCreate(EntityType.LANGUAGE, options);
  const { mutate: updateLanguage } = useUpdate(EntityType.LANGUAGE, options);
  const {
    reset,
    register,
    formState: { errors },
    handleSubmit,
    control,
  } = useForm<LanguageAttributes>({
    defaultValues: {
      title: language?.title || "",
      code: language?.code || "",
      isRTL: language?.isRTL || false,
    },
  });
  const validationRules = {
    title: {
      required: t("message.title_is_required"),
    },
    code: {
      required: t("message.code_is_required"),
    },
  };
  const onSubmitForm = (params: LanguageAttributes) => {
    if (language) {
      updateLanguage({ id: language.id, params });
    } else {
      createLanguage(params);
    }
  };

  useEffect(() => {
    if (language) {
      reset({
        title: language.title,
        code: language.code,
        isRTL: language.isRTL,
      });
    } else {
      reset();
    }
  }, [language, reset]);

  return (
    <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          <ContentItem>
            <TextField
              label={t("label.title")}
              error={!!errors.title}
              {...register("title", validationRules.title)}
              autoFocus
              helperText={errors.title ? errors.title.message : null}
            />
          </ContentItem>
          <ContentItem>
            <TextField
              label={t("label.code")}
              error={!!errors.code}
              {...register("code", validationRules.code)}
              helperText={errors.code ? errors.code.message : null}
            />
          </ContentItem>
          <ContentItem>
            <Controller
              name="isRTL"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch {...field} checked={field.value} />}
                  label={t("label.is_rtl")}
                />
              )}
            />
          </ContentItem>
        </ContentContainer>
      </form>
    </Wrapper>
  );
};

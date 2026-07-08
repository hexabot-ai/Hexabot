/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Language, Translation } from "@hexabot-ai/types";
import { FormLabel, TextField, Typography } from "@mui/material";
import Grid from "@mui/material/Grid";
import { FC, Fragment } from "react";
import { Controller, ControllerRenderProps, useForm } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import { useFind } from "@/hooks/crud/useFind";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";

type TranslationAttributes = EntityAttributes<EntityType.TRANSLATION>;

interface TranslationInputProps {
  field: ControllerRenderProps<TranslationAttributes>;
  language: Language;
}

const TranslationInput: React.FC<TranslationInputProps> = ({
  field,
  language: { isRTL, title },
}) => (
  <TextField
    dir={isRTL ? "rtl" : "ltr"}
    label={
      <Grid container dir="ltr">
        <Grid>{title}</Grid>
      </Grid>
    }
    minRows={3}
    inputRef={field.ref}
    multiline={true}
    {...field}
  />
);

export const TranslationForm: FC<ComponentFormProps<Translation>> = ({
  data: { defaultValues: translation },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const { data: languages } = useFind(
    { entity: EntityType.LANGUAGE },
    {
      hasCount: false,
    },
  );
  const { mutate: updateTranslation } = useUpdate(EntityType.TRANSLATION, {
    onError: (error: Error) => {
      rest.onError?.();
      toast.error(error);
    },
    onSuccess(data) {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  });
  const { control, handleSubmit } = useForm<TranslationAttributes>({
    defaultValues: {
      translations: translation?.translations,
    },
  });
  const onSubmitForm = (params: TranslationAttributes) => {
    if (translation?.id) updateTranslation({ id: translation.id, params });
  };

  return (
    <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentItem>
          <FormLabel>{t("label.original_text")}</FormLabel>
          <Typography component="p">{translation?.str}</Typography>
        </ContentItem>
        <ContentContainer>
          {languages
            .filter(({ isDefault }) => !isDefault)
            .map((language) => (
              <ContentItem key={language.code}>
                <Controller
                  name={`translations.${language.code as keyof Translation["translations"]}`}
                  control={control}
                  render={({ field }) => (
                    <TranslationInput field={field} language={language} />
                  )}
                />
              </ContentItem>
            ))}
        </ContentContainer>
      </form>
    </Wrapper>
  );
};

TranslationForm.displayName = TranslationForm.name;

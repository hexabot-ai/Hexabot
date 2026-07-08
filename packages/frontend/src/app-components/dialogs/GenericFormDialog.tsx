/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React from "react";

import { FormDialog as Wrapper } from "@/app-components/dialogs";
import { useTranslate } from "@/hooks/useTranslate";
import { TTranslationKeys } from "@/i18n/i18n.types";
import {
  DialogProps,
  ExtractFormProps,
  FormButtonsProps,
  TPayload,
} from "@/types/common/dialogs.types";

type GenericFormDialogProps<T extends (arg: { data: any }) => unknown> =
  FormButtonsProps &
    DialogProps<ExtractFormProps<T>, any> & {
      Form: React.ElementType;
      addText?: TTranslationKeys;
      editText?: TTranslationKeys;
    } & { payload: TPayload<T> | null };

export const GenericFormDialog = ({
  Form,
  payload: data,
  editText,
  addText,
  ...rest
}: GenericFormDialogProps<typeof Form>) => {
  const { t } = useTranslate();
  const translationKey = data?.defaultValues ? editText : addText;

  return (
    <Form
      onSuccess={(result?: unknown) => {
        rest.onClose(result ?? true);
      }}
      WrapperProps={{
        title: translationKey && t(translationKey),
        ...rest,
      }}
      {...{ data, Wrapper }}
    />
  );
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type Content, type ContentType } from "@hexabot-ai/types";
import { isMatch } from "lodash";
import { FC, Fragment, useMemo, useState } from "react";

import {
  getSchemaDefaults,
  JsonSchemaForm,
} from "@/app-components/inputs/JsonSchemaForm";
import { useCreate } from "@/hooks/crud/useCreate";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import { ComponentFormProps } from "@/types/common/dialogs.types";

import { buildContentParams, buildContentSchema } from "./content.schema.utils";

export type ContentFormData = Record<string, unknown> & {
  contentType: string;
  status: boolean;
  title: string;
};

export const ContentForm: FC<ComponentFormProps<Content, ContentType>> = ({
  data: { defaultValues: content, presetValues: contentType },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const contentTypeId = content?.contentType ?? contentType?.id ?? "";
  const schema = buildContentSchema(contentType?.schema);
  const defaultFormData = useMemo(
    () =>
      ({
        contentType: contentTypeId,
        ...getSchemaDefaults(schema),
        ...content,
        ...content?.properties,
      }) as ContentFormData,
    [content, contentTypeId],
  );
  const [formData, setFormData] = useState<ContentFormData>(defaultFormData);
  const params = useMemo(
    () => buildContentParams(formData),
    [formData, schema],
  );
  const [hasVisibleErrors, setHasVisibleErrors] = useState(false);
  const { mutate: createContent } = useCreate(EntityType.CONTENT);
  const { mutate: updateContent } = useUpdate(EntityType.CONTENT);
  const options = {
    onError: (error: Error) => {
      rest.onError?.();
      toast.error(error);
    },
    onSuccess: () => {
      rest.onSuccess?.();
      toast.success(t("message.success_save"));
    },
  };
  const onSubmitForm = () => {
    if (hasVisibleErrors) {
      return;
    }

    if (content) {
      updateContent(
        {
          id: content.id,
          params,
        },
        options,
      );
    } else if (contentType) {
      createContent(
        {
          ...params,
          contentType: contentType.id,
        },
        options,
      );
    } else {
      throw new Error("Content Type must be passed to the dialog form.");
    }
  };
  const canSubmit = useMemo(() => {
    return (
      hasVisibleErrors ||
      isMatch(defaultFormData, formData) ||
      Boolean(WrapperProps?.confirmButtonProps?.disabled)
    );
  }, [formData, hasVisibleErrors, WrapperProps?.confirmButtonProps?.disabled]);

  return (
    <Wrapper
      onSubmit={onSubmitForm}
      {...WrapperProps}
      confirmButtonProps={{
        ...WrapperProps?.confirmButtonProps,
        disabled: canSubmit,
      }}
    >
      <JsonSchemaForm<ContentFormData>
        schema={schema}
        formData={formData}
        onFormDataChange={setFormData}
        onVisibleErrorsChange={setHasVisibleErrors}
        enableJsonataTextWidget={false}
        idPrefix={content ? `content-${content.id}` : "content-new"}
      />
    </Wrapper>
  );
};

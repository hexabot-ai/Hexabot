/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Role } from "@hexabot-ai/types";
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

type RoleAttributes = EntityAttributes<EntityType.ROLE>;

export const RoleForm: FC<ComponentFormProps<Role>> = ({
  data: { defaultValues: role },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const options = {
    onError: (error: Error) => {
      toast.error(error);
    },
    onSuccess(data: Role) {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createRole } = useCreate(EntityType.ROLE, options);
  const { mutate: updateRole } = useUpdate(EntityType.ROLE, options);
  const {
    handleSubmit,
    reset,
    register,
    formState: { errors },
  } = useForm<RoleAttributes>({
    defaultValues: { name: "" },
  });
  const validationRules = {
    name: {
      required: t("message.name_is_required"),
    },
  };
  const onSubmitForm = (params: RoleAttributes) => {
    if (role) {
      updateRole({ id: role.id, params });
    } else {
      createRole(params);
    }
  };

  useEffect(() => {
    if (role) {
      reset({
        name: role.name,
      });
    } else {
      reset();
    }
  }, [role, reset]);

  return (
    <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          <ContentItem>
            <TextField
              label={t("placeholder.name")}
              error={!!errors.name}
              required
              autoFocus
              helperText={errors.name ? errors.name.message : null}
              {...register("name", validationRules.name)}
            />
          </ContentItem>
        </ContentContainer>
      </form>
    </Wrapper>
  );
};

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
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";
import { User } from "@/types/user.types";

import { UserRolesField } from "./UserRolesField";

type UserAttributes = EntityAttributes<EntityType.USER>;

export const EditUserForm: FC<ComponentFormProps<User, Role[]>> = ({
  data: { defaultValues: user, presetValues: roles },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const { mutate: updateUser } = useUpdate(EntityType.USER, {
    onError: (error) => {
      rest.onError?.();
      toast.error(error);
    },
    onSuccess() {
      rest.onSuccess?.();
      toast.success(t("message.success_save"));
    },
  });
  const {
    reset,
    control,
    formState: { errors },
    handleSubmit,
  } = useForm<UserAttributes>({
    defaultValues: { roles: roles?.map((role) => role.id) },
  });
  const validationRules = {
    roles: {
      required: t("message.roles_is_required"),
    },
  };
  const onSubmitForm = (params: UserAttributes) => {
    if (user?.id) {
      updateUser({
        id: user.id,
        params,
      });
    }
  };

  useEffect(() => {
    if (user) {
      reset({ roles: user.roles });
    }
  }, [reset, user]);

  return (
    <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          <ContentItem>
            <TextField
              disabled
              label={t("label.full_name")}
              value={user?.fullName}
              slotProps={{
                input: {
                  readOnly: true,
                },
              }}
            />
          </ContentItem>
          <ContentItem>
            <UserRolesField
              control={control}
              rules={validationRules.roles}
              error={errors.roles}
              defaultValue={roles?.map(({ id }) => id) || []}
              autoFocus
            />
          </ContentItem>
        </ContentContainer>
      </form>
    </Wrapper>
  );
};

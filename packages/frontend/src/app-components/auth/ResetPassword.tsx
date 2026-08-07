/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Button } from "@mui/material";
import Grid from "@mui/material/Grid";
import {
  ChevronRight as KeyboardArrowRightIcon,
  Key as KeyIcon,
  Repeat2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { Link as RouterLink } from "react-router";

import { useApiClientMutation } from "@/hooks/useApiClient";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { useValidationRules } from "@/hooks/useValidationRules";
import { Title } from "@/layout/content/Title";

import { PublicContentWrapper } from "../../components/anonymous/PublicContentWrapper";
import { ContentContainer } from "../dialogs";
import { Adornment } from "../inputs/Adornment";
import { PasswordInput } from "../inputs/PasswordInput";

interface ResetPasswordAttributes {
  password: string;
  password2: string;
}

export const ResetPassword = () => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const rules = useValidationRules();
  const validationRules = {
    password: {
      ...rules.password,
      required: t("message.password_is_required"),
    },
    password2: {
      ...rules.password2,
      required: t("message.password_is_required"),
    },
  };
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordAttributes>({
    defaultValues: { password: "", password2: "" },
  });
  const { query, replace } = useAppRouter();
  const queryToken = Array.isArray(query.token)
    ? query.token.at(-1)
    : query.token;
  const { mutate: resetPassword } = useApiClientMutation("resetPassword", {
    onSuccess: () => {
      toast.success(t("message.reset_newpass_success"));
      replace("/login");
    },
    onError: () => {
      toast.error(t("message.server_error"));
    },
  });
  const onSubmitForm = (data: ResetPasswordAttributes) => {
    queryToken && resetPassword([queryToken, data]);
  };

  return (
    <PublicContentWrapper>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          <Title title={t("title.reset_password")} Icon={Repeat2} />
          <PasswordInput
            label={t("label.password")}
            error={!!errors.password}
            required
            slotProps={{
              input: {
                startAdornment: <Adornment Icon={KeyIcon} />,
              },
            }}
            helperText={errors.password ? errors.password.message : null}
            {...register("password", validationRules.password)}
          />
          <PasswordInput
            label={t("placeholder.password2")}
            error={!!errors.password2}
            required
            slotProps={{
              input: {
                startAdornment: <Adornment Icon={KeyIcon} />,
              },
            }}
            helperText={errors.password2 ? errors.password2.message : null}
            {...register("password2", validationRules.password2)}
          />
          <Grid container direction="column" gap={1} mt={2}>
            <Button
              type="submit"
              color="primary"
              variant="contained"
              endIcon={<KeyboardArrowRightIcon size={14} />}
              onClick={handleSubmit(onSubmitForm)}
            >
              {t("button.submit")}
            </Button>
            <Button component={RouterLink} to="/login" variant="outlined">
              {t("button.cancel")}
            </Button>
          </Grid>
        </ContentContainer>
      </form>
    </PublicContentWrapper>
  );
};

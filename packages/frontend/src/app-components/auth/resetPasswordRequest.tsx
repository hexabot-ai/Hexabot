/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Button, TextField } from "@mui/material";
import Grid from "@mui/material/Grid";
import {
  Mail as EmailIcon,
  ChevronRight as KeyboardArrowRightIcon,
  SendHorizontal,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { Link as RouterLink } from "react-router";

import { useApiClientMutation } from "@/hooks/useApiClient";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { Title } from "@/layout/content/Title";

import { PublicContentWrapper } from "../../components/anonymous/PublicContentWrapper";
import { ContentContainer } from "../dialogs";
import { Adornment } from "../inputs/Adornment";

interface ResetPasswordRequestAttributes {
  email: string;
}
export const ResetPasswordRequest = () => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordRequestAttributes>({
    defaultValues: { email: "" },
  });
  const { mutate: requestReset } = useApiClientMutation(
    "requestResetPassword",
    {
      onSuccess: () => {
        toast.success(t("message.reset_success"));
      },
      onError: () => {
        toast.error(t("message.server_error"));
      },
    },
  );
  const onSubmitForm = (data: ResetPasswordRequestAttributes) => {
    requestReset([data]);
  };

  return (
    <PublicContentWrapper>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          <Title title={t("title.reset_password")} Icon={SendHorizontal} />
          <TextField
            label={t("label.email")}
            error={!!errors.email}
            required
            autoFocus
            slotProps={{
              input: {
                startAdornment: <Adornment Icon={EmailIcon} />,
              },
            }}
            helperText={errors.email ? errors.email.message : null}
            {...register("email", {
              required: t("message.email_is_required"),
            })}
          />
          <Grid container direction="column" gap={1} mt={2}>
            <Button
              variant="contained"
              type="submit"
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

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Role } from "@hexabot-ai/types";
import { Button, Link } from "@mui/material";
import Grid from "@mui/material/Grid";
import {
  Controller,
  type Control,
  type ControllerProps,
  type FieldValues,
  type Path,
  type PathValue,
} from "react-hook-form";

import AutoCompleteEntitySelect from "@/app-components/inputs/AutoCompleteEntitySelect";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";

type UserRolesRules = {
  required?: string;
  validate?: (value?: string[]) => string | true;
};
type UserRolesFieldProps<T extends FieldValues & { roles: string[] }> = {
  control: Control<T>;
  rules: UserRolesRules;
  error?: { message?: string };
  defaultValue?: string[];
  autoFocus?: boolean;
};

/**
 * The roles select of the user forms, with a link to manage the roles. It
 * stores the ids of the selected roles in the `roles` field.
 */
export const UserRolesField = <T extends FieldValues & { roles: string[] }>({
  control,
  rules,
  error,
  defaultValue,
  autoFocus,
}: UserRolesFieldProps<T>) => {
  const { t } = useTranslate();

  return (
    <Grid container gap={3}>
      <Grid size="grow">
        <Controller
          name={"roles" as Path<T>}
          rules={rules as ControllerProps<T, Path<T>>["rules"]}
          control={control}
          {...(defaultValue && {
            defaultValue: defaultValue as PathValue<T, Path<T>>,
          })}
          render={({ field }) => {
            const { onChange, ...rest } = field;

            return (
              <AutoCompleteEntitySelect<Role>
                {...(autoFocus && { autoFocus })}
                searchFields={["name"]}
                entity={EntityType.ROLE}
                format={Format.BASIC}
                labelKey="name"
                label={t("label.roles")}
                multiple={true}
                {...field}
                error={!!error}
                helperText={error ? error.message : null}
                onChange={(_event, selected) =>
                  onChange(selected.map(({ id }) => id))
                }
                {...rest}
              />
            );
          }}
        />
      </Grid>
      <Grid size="auto" alignContent="end">
        <Link href="/roles">
          <Button variant="contained" size="small">
            {t("button.manage")}
          </Button>
        </Link>
      </Grid>
    </Grid>
  );
};

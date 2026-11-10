/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Box,
  Button,
  Grid,
  MenuItem,
  Popover,
  TextField,
  TextFieldProps,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { ListFilter } from "lucide-react";
import { useState } from "react";
import type { Path, PathValue } from "react-hook-form";

import type { FlowTypeInfo } from "@/components/visual-editor/v4/components/main/FlowsDrawer/types";
import { useTranslate } from "@/hooks/useTranslate";
import { Format } from "@/services/types";
import type { IEntityMapTypes, THook } from "@/types/base.types";

import { BadgeWithTitle, type BadgeWithTitleProps } from "../displays/Badge";
import AutoCompleteEntitySelect, {
  type AutoCompleteEntitySelectProps,
} from "../inputs/AutoCompleteEntitySelect";

type filterDynamicFields<
  E extends keyof IEntityMapTypes,
  F extends Format,
  A extends { format?: Format } = { format?: F },
  C = THook<{ entity: E; format: F }>["current"],
> = {
  [Field in Path<C>]: {
    field: Field;
    value?: PathValue<C, Field>;
    idKey?: keyof C;
    sortKey?: keyof C;
    labelKey?: keyof C;
    onChange?: (value?: PathValue<C, Field>) => void;
  };
}[Path<C>] &
  A;

type EntityField = {
  [E in keyof IEntityMapTypes]: { entity: E } & (
    | filterDynamicFields<E, Format.BASIC>
    | filterDynamicFields<E, Format.BASIC, { format: Format.BASIC }>
    | filterDynamicFields<E, Format.FULL, { format: Format.FULL }>
  );
};

type EnumFilterType = Omit<TextFieldProps, "onChange"> & { type: "enumFilter" };

type EntityFilterType = Omit<
  AutoCompleteEntitySelectProps<any, string, false>,
  "ref" | "format" | "onChange" | "labelKey" | "searchFields" | "value"
> & { type: "entitySelectFilter"; searchFields?: string[] };

export type Filter = ({
  typeInfo?: Record<any, FlowTypeInfo>;
  defaultOption?: BadgeWithTitleProps & { defaultValue?: string };
} & EntityField[keyof EntityField]) &
  (EnumFilterType | EntityFilterType);

const GenericFilters = ({ filters }: { filters?: Filter[] }) =>
  filters?.map(
    ({
      value,
      field,
      idKey,
      format = Format.BASIC,
      entity,
      sortKey,
      labelKey = "",
      typeInfo,
      defaultOption: d = {},
      onChange,
      ...rest
    }) => {
      const { defaultValue, ...bp } = {
        width: "22px",
        height: "22px",
        padding: "2px",
        ...d,
      };

      if (rest.type === "enumFilter")
        return (
          <Grid key={field} flex={1} minWidth="180px">
            <TextField
              select
              value={value || defaultValue}
              onChange={(e) => onChange?.(e.target.value as never)}
              slotProps={{ input: { sx: { height: "2.25rem" } } }}
              {...rest}
            >
              {defaultValue && (
                <MenuItem value={defaultValue}>
                  <BadgeWithTitle {...bp} />
                </MenuItem>
              )}
              {typeInfo &&
                Object.entries(typeInfo).map(([type, { key, ...r }]) => (
                  <MenuItem key={key} value={type}>
                    <BadgeWithTitle {...bp} {...r} title={type} />
                  </MenuItem>
                ))}
            </TextField>
          </Grid>
        );
      const renderItem = (e: any) =>
        typeInfo ? (
          <BadgeWithTitle
            {...bp}
            {...typeInfo?.[e[labelKey]]}
            title={e[field]}
            labelKey={undefined}
          />
        ) : (
          <Typography noWrap>{e[labelKey]}</Typography>
        );

      return (
        <Grid key={field} flex={1} minWidth="180px">
          <AutoCompleteEntitySelect<any, string, false>
            idKey={idKey?.toString()}
            sortKey={sortKey?.toString()}
            labelKey={labelKey}
            entity={entity}
            format={format}
            value={value}
            searchFields={rest.searchFields || []}
            size="medium"
            multiple={false}
            renderValue={(e) => <Box p="2px">{renderItem(e)}</Box>}
            renderOption={(props, e) => <li {...props}>{renderItem(e)}</li>}
            onChange={(_, v) => onChange?.(v?.[field])}
            {...rest}
          />
        </Grid>
      );
    },
  );
const collapseBreakpoint = (n: number) => 720 + n * 190;
const filtersButtonSx = (t: Theme) => ({
  width: t.spacing(4.5),
  minWidth: t.spacing(4.5),
  p: 0,
  "& .MuiButton-startIcon": { m: 0 },
});
const filtersPopoverSx = (t: Theme) => ({
  width: `min(${t.spacing(45)}, calc(100vw - ${t.spacing(4)}))`,
  p: 2,
  mt: 1,
});

export const ResponsiveGenericFilters = ({
  filters,
}: {
  filters: Filter[];
}) => {
  const { t } = useTranslate();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const isCollapsed = useMediaQuery(
    (theme: Theme) =>
      theme.breakpoints.down(collapseBreakpoint(filters.length)),
    { noSsr: true },
  );
  const label = t("button.filters");

  return !isCollapsed ? (
    <GenericFilters filters={filters} />
  ) : (
    <>
      <Tooltip title={label}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ListFilter size={18} />}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={Boolean(anchorEl)}
          sx={filtersButtonSx}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        />
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          paper: { role: "dialog", "aria-label": label, sx: filtersPopoverSx },
        }}
      >
        <Box display="flex" flexDirection="column" gap={1.5}>
          <GenericFilters filters={filters} />
        </Box>
      </Popover>
    </>
  );
};

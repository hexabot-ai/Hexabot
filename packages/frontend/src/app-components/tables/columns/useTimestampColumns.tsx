/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { GridColDef, GridValidRowModel } from "@mui/x-data-grid";
import { useMemo } from "react";

import { useTranslate } from "@/hooks/useTranslate";
import { getDateTimeFormatter } from "@/utils/date";

const TIMESTAMP_COLUMN_WIDTH = 140;

/**
 * Returns the standard `createdAt` / `updatedAt` DataGrid columns shared by
 * every entity list screen. Spread the result into a `columns` array, e.g.
 * `[...baseColumns, ...useTimestampColumns<Label>(), actionColumns]`.
 *
 * The returned array is memoized and only changes when the active locale
 * changes, so it is safe to include in downstream `useMemo` dep arrays.
 */
export const useTimestampColumns = <T extends GridValidRowModel>(
  filter?: "createdAt" | "updatedAt",
): GridColDef<T>[] => {
  const { t } = useTranslate();

  return useMemo<GridColDef<T>[]>(() => {
    const all: GridColDef<T>[] = [
      {
        width: TIMESTAMP_COLUMN_WIDTH,
        field: "createdAt",
        headerName: t("label.createdAt"),
        disableColumnMenu: true,
        resizable: false,
        headerAlign: "left",
        valueGetter: (value: Date) =>
          t("datetime.created_at", getDateTimeFormatter(value)),
      },
      {
        width: TIMESTAMP_COLUMN_WIDTH,
        field: "updatedAt",
        headerName: t("label.updatedAt"),
        disableColumnMenu: true,
        resizable: false,
        headerAlign: "left",
        valueGetter: (value: Date) =>
          t("datetime.updated_at", getDateTimeFormatter(value)),
      },
    ];

    return filter ? all.filter((c) => c.field === filter) : all;
  }, [t, filter]);
};

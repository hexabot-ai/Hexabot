/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Chip } from "@mui/material";
import Grid from "@mui/material/Grid";
import {
  DataGridProps,
  GridColDef,
  GridRowSelectionModel,
} from "@mui/x-data-grid";
import { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useDataGridProps } from "@/hooks/useDataGridProps";
import { useTranslate } from "@/hooks/useTranslate";
import { TTranslationKeys } from "@/i18n/i18n.types";
import { PageHeader } from "@/layout/content/PageHeader";
import { IFindConfigProps, THook } from "@/types/base.types";
import {
  SearchHookOptions,
  SearchPayload,
  TParamItem,
} from "@/types/search.types";

import {
  ButtonActionsGroup,
  ButtonActionsGroupProps,
} from "../buttons/ButtonActionsGroup";
import { FilterTextfield } from "../inputs/FilterTextfield";

import { DataGrid } from "./DataGrid";
import { type Filter, GenericFilters } from "./GenericFilters";

export const GenericDataGrid = <
  TP extends THook["params"],
  TE extends TP["entity"],
  F extends TP["format"],
>({
  entity,
  buttons,
  columns,
  headerIcon,
  searchParams,
  initialSortState,
  initialPaginationState = {
    page: 0,
    pageSize: 10,
  },
  format,
  headerI18nTitle,
  headerTitleChip,
  headerLeftButtons,
  footerControls,
  selectionChangeHandler,
  filters,
  hasTextFilter = true,
  ...restDataGridProps
}: {
  entity: TE;
  buttons?: ButtonActionsGroupProps["buttons"];
  headerIcon?: LucideIcon;
  searchParams: TParamItem<TE> &
    SearchHookOptions & {
      getFindParams?: (searchPayload: SearchPayload<TE>) => SearchPayload<TE>;
    };
  format?: F;
  columns: GridColDef<THook<{ entity: TE; format: F }>["current"]>[];
  headerI18nTitle?: TTranslationKeys;
  headerTitleChip?: string;
  headerLeftButtons?: React.ReactElement;
  footerControls?: ReactNode;
  selectionChangeHandler?: (selection: GridRowSelectionModel) => void;
  filters?: Filter[];
  hasTextFilter?: boolean;
} & Pick<IFindConfigProps<TE>, "initialSortState" | "initialPaginationState"> &
  DataGridProps) => {
  const { t } = useTranslate();
  const { dataGridProps, onSearch, searchText } = useDataGridProps(
    {
      entity,
      format: format as any,
    },
    {
      searchParams,
      initialSortState,
      initialPaginationState,
    },
  );

  return (
    <Grid width="100%">
      <Grid container={!!headerI18nTitle} flexDirection="column" gap={3}>
        <PageHeader
          icon={headerIcon}
          title={headerI18nTitle && t(headerI18nTitle)}
          chip={
            headerTitleChip ? (
              <Chip label={headerTitleChip} size="medium" />
            ) : null
          }
          headerLeftButtons={headerLeftButtons}
        >
          <Grid
            gap={1}
            container
            flexWrap="nowrap"
            width="auto"
            justifyContent="end"
          >
            {hasTextFilter ? (
              <FilterTextfield onChange={onSearch} defaultValue={searchText} />
            ) : null}
            {filters?.length ? <GenericFilters filters={filters} /> : null}
            <Grid size="auto" alignContent="end">
              {buttons ? (
                <ButtonActionsGroup entity={entity} buttons={buttons} />
              ) : null}
            </Grid>
          </Grid>
        </PageHeader>
        <Grid container flexDirection="column" gap={1}>
          <DataGrid
            columns={columns}
            {...dataGridProps}
            checkboxSelection={!!selectionChangeHandler}
            onRowSelectionModelChange={selectionChangeHandler}
            {...restDataGridProps}
          />
          {footerControls ? (
            <Grid container justifyContent="flex-end">
              {footerControls}
            </Grid>
          ) : null}
        </Grid>
      </Grid>
    </Grid>
  );
};

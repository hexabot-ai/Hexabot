/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { GridColDef } from "@mui/x-data-grid";
import { UserRound } from "lucide-react";
import { useMemo } from "react";

import { Avatar } from "@/app-components/displays/Avatar";
import { ChipEntity } from "@/app-components/displays/ChipEntity";
import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { useTimestampColumns } from "@/app-components/tables/columns/useTimestampColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { type Filter } from "@/app-components/tables/GenericFilters";
import { useDialogs } from "@/hooks/useDialogs";
import { useQueryState } from "@/hooks/useQueryState";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import { Subscriber } from "@/types/subscriber.types";

import { SubscriberFormDialog } from "./SubscriberFormDialog";

export const Subscribers = () => {
  const { t } = useTranslate();
  const dialogs = useDialogs();
  const timestampColumns = useTimestampColumns<Subscriber>();
  const actionColumns = useActionColumns<Subscriber>(
    EntityType.SUBSCRIBER,
    [
      {
        action: ColumnActionType.Manage_Labels,
        onClick: (row) => {
          dialogs.open(SubscriberFormDialog, { defaultValues: row });
        },
        requires: [Action.UPDATE],
      },
    ],
    t("label.operations"),
  );
  const columns: GridColDef<Subscriber>[] = [
    { field: "id", headerName: "ID" },
    {
      maxWidth: 64,
      field: "avatar",
      resizable: false,
      headerName: "",
      sortable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => <Avatar subscriberId={row.id} size={36} />,
    },
    {
      flex: 1,
      field: "firstName",
      headerName: t("label.first_name"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      flex: 1,
      field: "lastName",
      headerName: t("label.last_name"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      minWidth: 108,
      field: "locale",
      headerName: t("label.locale"),
      disableColumnMenu: true,
      resizable: false,
      headerAlign: "left",
    },
    {
      field: "labels",
      flex: 1,
      headerName: t("label.labels"),
      sortable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) =>
        row.labels.map((label) => (
          <ChipEntity
            id={label}
            key={label}
            field="title"
            entity={EntityType.LABEL}
          />
        )),
      headerAlign: "left",
    },
    {
      maxWidth: 80,
      field: "gender",
      headerName: t("label.gender"),
      disableColumnMenu: true,
      resizable: false,
      headerAlign: "left",
    },
    {
      minWidth: 80,
      field: "channel",
      headerName: t("label.channel"),
      disableColumnMenu: true,
      headerAlign: "left",
      renderCell: ({ row }) => row.channel?.name,
    },
    ...timestampColumns,
    actionColumns,
  ];
  const [id, setId] = useQueryState("id");
  const filters = useMemo<Filter[]>(
    () => [
      {
        entity: EntityType.LABEL,
        type: "entitySelectFilter",
        field: "id",
        value: id,
        label: t("label.labels"),
        labelKey: "title",
        onChange: setId,
      },
    ],
    [setId],
  );

  return (
    <GenericDataGrid
      entity={EntityType.SUBSCRIBER}
      columns={columns}
      headerIcon={UserRound}
      searchParams={{
        $eq: id ? [{ labels: [{ id }] }] : [],
        $or: ["firstName", "lastName"],
        syncUrl: true,
      }}
      headerI18nTitle="title.subscribers"
      filters={filters}
    />
  );
};

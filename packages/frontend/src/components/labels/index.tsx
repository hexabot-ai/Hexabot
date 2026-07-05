/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, Label } from "@hexabot-ai/types";
import { GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { Tag } from "lucide-react";
import { useState } from "react";

import { ConfirmDialogBody } from "@/app-components/dialogs";
import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { useTimestampColumns } from "@/app-components/tables/columns/useTimestampColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { useDelete } from "@/hooks/crud/useDelete";
import { useDeleteMany } from "@/hooks/crud/useDeleteMany";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { LabelFormDialog } from "./LabelFormDialog";

export const Labels = () => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const timestampColumns = useTimestampColumns<Label>();
  const options = {
    onError: () => {
      toast.error(t("message.internal_server_error"));
    },
    onSuccess() {
      toast.success(t("message.item_delete_success"));
    },
  };
  const { mutate: deleteLabel } = useDelete(EntityType.LABEL, options);
  const { mutate: deleteLabels } = useDeleteMany(EntityType.LABEL, options);
  const actionColumns = useActionColumns<Label>(
    EntityType.LABEL,
    [
      {
        action: ColumnActionType.Edit,
        onClick: (row) => {
          dialogs.open(LabelFormDialog, {
            defaultValues: row,
          });
        },
        requires: [Action.UPDATE],
      },
      {
        action: ColumnActionType.Delete,
        onClick: async ({ id }) => {
          const isConfirmed = await dialogs.confirm(ConfirmDialogBody);

          if (isConfirmed) {
            deleteLabel(id);
          }
        },
        requires: [Action.DELETE],
      },
    ],
    t("label.operations"),
  );
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const getEntityFromCache = useGetFromCache(EntityType.LABEL_GROUP);
  const columns: GridColDef<Label>[] = [
    { field: "id", headerName: "ID" },
    {
      flex: 1,
      field: "title",
      headerName: t("label.title"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      minWidth: 110,
      field: "group",
      headerName: t("title.group_label"),
      disableColumnMenu: true,
      headerAlign: "center",
      valueGetter: (groupId) => {
        const group = getEntityFromCache(groupId);

        return group?.name;
      },
    },
    {
      flex: 1,
      field: "name",
      headerName: t("label.name"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      flex: 2,
      field: "description",
      headerName: t("label.description"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    ...timestampColumns,
    actionColumns,
  ];
  const handleSelectionChange = (selection: GridRowSelectionModel) => {
    setSelectedLabels(selection as string[]);
  };

  return (
    <GenericDataGrid
      entity={EntityType.LABEL}
      buttons={[
        {
          permissionAction: Action.CREATE,
          onClick: () => dialogs.open(LabelFormDialog, { defaultValues: null }),
        },
        {
          permissionAction: Action.DELETE,
          onClick: async () => {
            const isConfirmed = await dialogs.confirm(ConfirmDialogBody, {
              mode: "selection",
              count: selectedLabels.length,
            });

            if (isConfirmed) {
              deleteLabels(selectedLabels);
            }
          },
          disabled: !selectedLabels.length,
        },
      ]}
      columns={columns}
      headerIcon={Tag}
      searchParams={{ $or: ["name", "title"], syncUrl: true }}
      headerI18nTitle="title.labels"
      selectionChangeHandler={handleSelectionChange}
    />
  );
};

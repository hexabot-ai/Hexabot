/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import type { MemoryDefinition } from "@hexabot-ai/types";
import { GridColDef } from "@mui/x-data-grid";
import { BrainCircuit, Plus } from "lucide-react";

import { ConfirmDialogBody } from "@/app-components/dialogs";
import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { useTimestampColumns } from "@/app-components/tables/columns/useTimestampColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { useDelete } from "@/hooks/crud/useDelete";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { MemoryDefinitionFormDialog } from "./MemoryDefinitionFormDialog";

export const MemoryDefinitions = () => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const timestampColumns = useTimestampColumns<MemoryDefinition>();
  const { mutate: deleteMemoryDefinition } = useDelete(
    EntityType.MEMORY_DEFINITION,
    {
      onError: () => {
        toast.error(t("message.internal_server_error"));
      },
      onSuccess() {
        toast.success(t("message.item_delete_success"));
      },
    },
  );
  const actionColumns = useActionColumns<MemoryDefinition>(
    EntityType.MEMORY_DEFINITION,
    [
      {
        action: ColumnActionType.Edit,
        onClick: (row) => {
          dialogs.open(
            MemoryDefinitionFormDialog,
            { defaultValues: row },
            { maxWidth: "lg" },
          );
        },
        requires: [Action.UPDATE],
      },
      {
        action: ColumnActionType.Delete,
        onClick: async ({ id }) => {
          const isConfirmed = await dialogs.confirm(ConfirmDialogBody);

          if (isConfirmed) {
            deleteMemoryDefinition(id);
          }
        },
        requires: [Action.DELETE],
      },
    ],
    t("label.operations"),
  );
  const columns: GridColDef<MemoryDefinition>[] = [
    { field: "id", headerName: "ID" },
    {
      flex: 1,
      field: "name",
      headerName: t("label.name"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      flex: 1,
      field: "slug",
      headerName: t("label.slug"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      maxWidth: 140,
      field: "scope",
      headerName: t("label.scope"),
      disableColumnMenu: true,
      headerAlign: "left",
      valueGetter: (value) => (value ? t(`label.${value}` as any) : ""),
    },
    {
      maxWidth: 160,
      field: "ttlSeconds",
      headerName: t("label.ttl_seconds"),
      disableColumnMenu: true,
      headerAlign: "left",
      valueGetter: (value) => value ?? t("label.permanent"),
    },
    ...timestampColumns,
    actionColumns,
  ];

  return (
    <GenericDataGrid
      entity={EntityType.MEMORY_DEFINITION}
      buttons={[
        {
          permissionAction: Action.CREATE,
          children: t("button.add"),
          startIcon: <Plus />,
          onClick: () =>
            dialogs.open(
              MemoryDefinitionFormDialog,
              { defaultValues: null },
              { maxWidth: "lg" },
            ),
        },
      ]}
      columns={columns}
      headerIcon={BrainCircuit}
      searchParams={{ $or: ["name", "slug"], syncUrl: true }}
      headerI18nTitle="title.memory_definitions"
    />
  );
};

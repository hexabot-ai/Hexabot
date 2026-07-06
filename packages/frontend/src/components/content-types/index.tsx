/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import type { ContentType } from "@hexabot-ai/types";
import { GridColDef } from "@mui/x-data-grid";
import { BookOpen } from "lucide-react";

import { ConfirmDialogBody } from "@/app-components/dialogs";
import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { useTimestampColumns } from "@/app-components/tables/columns/useTimestampColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { useDelete } from "@/hooks/crud/useDelete";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { ContentTypeFormDialog } from "./ContentTypeFormDialog";

export const ContentTypes = () => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const router = useAppRouter();
  const dialogs = useDialogs();
  const timestampColumns = useTimestampColumns<ContentType>();
  const options = {
    onError: (error: Error) => {
      toast.error(error);
    },
    onSuccess: () => {
      toast.success(t("message.item_delete_success"));
    },
  };
  const { mutate: deleteContentType } = useDelete(
    EntityType.CONTENT_TYPE,
    options,
  );
  const actionColumns = useActionColumns<ContentType>(
    EntityType.CONTENT_TYPE,
    [
      {
        action: ColumnActionType.Content,
        onClick: (row) => router.push(`/content-types/content/${row.id}`),
      },
      {
        action: ColumnActionType.Edit,
        onClick: (row) => {
          dialogs.open(ContentTypeFormDialog, { defaultValues: row });
        },
        requires: [Action.UPDATE],
      },
      {
        action: ColumnActionType.Delete,
        onClick: async ({ id }) => {
          const isConfirmed = await dialogs.confirm(ConfirmDialogBody);

          if (isConfirmed) {
            deleteContentType(id);
          }
        },
        requires: [Action.DELETE],
      },
    ],
    t("label.operations"),
  );
  const columns: GridColDef<ContentType>[] = [
    { flex: 1, field: "name", headerName: t("label.name") },
    ...timestampColumns,
    actionColumns,
  ];

  return (
    <GenericDataGrid
      entity={EntityType.CONTENT_TYPE}
      buttons={[
        {
          permissionAction: Action.CREATE,
          onClick: () =>
            dialogs.open(ContentTypeFormDialog, { defaultValues: null }),
        },
      ]}
      columns={columns}
      headerIcon={BookOpen}
      searchParams={{ $iLike: ["name"], syncUrl: true }}
      headerI18nTitle="title.entities"
    />
  );
};

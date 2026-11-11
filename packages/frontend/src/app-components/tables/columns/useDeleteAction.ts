/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import type { GridValidRowModel } from "@mui/x-data-grid";

import { ConfirmDialogBody } from "@/app-components/dialogs";
import { useDialogs } from "@/hooks/useDialogs";

import { type ActionColumn, ColumnActionType } from "./getColumns";

/**
 * The delete action of a list row: deletes the row once the user confirms.
 * Pass it to useActionColumns, which shows it with the delete permission.
 */
export const useDeleteAction = <T extends GridValidRowModel>(
  deleteRow: (id: string) => void,
  isDisabled?: (row: T) => boolean,
): ActionColumn<T> => {
  const dialogs = useDialogs();

  return {
    action: ColumnActionType.Delete,
    onClick: async ({ id }) => {
      const isConfirmed = await dialogs.confirm(ConfirmDialogBody);

      if (isConfirmed) {
        deleteRow(id);
      }
    },
    requires: [Action.DELETE],
    ...(isDisabled ? { isDisabled } : {}),
  };
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useContext } from "react";

import { ConfirmDialogBody } from "@/app-components/dialogs";
import type { BASE_ADD_DIALOG_MAP } from "@/app-components/dialogs/dialog.constants";
import { EntityDialogsContext } from "@/contexts/entity-dialogs.context";
import { THook } from "@/types/base.types";
import {
  ConfirmOptions,
  DialogComponent,
  OpenDialogOptions,
  TPayload,
} from "@/types/common/dialogs.types";

import { useDialogs } from "./useDialogs";

export const useEntityDialogMap = () => {
  const dialogMap = useContext(EntityDialogsContext);

  if (!dialogMap) {
    throw new Error(
      "useEntityDialogMap must be used within an EntityDialogsProvider",
    );
  }

  return dialogMap;
};

export const useEntityDialogs = <
  T extends typeof BASE_ADD_DIALOG_MAP,
  TE extends keyof typeof BASE_ADD_DIALOG_MAP,
  TD extends THook<{ entity: TE }>["basic"],
  TP extends TPayload<TD, T[TE]["presetValues"]>,
>(
  entity: TE,
) => {
  const dialogs = useDialogs();
  const dialogMap = useEntityDialogMap();
  const EntityDialogComponent = dialogMap[entity][
    "dialog"
  ] as unknown as DialogComponent<TP, TD | boolean>;
  const open = (payload: TP, options?: OpenDialogOptions<TD | boolean>) => {
    if (EntityDialogComponent) {
      return dialogs.open(EntityDialogComponent, payload, {
        ...dialogMap[entity]?.["options"],
        ...options,
      });
    }
  };
  const confirmDelete = async (options?: ConfirmOptions) => {
    return await dialogs.confirm(ConfirmDialogBody, options);
  };

  return {
    open,
    confirmDelete,
  };
};

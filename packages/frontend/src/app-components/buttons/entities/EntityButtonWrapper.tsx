/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { ButtonProps } from "@mui/material";

import { useHasPermission } from "@/hooks/useHasPermission";
import { THook } from "@/types/base.types";
import {
  ConfirmOptions,
  OpenDialogOptions,
} from "@/types/common/dialogs.types";

import { BASE_ADD_DIALOG_MAP } from "../../dialogs/dialog.constants";

import { CreateEntityButton } from "./CreateEntityButton";

export const EntityButtonWrapper = <
  TE extends keyof typeof BASE_ADD_DIALOG_MAP,
>({
  entity,
  slotProps,
  openOptions,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  confirmOptions = {},
  permissionAction,
  onEntityCreated,
}: {
  entity: TE;
  slotProps?: ButtonProps;
  openOptions?: OpenDialogOptions<THook<{ entity: TE }>["basic"] | boolean>;
  confirmOptions?: ConfirmOptions & { selectedIds?: string[] };
  permissionAction: Action;
  onEntityCreated?: (created: THook<{ entity: TE }>["basic"]) => void;
}) => {
  const hasPermission = useHasPermission();

  if (!hasPermission(entity, permissionAction)) {
    return null;
  }

  const dialogComponent = BASE_ADD_DIALOG_MAP[entity]?.["dialog"];

  if (!dialogComponent) return null;

  if (permissionAction === Action.CREATE) {
    return (
      <CreateEntityButton
        entity={entity}
        slotProps={slotProps}
        openOptions={openOptions}
        onEntityCreated={onEntityCreated}
      />
    );
  }
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Button, ButtonProps } from "@mui/material";
import { Plus } from "lucide-react";

import { useEntityDialogs } from "@/hooks/useEntityDialogs";
import { useTranslate } from "@/hooks/useTranslate";
import { THook } from "@/types/base.types";
import { OpenDialogOptions } from "@/types/common/dialogs.types";

import { BASE_ADD_DIALOG_MAP } from "../../dialogs/dialog.constants";

export const CreateEntityButton = <
  TE extends keyof typeof BASE_ADD_DIALOG_MAP,
>({
  entity,
  slotProps,
  openOptions,
  onEntityCreated,
}: {
  entity: TE;
  slotProps?: ButtonProps;
  openOptions?: OpenDialogOptions<THook<{ entity: TE }>["basic"] | boolean>;
  onEntityCreated?: (created: THook<{ entity: TE }>["basic"]) => void;
}) => {
  const { t } = useTranslate();
  const entityDialogs = useEntityDialogs(entity);
  const handleClick = async () => {
    const result = await entityDialogs.open(
      { defaultValues: null },
      openOptions,
    );

    if (result && typeof result === "object" && "id" in result) {
      onEntityCreated?.(result);
    }
  };

  return (
    <Button
      size="small"
      variant="contained"
      onClick={handleClick}
      startIcon={<Plus size={18} />}
      {...slotProps}
    >
      {t("button.add")}
    </Button>
  );
};

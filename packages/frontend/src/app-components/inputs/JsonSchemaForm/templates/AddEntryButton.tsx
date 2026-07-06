/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import AddIcon from "@mui/icons-material/Add";
import { Button, type SxProps, type Theme } from "@mui/material";
import type { MouseEventHandler } from "react";

import { useTranslate } from "@/hooks/useTranslate";

export type AddEntryButtonProps = {
  id: string;
  className: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  sx?: SxProps<Theme>;
};

export const AddEntryButton = ({
  id,
  className,
  onClick,
  disabled,
  sx,
}: AddEntryButtonProps) => {
  const { t } = useTranslate();

  return (
    <Button
      id={id}
      className={className}
      size="small"
      variant="outlined"
      color="primary"
      startIcon={<AddIcon />}
      onClick={onClick}
      disabled={disabled}
      sx={[
        { alignSelf: "flex-start", width: "fit-content" },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {t("button.add")}
    </Button>
  );
};

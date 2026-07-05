/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { IconButton, Tooltip } from "@mui/material";
import type { MouseEventHandler, ReactNode } from "react";

export type ToolbarIconButtonProps = {
  id: string;
  className: string;
  title: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  danger?: boolean;
  children: ReactNode;
};

export const ToolbarIconButton = ({
  id,
  className,
  title,
  disabled,
  onClick,
  danger,
  children,
}: ToolbarIconButtonProps) => (
  <Tooltip title={title} placement="top">
    <span>
      <IconButton
        id={id}
        className={className}
        size="small"
        disabled={disabled}
        onClick={onClick}
        sx={
          danger
            ? { "&:hover": { color: "error.main" } }
            : { "&:hover": { color: "text.primary" } }
        }
      >
        {children}
      </IconButton>
    </span>
  </Tooltip>
);

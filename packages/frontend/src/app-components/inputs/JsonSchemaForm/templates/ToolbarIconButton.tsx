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

/**
 * Centers row-level action buttons on the themed input height so they align
 * with the input they act on.
 */
export const inputRowActionsSx = {
  display: "flex",
  alignItems: "center",
  height: "2.5rem",
  flexShrink: 0,
} as const;

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
        sx={{
          "& svg": { fontSize: 16 },
          "&:hover": { color: danger ? "error.main" : "text.primary" },
        }}
      >
        {children}
      </IconButton>
    </span>
  </Tooltip>
);

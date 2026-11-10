/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import MuiAvatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import React, { forwardRef } from "react";

import { AvatarProps, Size, UserStatus } from "./types";

const SIZE_MAP: Record<Exclude<Size, "fluid">, number> = {
  xs: 16,
  sm: 26,
  md: 42,
  lg: 68,
};
const STATUS_COLOR_MAP: Record<UserStatus, string> = {
  available: "success.main",
  unavailable: "warning.main",
  away: "warning.main",
  dnd: "error.main",
  invisible: "grey.400",
  eager: "info.main",
};

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  {
    name = "",
    src = "",
    size = "md",
    status,
    className,
    active = false,
    children,
    ...rest
  },
  ref,
) {
  const side = size === "fluid" ? "100%" : SIZE_MAP[size];
  const statusSide =
    size === "xs" ? 6 : size === "sm" ? 9 : size === "lg" ? 15 : 12;

  return (
    <Box
      ref={ref}
      className={className}
      sx={{
        position: "relative",
        width: side,
        height: side,
        borderRadius: "50%",
        flexShrink: 0,
        outlineStyle: "solid",
        outlineWidth: 2,
        outlineColor: active ? "primary.main" : "transparent",
        outlineOffset: 1,
      }}
      {...rest}
    >
      {children || (
        <>
          <MuiAvatar
            alt={name}
            src={src}
            sx={{
              width: "100%",
              height: "100%",
            }}
          />
          {typeof status === "string" && (
            <Box
              component="span"
              sx={{
                position: "absolute",
                right: -1,
                bottom: "6%",
                width: statusSide,
                height: statusSide,
                borderRadius: "50%",
                backgroundColor: STATUS_COLOR_MAP[status],
                border: 2,
                borderStyle: "solid",
                borderColor: "background.paper",
              }}
            />
          )}
        </>
      )}
    </Box>
  );
});

Avatar.displayName = "Avatar";

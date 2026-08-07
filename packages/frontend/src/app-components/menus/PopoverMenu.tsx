/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Box,
  Divider,
  MenuItem,
  Popover,
  Stack,
  Typography,
} from "@mui/material";
import { FC } from "react";
import { Link as RouterLink } from "react-router";

import { PopoverMenuProps } from "./DashboardSidebar/types/sidebar.types";

export const PopoverMenu: FC<PopoverMenuProps> = ({
  sx,
  user,
  links,
  logout,
  handleClose,
  ...other
}) => {
  return (
    <Popover
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: {
            mt: 1.5,
            width: 220,
            borderRadius: 1.5,
            border: "1px solid",
            borderColor: "divider",
            ...sx,
          },
        },
      }}
      onClose={handleClose}
      {...other}
    >
      {(user?.fullName || user?.email) && (
        <Box sx={{ py: 1.5, px: 2 }}>
          {user?.fullName && (
            <Typography variant="subtitle2" noWrap>
              {user.fullName}
            </Typography>
          )}
          {user?.email && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {user?.email}
            </Typography>
          )}
        </Box>
      )}

      {links?.length && (
        <>
          <Divider sx={{ borderStyle: "dashed" }} />
          <Stack sx={{ p: 1 }}>
            {links.map(({ href, text }) => (
              <MenuItem
                key={href}
                component={RouterLink}
                to={href}
                onClick={handleClose}
                sx={{ borderRadius: 0.75 }}
              >
                {text}
              </MenuItem>
            ))}
          </Stack>
        </>
      )}

      {logout && (
        <>
          <Divider sx={{ borderStyle: "dashed" }} />
          <Box sx={{ p: 1 }}>
            <MenuItem
              onClick={logout.onClick}
              sx={{ borderRadius: 0.75, color: "error.main" }}
            >
              {logout.text}
            </MenuItem>
          </Box>
        </>
      )}
    </Popover>
  );
};

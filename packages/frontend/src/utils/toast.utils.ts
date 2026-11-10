/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { darken, lighten, type Theme } from "@mui/material";

export const getNotistackVariantStyles = (theme: Theme) => {
  return (["success", "error", "info", "warning"] as const).reduce(
    (acc, variant) => {
      const mainColor = theme.palette?.[variant].main;

      return (
        acc +
        `.notistack-MuiContent-${variant} {
      background-color: ${lighten(mainColor, 0.8)};
      color: ${mainColor};
      font-weight: 700;
    }
    [data-mui-color-scheme='dark'] .notistack-MuiContent-${variant} {
      background-color: ${darken(mainColor, 0.6)};
      color: ${lighten(mainColor, 0.6)};
    }
  `
      );
    },
    "",
  );
};

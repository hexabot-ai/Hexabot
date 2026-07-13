/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import FunctionsRoundedIcon from "@mui/icons-material/FunctionsRounded";
import {
  Box,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from "@mui/material";

import { useTranslate } from "@/hooks/useTranslate";

type ExpressionAssistProps = {
  disabled?: boolean;
  isExpression: boolean;
  menuAnchor: HTMLElement | null;
  onConvertStaticText: () => void;
  onMenuClose: () => void;
  onOpen: (anchor: HTMLElement) => void;
  onReplaceWithExpression: () => void;
};

export const ExpressionAssist = ({
  disabled,
  isExpression,
  menuAnchor,
  onConvertStaticText,
  onMenuClose,
  onOpen,
  onReplaceWithExpression,
}: ExpressionAssistProps) => {
  const { t } = useTranslate();
  const label = isExpression
    ? t("input.dynamic_value.active")
    : t("input.dynamic_value.use_dynamic");

  return (
    <>
      <Tooltip title={label} arrow>
        <Box
          component="span"
          sx={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            display: "inline-flex",
            alignItems: "center",
            zIndex: 1,
          }}
        >
          <IconButton
            aria-label={label}
            disabled={disabled}
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(event.currentTarget);
            }}
            sx={{
              color: isExpression ? "primary.main" : "text.secondary",
            }}
          >
            <FunctionsRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Tooltip>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={onMenuClose}
        onClick={(event) => event.stopPropagation()}
      >
        <MenuItem onClick={onReplaceWithExpression}>
          <ListItemText
            primary={t("input.dynamic_value.menu.replace")}
            secondary={t("input.dynamic_value.menu.replace_description")}
          />
        </MenuItem>
        <MenuItem onClick={onConvertStaticText}>
          <ListItemText
            primary={t("input.dynamic_value.menu.convert")}
            secondary={t("input.dynamic_value.menu.convert_description")}
          />
        </MenuItem>
        <MenuItem onClick={onMenuClose}>
          <ListItemText primary={t("input.dynamic_value.menu.cancel")} />
        </MenuItem>
      </Menu>
    </>
  );
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { Box, Stack, Typography } from "@mui/material";
import {
  buttonId,
  type ArrayFieldItemTemplateProps,
  type RJSFSchema,
} from "@rjsf/utils";

import { useTranslate } from "@/hooks/useTranslate";
import { isRecord } from "@/utils/object";

import { ToolbarIconButton } from "./ToolbarIconButton";

const isComplexItemSchema = (schema: RJSFSchema): boolean => {
  if (
    Array.isArray(schema.anyOf) ||
    Array.isArray(schema.oneOf) ||
    Array.isArray(schema.allOf)
  ) {
    return true;
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((value) => value !== "null")
    : schema.type;

  return (
    type === "object" ||
    type === "array" ||
    isRecord(schema.properties) ||
    schema.items !== undefined
  );
};

export const ActionArrayFieldItemTemplate = (
  props: ArrayFieldItemTemplateProps,
) => {
  const { children, buttonsProps, hasToolbar, index, totalItems, schema } =
    props;
  const {
    disabled,
    readonly,
    hasCopy,
    hasMoveDown,
    hasMoveUp,
    hasRemove,
    fieldPathId,
    onCopyItem,
    onRemoveItem,
    onMoveDownItem,
    onMoveUpItem,
  } = buttonsProps;
  const { t } = useTranslate();
  const isComplex = isComplexItemSchema(schema as RJSFSchema);
  const isInteractionDisabled = disabled || readonly;
  const showReorder = (hasMoveUp || hasMoveDown) && totalItems > 1;
  const iconSx = { fontSize: 16 } as const;
  const toolbar = hasToolbar ? (
    <Stack direction="row" alignItems="center" sx={{ color: "text.secondary" }}>
      {showReorder ? (
        <>
          <ToolbarIconButton
            id={buttonId(fieldPathId, "moveUp")}
            className="rjsf-array-item-move-up"
            title={t("button.move_up")}
            disabled={isInteractionDisabled || !hasMoveUp}
            onClick={onMoveUpItem}
          >
            <ArrowUpwardIcon sx={iconSx} />
          </ToolbarIconButton>
          <ToolbarIconButton
            id={buttonId(fieldPathId, "moveDown")}
            className="rjsf-array-item-move-down"
            title={t("button.move_down")}
            disabled={isInteractionDisabled || !hasMoveDown}
            onClick={onMoveDownItem}
          >
            <ArrowDownwardIcon sx={iconSx} />
          </ToolbarIconButton>
        </>
      ) : null}
      {hasCopy ? (
        <ToolbarIconButton
          id={buttonId(fieldPathId, "copy")}
          className="rjsf-array-item-copy"
          title={t("button.copy")}
          disabled={isInteractionDisabled}
          onClick={onCopyItem}
        >
          <ContentCopyIcon sx={iconSx} />
        </ToolbarIconButton>
      ) : null}
      {hasRemove ? (
        <ToolbarIconButton
          id={buttonId(fieldPathId, "remove")}
          className="rjsf-array-item-remove"
          title={t("button.delete")}
          disabled={isInteractionDisabled}
          onClick={onRemoveItem}
          danger
        >
          <DeleteOutlineIcon sx={iconSx} />
        </ToolbarIconButton>
      ) : null}
    </Stack>
  ) : null;

  if (isComplex) {
    return (
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          p: 1.5,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          mb={1}
        >
          <Typography variant="caption" color="text.secondary" fontWeight={500}>
            #{index + 1}
          </Typography>
          {toolbar}
        </Stack>
        {children}
      </Box>
    );
  }

  return (
    <Stack direction="row" alignItems="flex-start" spacing={0.5}>
      <Box flexGrow={1} minWidth={0}>
        {children}
      </Box>
      {toolbar ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            // Match the themed input height so the buttons center on the input row
            height: "2.5rem",
            flexShrink: 0,
          }}
        >
          {toolbar}
        </Box>
      ) : null}
    </Stack>
  );
};

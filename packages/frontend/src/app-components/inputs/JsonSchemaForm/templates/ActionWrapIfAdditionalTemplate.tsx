/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { Box, Stack, TextField } from "@mui/material";
import {
  ADDITIONAL_PROPERTY_FLAG,
  buttonId,
  type WrapIfAdditionalTemplateProps,
} from "@rjsf/utils";

import { useTranslate } from "@/hooks/useTranslate";

import { inputRowActionsSx, ToolbarIconButton } from "./ToolbarIconButton";

export const ActionWrapIfAdditionalTemplate = (
  props: WrapIfAdditionalTemplateProps,
) => {
  const {
    children,
    classNames,
    style,
    disabled,
    id,
    label,
    onKeyRenameBlur,
    onRemoveProperty,
    readonly,
    required,
    schema,
  } = props;
  const { t } = useTranslate();
  const additional = ADDITIONAL_PROPERTY_FLAG in schema;

  if (!additional) {
    return (
      <div className={classNames} style={style}>
        {children}
      </div>
    );
  }

  const isInteractionDisabled = disabled || readonly;

  return (
    <Stack
      key={`${id}-key`}
      direction="row"
      alignItems="flex-start"
      spacing={1}
      className={classNames}
      style={style}
    >
      <Box flex={1} minWidth={0}>
        <TextField
          fullWidth
          required={required}
          placeholder={t("label.key")}
          aria-label={t("label.key")}
          defaultValue={label}
          disabled={isInteractionDisabled}
          id={`${id}-key`}
          name={`${id}-key`}
          onBlur={!readonly ? onKeyRenameBlur : undefined}
          type="text"
        />
      </Box>
      <Box flex={1} minWidth={0}>
        {children}
      </Box>
      <Box sx={inputRowActionsSx}>
        <ToolbarIconButton
          id={buttonId(id, "remove")}
          className="rjsf-object-property-remove"
          title={t("button.delete")}
          disabled={isInteractionDisabled}
          onClick={onRemoveProperty}
          danger
        >
          <DeleteOutlineIcon />
        </ToolbarIconButton>
      </Box>
    </Stack>
  );
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Stack, Typography } from "@mui/material";
import {
  buttonId,
  getUiOptions,
  type ArrayFieldTemplateProps,
  type RJSFSchema,
} from "@rjsf/utils";

import { getDescription, LabelWithTooltip } from "../widgets/shared";

import { AddEntryButton } from "./AddEntryButton";

export const ActionArrayFieldTemplate = (props: ArrayFieldTemplateProps) => {
  const {
    canAdd,
    disabled,
    fieldPathId,
    uiSchema,
    items,
    optionalDataControl,
    onAddClick,
    readonly,
    registry,
    required,
    schema,
    title,
  } = props;
  const uiOptions = getUiOptions(uiSchema, registry.globalUiOptions);
  const descriptionText = getDescription(schema as RJSFSchema, uiOptions);
  const titleLabel =
    uiOptions.label === false ? undefined : (uiOptions.title ?? title);
  const showOptionalDataControlInTitle = !readonly && !disabled;
  const hasItems = items.length > 0;

  return (
    <Box width="100%">
      {titleLabel || (showOptionalDataControlInTitle && optionalDataControl) ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          mb={hasItems ? 1 : 0.5}
        >
          <Typography
            variant="subtitle2"
            component="span"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              "& .action-field-label-icon": {
                order: 3,
              },
            }}
          >
            <LabelWithTooltip
              label={titleLabel}
              description={descriptionText}
              iconSize={14}
            />
            {required && titleLabel ? (
              <Box component="span" aria-hidden ml={0.25} sx={{ order: 2 }}>
                *
              </Box>
            ) : null}
          </Typography>
          {showOptionalDataControlInTitle ? optionalDataControl : null}
        </Stack>
      ) : null}
      {!showOptionalDataControlInTitle ? optionalDataControl : null}
      {hasItems ? <Stack spacing={1}>{items}</Stack> : null}
      {canAdd ? (
        <AddEntryButton
          id={buttonId(fieldPathId, "add")}
          className="rjsf-array-item-add"
          onClick={onAddClick}
          disabled={disabled || readonly}
          sx={{ mt: hasItems ? 1 : 0 }}
        />
      ) : null}
    </Box>
  );
};

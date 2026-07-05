/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Divider, Typography } from "@mui/material";
import {
  getUiOptions,
  type RJSFSchema,
  type TitleFieldProps,
} from "@rjsf/utils";

import { getDescription, LabelWithTooltip } from "../widgets/shared";

export const NestedTitleField = ({
  id,
  title,
  optionalDataControl,
  registry,
  schema,
  uiSchema,
}: TitleFieldProps) => {
  const baseId = id.split("__")[0];
  const isNested = baseId !== registry.globalFormOptions.idPrefix;
  const uiOptions = getUiOptions(uiSchema, registry.globalUiOptions);
  const description = getDescription(schema as RJSFSchema, uiOptions);
  const headingText = (
    <LabelWithTooltip label={title} description={description} iconSize={16} />
  );
  const heading = (
    <Typography variant={isNested ? "subtitle2" : "h5"}>
      {headingText}
    </Typography>
  );

  return (
    <Box id={id} my={1}>
      {optionalDataControl ? (
        <Box display="flex" alignItems="center" justifyContent="space-between">
          {heading}
          {optionalDataControl}
        </Box>
      ) : (
        heading
      )}
      <Divider />
    </Box>
  );
};

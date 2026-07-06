/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Stack } from "@mui/material";
import type { MultiSchemaFieldTemplateProps } from "@rjsf/utils";

export const ActionMultiSchemaFieldTemplate = ({
  selector,
  optionSchemaField,
}: MultiSchemaFieldTemplateProps) => (
  <Stack spacing={1.5} width="100%">
    {selector ? <Box maxWidth={280}>{selector}</Box> : null}
    {optionSchemaField}
  </Stack>
);

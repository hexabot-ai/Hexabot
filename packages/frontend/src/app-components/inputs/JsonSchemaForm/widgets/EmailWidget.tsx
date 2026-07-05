/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { TextField } from "@mui/material";
import { labelValue, WidgetProps } from "@rjsf/utils";

import { createReadOnlyInputProps } from "../../readOnlyInput.util";

export const EmailWidget = (props: WidgetProps) => {
  return (
    <TextField
      label={labelValue(props.label || undefined, props.hideLabel, undefined)}
      type="email"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      variant="outlined"
      fullWidth
      slotProps={{
        htmlInput: createReadOnlyInputProps(),
      }}
    />
  );
};

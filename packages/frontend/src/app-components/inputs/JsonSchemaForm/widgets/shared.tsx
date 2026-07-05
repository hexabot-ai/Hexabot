/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Tooltip, type SxProps, type Theme } from "@mui/material";
import type { RJSFSchema } from "@rjsf/utils";
import { Info } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type LabelWithTooltipProps = {
  label?: ReactNode;
  description?: ReactNode;
  iconSize?: number;
};

const labelTooltipSx = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0.5,
  "& .MuiFormLabel-asterisk": {
    order: 2,
  },
  "& .action-field-label-icon": {
    order: 3,
  },
} as const;

export const labelTooltipInputLabelSx = {
  ...labelTooltipSx,
  pointerEvents: "auto",
} as const;

export const getDescription = (
  schema: RJSFSchema | undefined,
  options?: { description?: ReactNode },
) => {
  const description = options?.description ?? schema?.description;

  if (typeof description === "string") {
    const trimmed = description.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  return description || undefined;
};

/**
 * Coerces an RJSF widget value to the string a text input expects.
 */
export const toInputString = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export const LabelWithTooltip = ({
  label,
  description,
  iconSize = 14,
}: LabelWithTooltipProps) => {
  if (!label || !description) {
    return label ?? null;
  }

  return (
    <>
      {label}
      <Tooltip title={description} placement="top" arrow>
        <Box
          component="span"
          className="action-field-label-icon"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "text.secondary",
            marginLeft: ".25rem",
            lineHeight: 0,
            verticalAlign: "middle",
            "& svg": {
              display: "block",
            },
          }}
        >
          <Info size={iconSize} />
        </Box>
      </Tooltip>
    </>
  );
};

export const mergeLabelSx = (
  baseSx: SxProps<Theme>,
  sx?: SxProps<Theme>,
): SxProps<Theme> =>
  sx
    ? ([baseSx, ...(Array.isArray(sx) ? sx : [sx])] as SxProps<Theme>)
    : baseSx;

type TooltipLabelHostProps = {
  label?: unknown;
  schema?: RJSFSchema;
  options?: { description?: ReactNode };
  InputLabelProps?: { sx?: SxProps<Theme> } & Record<string, unknown>;
};

/**
 * Wraps an RJSF widget/template so its label renders with the schema
 * description as an info tooltip. With `mergeInputLabelSx`, the MUI input
 * label also receives the sx needed to keep the icon clickable and ordered
 * after the required asterisk.
 */
export const withTooltipLabel = <P extends TooltipLabelHostProps>(
  Component: ComponentType<P>,
  { mergeInputLabelSx = false }: { mergeInputLabelSx?: boolean } = {},
) => {
  const WithTooltipLabel = (props: P) => {
    const description = getDescription(props.schema, props.options);
    const label = (
      <LabelWithTooltip
        label={(props.label as ReactNode) || undefined}
        description={description}
      />
    );
    const inputLabelProps = mergeInputLabelSx
      ? {
          InputLabelProps: {
            ...props.InputLabelProps,
            sx: mergeLabelSx(
              labelTooltipInputLabelSx,
              props.InputLabelProps?.sx,
            ),
          },
        }
      : undefined;

    // RJSF types labels as string, but MUI renders any ReactNode fine
    return (
      <Component
        {...props}
        {...inputLabelProps}
        label={label as unknown as P["label"]}
      />
    );
  };

  WithTooltipLabel.displayName = `WithTooltipLabel(${
    Component.displayName ?? Component.name ?? "Component"
  })`;

  return WithTooltipLabel;
};

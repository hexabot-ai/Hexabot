/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { SxProps, Theme } from "@mui/material";
import type * as React from "react";

/**
 * Minimal JSON Schema shape we need for autocomplete.
 * (Works with most JSON Schema drafts in practice.)
 */
export type JsonSchemaLike = {
  $ref?: string;
  $defs?: Record<string, JsonSchemaLike>;
  definitions?: Record<string, JsonSchemaLike>;

  type?: string | string[];
  description?: string;

  properties?: Record<string, JsonSchemaLike>;
  required?: string[];

  items?: JsonSchemaLike | JsonSchemaLike[];

  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  allOf?: JsonSchemaLike[];

  additionalProperties?: boolean | JsonSchemaLike;
};

export type GlobalsSchema =
  | ({
      // Option A: schema.properties has $input/$output/$context
      type?: "object";
      properties?: {
        $input?: JsonSchemaLike;
        $output?: JsonSchemaLike;
        $context?: JsonSchemaLike;

        // Option B: schema.properties has input/output/context
        input?: JsonSchemaLike;
        output?: JsonSchemaLike;
        context?: JsonSchemaLike;
      } & Record<string, JsonSchemaLike>;
    } & JsonSchemaLike)
  | {
      // Option C: direct map
      input: JsonSchemaLike;
      output: JsonSchemaLike;
      context: JsonSchemaLike;
    };

export type JsonataFormulaFieldProps = {
  label?: React.ReactNode;
  required?: boolean;
  value: string;
  onChange: (next: string) => void;
  onBlur?: (next: string) => void;
  onFocus?: (next: string) => void;

  /**
   * JSON schema that describes the shapes of $input / $output / $context.
   * Optional when a `JsonataGlobalsSchemaProvider` is present upstream.
   * Supported:
   *  - { input, output, context }
   *  - OR schema.properties.$input / $output / $context
   *  - OR schema.properties.input / output / context
   */
  globalsSchema?: GlobalsSchema;

  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  fullWidth?: boolean;

  /**
   * Height behavior:
   * - default is auto-size up to maxHeight
   */
  minHeightPx?: number;
  maxHeightPx?: number;

  /** Shows a compact affordance that focuses JSONata autocomplete. */
  enableExpressionAssist?: boolean;

  onExpressionStateChange?: (state: {
    hasError: boolean;
    isExpression: boolean;
    suppressSchemaErrors: boolean;
  }) => void;

  sx?: SxProps<Theme>;
};

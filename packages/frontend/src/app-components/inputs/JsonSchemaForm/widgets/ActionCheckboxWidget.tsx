/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { FormControlLabel, Switch } from "@mui/material";
import {
  ariaDescribedByIds,
  labelValue,
  schemaRequiresTrueValue,
  type RJSFSchema,
  type WidgetProps,
} from "@rjsf/utils";

import { isExpressionValue } from "@/app-components/inputs/JsonataFormulaField/dynamicValueUtils";

import type { ExpressionFormContext } from "../expression.types";

import { resolveAllowExpression } from "./expression-policy.utils";
import { JsonataTextWidget } from "./JsonataTextWidget";
import { getDescription, LabelWithTooltip } from "./shared";
import { useExpressionFieldStateReport } from "./useExpressionFieldStateReport";

export const ActionCheckboxWidget = (props: WidgetProps) => {
  const {
    schema,
    id,
    htmlName,
    value,
    disabled,
    readonly,
    label: fieldLabel = "",
    hideLabel,
    autofocus,
    onChange,
    onBlur,
    onFocus,
    options,
    registry,
  } = props;
  const context = registry.formContext as ExpressionFormContext | undefined;
  const isExpression = typeof value === "string" && isExpressionValue(value);
  const allowExpression = resolveAllowExpression({
    schema: schema as RJSFSchema,
    options,
    policy: context?.expressionPolicy,
  });
  const showExpressionField = isExpression && allowExpression;
  // Tolerate booleans persisted as strings (e.g. workflows authored as YAML)
  const isBooleanLikeString = value === "true" || value === "false";
  const checked = value === true || value === "true";
  const description = getDescription(schema as RJSFSchema, options);
  const required = schemaRequiresTrueValue(schema);
  const labelWithTooltip = (
    <LabelWithTooltip label={fieldLabel} description={description} />
  );

  useExpressionFieldStateReport(
    id,
    isBooleanLikeString
      ? { hasError: false, suppressSchemaErrors: true }
      : undefined,
    context?.reportExpressionFieldState,
    // JsonataTextWidget reports the expression state itself
    showExpressionField,
  );

  if (showExpressionField) {
    return <JsonataTextWidget {...props} />;
  }

  return (
    <FormControlLabel
      control={
        <Switch
          id={id}
          name={htmlName || id}
          checked={checked}
          required={required}
          disabled={disabled || readonly}
          autoFocus={autofocus}
          onChange={(_, nextChecked) => onChange(nextChecked)}
          onBlur={() => onBlur(id, value)}
          onFocus={() => onFocus(id, value)}
          aria-describedby={ariaDescribedByIds(id)}
        />
      }
      label={labelValue(
        labelWithTooltip as unknown as string,
        hideLabel,
        false,
      )}
    />
  );
};

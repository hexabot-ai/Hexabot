/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { FormHelperText } from "@mui/material";
import {
  getTemplate,
  type BaseInputTemplateProps,
  type RJSFSchema,
  type WidgetProps,
} from "@rjsf/utils";
import { useCallback } from "react";
import type { ReactNode } from "react";

import {
  JsonataFormulaField,
  type GlobalsSchema,
} from "@/app-components/inputs/JsonataFormulaField";
import { isExpressionValue } from "@/app-components/inputs/JsonataFormulaField/dynamicValueUtils";
import { useTranslate } from "@/hooks/useTranslate";

import type {
  ExpressionFieldState,
  ExpressionFormContext,
} from "../expression.types";

import { resolveAllowExpression } from "./expression-policy.utils";
import { getDescription, LabelWithTooltip, toInputString } from "./shared";
import { useExpressionFieldStateReport } from "./useExpressionFieldStateReport";

type JsonataFormContext = ExpressionFormContext & {
  globalsSchema?: GlobalsSchema;
};
type JsonataWidgetOptions = {
  emptyValue?: unknown;
  globalsSchema?: GlobalsSchema;
  description?: ReactNode;
};

export const JsonataTextWidget = ({
  id,
  label,
  hideLabel,
  required,
  disabled,
  readonly,
  value,
  onChange,
  onBlur,
  onFocus,
  options,
  schema,
  registry,
  ...props
}: WidgetProps) => {
  const { t } = useTranslate();
  const widgetOptions = options as JsonataWidgetOptions;
  const context = registry.formContext as JsonataFormContext | undefined;
  const reportExpressionFieldState = context?.reportExpressionFieldState;
  const globalsSchema = widgetOptions?.globalsSchema ?? context?.globalsSchema;
  const allowExpression = resolveAllowExpression({
    schema: schema as RJSFSchema,
    options: widgetOptions,
    policy: context?.expressionPolicy,
  });
  const emptyValue =
    widgetOptions !== undefined && "emptyValue" in widgetOptions
      ? widgetOptions.emptyValue
      : "";
  const normalizeValue = (next: unknown) => {
    const text = next == null ? "" : String(next);

    return text === "" ? emptyValue : text;
  };
  const safeValue = toInputString(value);
  const fieldLabel = hideLabel ? undefined : label || undefined;
  const description = getDescription(schema as RJSFSchema, widgetOptions);
  const hasDisallowedExpressionValue =
    !allowExpression && isExpressionValue(safeValue);

  useExpressionFieldStateReport(
    id,
    hasDisallowedExpressionValue
      ? { hasError: true, suppressSchemaErrors: false }
      : undefined,
    reportExpressionFieldState,
  );

  const reportAllowedExpressionState = useCallback(
    (state: ExpressionFieldState) => {
      reportExpressionFieldState?.(
        id,
        state.hasError || state.suppressSchemaErrors ? state : undefined,
      );
    },
    [id, reportExpressionFieldState],
  );

  if (!allowExpression) {
    const BaseInputTemplate = getTemplate<"BaseInputTemplate">(
      "BaseInputTemplate",
      registry,
      options,
    );

    return (
      <>
        <BaseInputTemplate
          {...(props as BaseInputTemplateProps)}
          id={id}
          label={fieldLabel ?? ""}
          hideLabel={hideLabel}
          required={required}
          disabled={disabled}
          readonly={readonly}
          value={safeValue}
          schema={schema}
          registry={registry}
          options={options}
          onChange={(nextValue) => onChange(normalizeValue(nextValue))}
          onBlur={(fieldId, nextValue) =>
            onBlur?.(fieldId, normalizeValue(nextValue))
          }
          onFocus={(fieldId, nextValue) =>
            onFocus?.(fieldId, normalizeValue(nextValue))
          }
        />
        {hasDisallowedExpressionValue ? (
          <FormHelperText error sx={{ mt: 0.5 }}>
            {t("input.dynamic_value.errors.disabled")}
          </FormHelperText>
        ) : null}
      </>
    );
  }

  return (
    <JsonataFormulaField
      label={
        fieldLabel ? (
          <LabelWithTooltip label={fieldLabel} description={description} />
        ) : undefined
      }
      required={required}
      value={safeValue}
      onChange={(next) => onChange(normalizeValue(next))}
      onBlur={(next) => onBlur?.(id, normalizeValue(next))}
      onFocus={(next) => onFocus?.(id, normalizeValue(next))}
      globalsSchema={globalsSchema}
      disabled={disabled || readonly}
      enableExpressionAssist
      onExpressionStateChange={reportAllowedExpressionState}
      fullWidth
    />
  );
};

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
import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";

import {
  JsonataFormulaField,
  type GlobalsSchema,
} from "@/app-components/inputs/JsonataFormulaField";
import { isExpressionValue } from "@/app-components/inputs/JsonataFormulaField/dynamicValueUtils";
import { useTranslate } from "@/hooks/useTranslate";

import type { ExpressionFormContext } from "../expression.types";

import { resolveAllowExpression } from "./expression-policy.utils";
import { getDescription, LabelWithTooltip } from "./shared";

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
  const hasCustomEmptyValue =
    widgetOptions !== undefined &&
    Object.prototype.hasOwnProperty.call(widgetOptions, "emptyValue");
  const emptyValue = hasCustomEmptyValue ? widgetOptions?.emptyValue : "";
  const normalizeValue = (next: string) => (next === "" ? emptyValue : next);
  const safeValue =
    typeof value === "string" ? value : value == null ? "" : String(value);
  const fieldLabel = hideLabel ? undefined : label || undefined;
  const description = getDescription(schema as RJSFSchema, widgetOptions);
  const labelWithTooltip = fieldLabel ? (
    <LabelWithTooltip label={fieldLabel} description={description} />
  ) : undefined;
  const hasDisallowedExpressionValue =
    !allowExpression && isExpressionValue(safeValue);

  useEffect(() => {
    if (allowExpression) {
      reportExpressionFieldState?.(id, undefined);

      return;
    }

    reportExpressionFieldState?.(
      id,
      hasDisallowedExpressionValue
        ? { hasError: true, suppressSchemaErrors: false }
        : undefined,
    );
  }, [
    allowExpression,
    hasDisallowedExpressionValue,
    id,
    reportExpressionFieldState,
  ]);

  useEffect(() => {
    return () => {
      reportExpressionFieldState?.(id, undefined);
    };
  }, [id, reportExpressionFieldState]);

  const reportAllowedExpressionState = useCallback(
    (state: { hasError: boolean; suppressSchemaErrors: boolean }) => {
      reportExpressionFieldState?.(
        id,
        state.hasError || state.suppressSchemaErrors
          ? {
              hasError: state.hasError,
              suppressSchemaErrors: state.suppressSchemaErrors,
            }
          : undefined,
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
          onChange={(nextValue) =>
            onChange(normalizeValue(nextValue == null ? "" : String(nextValue)))
          }
          onBlur={(fieldId, nextValue) =>
            onBlur?.(
              fieldId,
              normalizeValue(nextValue == null ? "" : String(nextValue)),
            )
          }
          onFocus={(fieldId, nextValue) =>
            onFocus?.(
              fieldId,
              normalizeValue(nextValue == null ? "" : String(nextValue)),
            )
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
      label={labelWithTooltip}
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

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type RJSFForm from "@rjsf/core";
import { Form } from "@rjsf/mui";
import {
  type RJSFSchema,
  type RJSFValidationError,
  type UiSchema,
} from "@rjsf/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslate } from "@/hooks/useTranslate";
import validator from "@/utils/rjsf-zod-validator";

import type {
  ExpressionFieldState,
  ExpressionPolicy,
} from "./expression.types";
import { FORM_FIELDS } from "./fields";
import {
  buildArrayItemsUiOverlay,
  errorPropertyToFieldId,
  mergeUiSchemas,
  withFriendlyOptionTitles,
  type SchemaTypeName,
} from "./json-schema-form.utils";
import { extractUiSchema, withSchemaDefaults } from "./schema-defaults.utils";
import { FORM_TEMPLATES } from "./templates";
import { getFormWidgets } from "./widgets";

const FORM_UI_SCHEMA = {
  "ui:submitButtonOptions": {
    norender: true,
  },
} as const;

type JsonSchemaFormProps<
  D extends Record<string, unknown> = Record<string, unknown>,
> = {
  schema: RJSFSchema;
  formData: Record<string, unknown>;
  onFormDataChange: (data: D, errors?: unknown[]) => void;
  idPrefix?: string;
  uiSchema?: UiSchema;
  liveValidate?: "onChange" | "onBlur" | boolean;
  enableJsonataTextWidget?: boolean;
  expressionPolicy?: ExpressionPolicy;
  formContext?: Record<string, unknown>;
  onVisibleErrorsChange?: (hasVisibleErrors: boolean) => void;
  validateOnMount?: boolean;
};

export const JsonSchemaForm = <
  D extends Record<string, unknown> = Record<string, unknown>,
>({
  schema,
  formData,
  onFormDataChange,
  idPrefix,
  uiSchema,
  liveValidate = "onChange",
  enableJsonataTextWidget = true,
  expressionPolicy = "input-default",
  formContext,
  onVisibleErrorsChange,
  validateOnMount = false,
}: JsonSchemaFormProps<D>) => {
  const formRef = useRef<RJSFForm<Record<string, unknown>, RJSFSchema> | null>(
    null,
  );
  const visibleErrorFieldIdsRef = useRef<Set<string>>(new Set());
  const [hasVisibleErrors, setHasVisibleErrors] = useState(false);
  const [expressionFieldStates, setExpressionFieldStates] = useState<
    Record<string, ExpressionFieldState>
  >({});
  const [touchedFieldIds, setTouchedFieldIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const touchedFieldIdsRef = useRef(touchedFieldIds);
  const fullValidationErrorsRef = useRef<RJSFValidationError[] | null>(null);
  const markFieldTouched = useCallback((fieldId?: string) => {
    if (!fieldId) {
      return;
    }

    setTouchedFieldIds((current) => {
      if (current.has(fieldId)) {
        return current;
      }

      const next = new Set(current);
      // Also mark ancestor ids so container-level errors (e.g. minItems)
      // surface once the user interacts with any nested field
      const segments = fieldId.split("_");

      for (let index = 1; index <= segments.length; index++) {
        next.add(segments.slice(0, index).join("_"));
      }

      return next;
    });
  }, []);
  // Schema errors are only displayed for fields the user has interacted
  // with; parents still receive the unfiltered list via onFormDataChange
  const transformErrors = useCallback(
    (errors: RJSFValidationError[]) => {
      fullValidationErrorsRef.current = errors;

      if (validateOnMount) {
        return errors;
      }

      const touched = touchedFieldIdsRef.current;

      return errors.filter((error) => {
        const property = error.property ?? ".";

        if (property === ".") {
          return true;
        }

        return touched.has(
          errorPropertyToFieldId(property, idPrefix ?? "root"),
        );
      });
    },
    [idPrefix, validateOnMount],
  );

  touchedFieldIdsRef.current = touchedFieldIds;
  const { t, i18n } = useTranslate();
  const resolveSchemaTypeTitle = useCallback(
    (type: SchemaTypeName) => t(`label.schema_types.${type}`) || undefined,
    // `t` is recreated on every render; the language is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language],
  );
  const normalizedSchema = useMemo(
    () => withFriendlyOptionTitles(schema, resolveSchemaTypeTitle),
    [schema, resolveSchemaTypeTitle],
  );
  // ui:* keys embedded in the schema are applied automatically; the
  // `uiSchema` prop is only needed for overrides on top of them
  const normalizedUiSchema = useMemo(
    () =>
      mergeUiSchemas(
        mergeUiSchemas(
          extractUiSchema(normalizedSchema),
          buildArrayItemsUiOverlay(normalizedSchema),
        ),
        uiSchema,
      ),
    [normalizedSchema, uiSchema],
  );
  const normalizedFormData = useMemo(
    () => withSchemaDefaults(normalizedSchema, formData),
    [formData, normalizedSchema],
  );
  const [liveFormData, setLiveFormData] =
    useState<Record<string, unknown>>(normalizedFormData);
  const reportFieldVisibleError = useCallback(
    (fieldId: string, hasVisibleError: boolean) => {
      if (!fieldId) {
        return;
      }

      const next = visibleErrorFieldIdsRef.current;

      if (hasVisibleError) {
        next.add(fieldId);
      } else {
        next.delete(fieldId);
      }

      const nextHasVisibleErrors = next.size > 0;

      setHasVisibleErrors((previous) =>
        previous === nextHasVisibleErrors ? previous : nextHasVisibleErrors,
      );
    },
    [],
  );
  const reportExpressionFieldState = useCallback(
    (fieldId: string, state?: ExpressionFieldState) => {
      if (!fieldId) {
        return;
      }

      setExpressionFieldStates((current) => {
        const previous = current[fieldId];

        if (!state) {
          if (!previous) {
            return current;
          }

          const { [fieldId]: _, ...next } = current;

          return next;
        }

        if (
          previous?.hasError === state.hasError &&
          previous?.suppressSchemaErrors === state.suppressSchemaErrors
        ) {
          return current;
        }

        return {
          ...current,
          [fieldId]: state,
        };
      });
    },
    [],
  );

  useEffect(() => {
    setLiveFormData(normalizedFormData);
  }, [normalizedFormData]);

  useEffect(() => {
    onVisibleErrorsChange?.(hasVisibleErrors);
  }, [hasVisibleErrors, onVisibleErrorsChange]);

  useEffect(() => {
    if (!validateOnMount) {
      return;
    }

    formRef.current?.validateForm();
  }, [validateOnMount, schema, idPrefix]);

  useEffect(() => {
    // Re-validate when a field becomes touched so its errors, hidden by
    // transformErrors until now, become visible without another change
    if (touchedFieldIds.size > 0) {
      formRef.current?.validateForm();
    }
  }, [touchedFieldIds]);

  useEffect(() => {
    return () => {
      onVisibleErrorsChange?.(false);
    };
  }, [onVisibleErrorsChange]);

  return (
    <Form
      ref={formRef}
      schema={normalizedSchema}
      validator={validator}
      formData={liveFormData}
      formContext={{
        ...(formContext ?? {}),
        expressionFieldStates,
        expressionPolicy,
        formData: liveFormData,
        validateOnMount,
        reportExpressionFieldState,
        reportFieldVisibleError,
      }}
      onChange={(event, fieldId) => {
        const nextFormData = event.formData ?? {};
        const fullErrors = fullValidationErrorsRef.current ?? event.errors;

        markFieldTouched(fieldId);
        setLiveFormData(nextFormData);
        onFormDataChange(nextFormData, fullErrors);
      }}
      onBlur={(fieldId) => {
        markFieldTouched(fieldId);
      }}
      transformErrors={transformErrors}
      showErrorList={false}
      noHtml5Validate
      liveValidate={liveValidate}
      uiSchema={{ ...FORM_UI_SCHEMA, ...(normalizedUiSchema ?? {}) }}
      idPrefix={idPrefix}
      templates={FORM_TEMPLATES}
      fields={FORM_FIELDS}
      widgets={getFormWidgets(enableJsonataTextWidget)}
    />
  );
};

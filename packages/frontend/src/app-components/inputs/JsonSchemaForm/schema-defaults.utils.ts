/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JsonValue } from "@hexabot-ai/agentic";
import { getDefaultFormState, RJSFSchema, UiSchema } from "@rjsf/utils";
import { JSONSchema7 } from "json-schema";
import { JSONSchema } from "monaco-yaml";

import { isRecord } from "@/utils/object";
import validator from "@/utils/rjsf-zod-validator";

const computeDefaultFormState = <T = Record<string, unknown>>(
  schema: RJSFSchema,
  formData?: T,
) =>
  getDefaultFormState<T>(validator, schema, formData, schema, false, {
    emptyObjectFields: "skipEmptyDefaults",
  });

export const getSchemaDefaults = <T extends Record<string, JsonValue>>(
  schema: JSONSchema | RJSFSchema,
): T | undefined => {
  try {
    const defaults = computeDefaultFormState<T>(schema as RJSFSchema);

    return normalizeDefaults(defaults) as T;
  } catch {
    return undefined;
  }
};

export const withSchemaDefaults = (
  schema: RJSFSchema,
  formData: Record<string, unknown>,
): Record<string, unknown> => {
  try {
    const nextFormData = computeDefaultFormState(schema, formData);

    return isRecord(nextFormData) ? nextFormData : formData;
  } catch {
    return formData;
  }
};

const normalizeDefaults = (
  value: JsonValue | undefined,
): JsonValue | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const next = value
      .map((item) => normalizeDefaults(item))
      .filter((item): item is JsonValue => item !== undefined);

    return next.length > 0 ? next : undefined;
  }

  if (value && typeof value === "object") {
    const next: Record<string, JsonValue> = {};

    Object.entries(value).forEach(([key, entry]) => {
      const normalized = normalizeDefaults(entry as JsonValue | undefined);

      if (normalized !== undefined) {
        next[key] = normalized;
      }
    });

    return next;
  }

  return value;
};

type SchemaProperties = Record<string, unknown>;

export const getSchemaProperties = <T extends SchemaProperties>(
  schema?: unknown,
): T | undefined => {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return undefined;
  }

  const properties = schema.properties as T;

  return Object.keys(properties).length > 0 ? properties : undefined;
};

export const getSchemaPropertyNames = (schema?: unknown): string[] => {
  return Object.keys(getSchemaProperties(schema) ?? {});
};

export const hasSchemaProperties = (schema?: unknown): boolean =>
  getSchemaPropertyNames(schema).length > 0;

const UI_KEYS = [
  "ui:widget",
  "ui:field",
  "ui:options",
  "ui:placeholder",
  "ui:help",
] as const;

export const extractUiSchema = (
  jsonSchema?: RJSFSchema | JSONSchema7,
): UiSchema => {
  const ui: UiSchema = {};

  for (const k of UI_KEYS) {
    if (jsonSchema?.[k] !== undefined) ui[k] = jsonSchema[k];
  }

  if (jsonSchema?.type === "object" && jsonSchema?.properties) {
    for (const [propName, propSchema] of Object.entries(
      jsonSchema.properties,
    )) {
      const childUi = extractUiSchema(propSchema as RJSFSchema);

      if (Object.keys(childUi).length) ui[propName] = childUi;
    }
  }

  if (jsonSchema?.type === "array" && jsonSchema?.items) {
    const itemsUi = extractUiSchema(jsonSchema.items as JSONSchema7);

    if (Object.keys(itemsUi).length) ui.items = itemsUi;
  }

  return ui;
};

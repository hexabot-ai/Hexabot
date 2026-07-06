/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import { isRecord } from "@/utils/object";

const SUBSCHEMA_RECORD_KEYS = ["properties", "definitions", "$defs"] as const;
const SUBSCHEMA_KEYS = [
  "items",
  "additionalProperties",
  "additionalItems",
] as const;
const SUBSCHEMA_LIST_KEYS = ["anyOf", "oneOf", "allOf"] as const;

export type SchemaTypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "record"
  | "null";

export type SchemaTypeTitleResolver = (
  type: SchemaTypeName,
) => string | undefined;

/**
 * Infers a displayable type for an anyOf/oneOf option so auto-generated
 * selectors can show "Text" or "Key-value pairs" instead of "Option 1".
 */
export const inferSchemaOptionType = (
  schema: Record<string, unknown>,
): SchemaTypeName | undefined => {
  const { type } = schema;
  const singleType = Array.isArray(type)
    ? type.find((value) => value !== "null")
    : type;

  if (singleType === "object" || (!singleType && isRecord(schema.properties))) {
    return !isRecord(schema.properties) &&
      schema.additionalProperties !== undefined
      ? "record"
      : "object";
  }

  if (
    typeof singleType === "string" &&
    ["string", "number", "integer", "boolean", "array", "null"].includes(
      singleType,
    )
  ) {
    return singleType as SchemaTypeName;
  }

  if (!singleType && schema.additionalProperties !== undefined) {
    return "record";
  }

  if (!singleType && schema.items !== undefined) {
    return "array";
  }

  if (!singleType && Array.isArray(schema.enum)) {
    return "string";
  }

  return undefined;
};

/**
 * True when an array item schema renders as a nested structure (object,
 * array or union) rather than a single inline input.
 */
export const isComplexItemSchema = (schema: RJSFSchema): boolean => {
  const node = schema as Record<string, unknown>;

  if (SUBSCHEMA_LIST_KEYS.some((key) => Array.isArray(node[key]))) {
    return true;
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((value) => value !== "null")
    : schema.type;

  return (
    type === "object" ||
    type === "array" ||
    isRecord(schema.properties) ||
    schema.items !== undefined
  );
};

/**
 * Returns a copy of the schema where every untitled anyOf/oneOf option gets a
 * human-friendly title derived from its type, so union selectors don't fall
 * back to RJSF's "Option 1 / Option 2" labels.
 */
export const withFriendlyOptionTitles = (
  schema: RJSFSchema,
  resolveTypeTitle: SchemaTypeTitleResolver,
): RJSFSchema => {
  const visit = (node: unknown): unknown => {
    if (!isRecord(node)) {
      return node;
    }

    const next: Record<string, unknown> = { ...node };

    for (const key of SUBSCHEMA_RECORD_KEYS) {
      const value = next[key];

      if (isRecord(value)) {
        next[key] = Object.fromEntries(
          Object.entries(value).map(([name, subSchema]) => [
            name,
            visit(subSchema),
          ]),
        );
      }
    }

    for (const key of SUBSCHEMA_KEYS) {
      const value = next[key];

      if (Array.isArray(value)) {
        // Tuple form, e.g. `items: [{...}, {...}]`
        next[key] = value.map(visit);
      } else if (value !== undefined) {
        next[key] = visit(value);
      }
    }

    for (const key of SUBSCHEMA_LIST_KEYS) {
      const options = next[key];

      if (Array.isArray(options)) {
        next[key] = options.map((option) => {
          const visited = visit(option);

          if (
            key === "allOf" ||
            !isRecord(visited) ||
            typeof visited.title === "string"
          ) {
            return visited;
          }

          const optionType = inferSchemaOptionType(visited);
          const title = optionType ? resolveTypeTitle(optionType) : undefined;

          return title ? { ...visited, title } : visited;
        });
      }
    }

    return next;
  };

  return visit(schema) as RJSFSchema;
};

const buildUiOverlay = (
  schema: unknown,
  hideLabel: boolean,
): UiSchema | undefined => {
  if (!isRecord(schema)) {
    return hideLabel ? { "ui:label": false } : undefined;
  }

  const overlay: Record<string, unknown> = hideLabel
    ? { "ui:label": false }
    : {};

  if (isRecord(schema.properties)) {
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      const child = buildUiOverlay(propertySchema, false);

      if (child) {
        overlay[name] = child;
      }
    }
  }

  if (schema.items !== undefined) {
    overlay.items = buildUiOverlay(schema.items, true);
  }

  if (
    schema.additionalProperties === true ||
    isRecord(schema.additionalProperties)
  ) {
    overlay.additionalProperties = buildUiOverlay(
      schema.additionalProperties,
      true,
    );
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    const options = schema[key];

    if (Array.isArray(options)) {
      // RJSF swaps the field's uiSchema for `uiSchema.anyOf[index]` once an
      // option is selected, so each option overlay must repeat `hideLabel`
      const childOverlays = options.map(
        (option) => buildUiOverlay(option, hideLabel) ?? {},
      );

      if (childOverlays.some((child) => Object.keys(child).length > 0)) {
        overlay[key] = childOverlays;
      }
    }
  }

  return Object.keys(overlay).length > 0 ? overlay : undefined;
};

/**
 * Builds a uiSchema overlay that hides the auto-generated labels of repeated
 * entries — array items ("Title-N") and record values (the entry key name) —
 * at every nesting level of the schema; their container header/key input
 * already names them.
 */
export const buildArrayItemsUiOverlay = (
  schema: unknown,
): UiSchema | undefined => buildUiOverlay(schema, false);

const ERROR_PATH_SEGMENT =
  /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\['((?:[^'\\]|\\.)*)'\]/g;

/**
 * Maps a validator error property path (e.g. ".repositories[0].name") to the
 * RJSF field id it belongs to (e.g. "action-input_repositories_0_name").
 */
export const errorPropertyToFieldId = (
  property: string,
  idPrefix: string,
  idSeparator = "_",
): string => {
  const segments = [idPrefix];

  for (const match of property.matchAll(ERROR_PATH_SEGMENT)) {
    const segment =
      match[1] ??
      match[2] ??
      match[3]?.replaceAll("\\'", "'").replaceAll("\\\\", "\\");

    if (segment !== undefined) {
      segments.push(segment);
    }
  }

  return segments.join(idSeparator);
};

/**
 * Deep-merges two uiSchemas; values from `override` win over `base`.
 */
export const mergeUiSchemas = (
  base?: UiSchema,
  override?: UiSchema,
): UiSchema | undefined => {
  if (!base) {
    return override;
  }

  if (!override) {
    return base;
  }

  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];

    merged[key] =
      isRecord(baseValue) && isRecord(value)
        ? mergeUiSchemas(baseValue, value)
        : value;
  }

  return merged;
};

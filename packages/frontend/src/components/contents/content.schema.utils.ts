/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { AttachmentResourceRef } from "@hexabot-ai/types";
import { RJSFSchema } from "@rjsf/utils";

import { getSchemaProperties } from "@/app-components/inputs/JsonSchemaForm";
import { type JsonSchemaType } from "@/app-components/inputs/JsonSchemaObjectBuilder";

import { type ContentFormData } from "./ContentForm";

export type ContentField = {
  title: string;
  type: JsonSchemaType<"fieldInput">;
  name: string;
};

export type ContentSchemaProperties = Record<string, ContentField>;
const isMissingFileValue = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return true;
  }

  const id = (value as { payload?: { id?: unknown } }).payload?.id;

  return typeof id !== "string" || id.trim().length === 0;
};
const buildStringFieldSchema = (title: string): RJSFSchema => ({
  type: "string",
  title,
  default: "",
});
const buildFileFieldSchema = (title: string): RJSFSchema => ({
  type: "object",
  title,
  properties: {
    type: { type: "string" },
    payload: {
      type: "object",
      properties: {
        id: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
      additionalProperties: true,
    },
  },
  default: {},
  additionalProperties: true,
});
const CONTENT_FIELD_SCHEMA_FACTORIES: Partial<
  Record<ContentField["type"], (title: string) => RJSFSchema>
> = {
  boolean: (title) => ({ type: "boolean", title, default: false }),
  textarea: buildStringFieldSchema,
  uri: (title) => ({ type: "string", format: "uri", title, default: "" }),
  file: buildFileFieldSchema,
  html: buildStringFieldSchema,
  string: buildStringFieldSchema,
};
const REQUIRED_NON_EMPTY_FIELD_TYPES = new Set<ContentField["type"]>([
  "string",
  "textarea",
  "html",
  "uri",
]);

type ContentFieldUiSchema = Partial<
  Record<"ui:widget" | "ui:field" | "ui:options", unknown>
>;
const CONTENT_FIELD_UI_SCHEMAS: Partial<
  Record<ContentField["type"], ContentFieldUiSchema>
> = {
  textarea: {
    "ui:widget": "textarea",
    "ui:options": {
      rows: 5,
    },
  },
  file: {
    "ui:field": "ActionAttachmentField",
    "ui:options": {
      resourceRef: AttachmentResourceRef.ContentAttachment,
    },
  },
};
const buildContentFieldSchema = (
  propertyKey: string,
  property: ContentField,
  includeUiSchema = false,
): RJSFSchema => {
  const fieldTitle = property.title || propertyKey;
  const schemaFactory =
    CONTENT_FIELD_SCHEMA_FACTORIES[property.type] ?? buildStringFieldSchema;
  const baseFieldSchema = schemaFactory(fieldTitle);
  const fieldSchema = REQUIRED_NON_EMPTY_FIELD_TYPES.has(property.type)
    ? {
        ...baseFieldSchema,
        minLength:
          typeof baseFieldSchema.minLength === "number"
            ? Math.max(1, baseFieldSchema.minLength)
            : 1,
      }
    : baseFieldSchema;

  if (!includeUiSchema) {
    return fieldSchema;
  }

  const fieldUiSchema = CONTENT_FIELD_UI_SCHEMAS[property.type];

  return fieldUiSchema ? { ...fieldSchema, ...fieldUiSchema } : fieldSchema;
};
const transformContentSchema = (
  rjsfSchema: RJSFSchema,
  includeUiSchema = false,
) => {
  const properties = getSchemaProperties<ContentSchemaProperties>(rjsfSchema);
  const schemaProperties: Record<string, RJSFSchema> = {
    contentType: includeUiSchema
      ? {
          type: "string",
          title: "contentType",
          "ui:widget": "hidden",
        }
      : { type: "string", title: "contentType" },
  };

  for (const [propertyKey, property] of Object.entries(properties || {})) {
    schemaProperties[propertyKey] = buildContentFieldSchema(
      propertyKey,
      property,
      includeUiSchema,
    );
  }

  return {
    type: "object",
    properties: schemaProperties,
    required: rjsfSchema?.["required"] || [],
  } as RJSFSchema;
};

export const buildContentSchema = (rjsfSchema: RJSFSchema) =>
  transformContentSchema(rjsfSchema, true);

export const hasMissingRequiredFileFields = (
  rjsfSchema: RJSFSchema | undefined,
  formData: Record<string, unknown>,
) => {
  const requiredFields = new Set(
    Array.isArray(rjsfSchema?.required) ? rjsfSchema.required : [],
  );
  const properties = getSchemaProperties<ContentSchemaProperties>(rjsfSchema);

  return Object.entries(properties || {}).some(
    ([propertyKey, property]) =>
      requiredFields.has(propertyKey) &&
      property.type === "file" &&
      isMissingFileValue(formData[propertyKey]),
  );
};

export const buildContentParams = ({
  title,
  status,
  ...rest
}: ContentFormData) => ({
  title,
  status,
  properties: rest,
});

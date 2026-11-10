/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  AttachmentResourceRef,
  CONTENT_TYPE_READ_ONLY_PROPERTY_KEYS,
  type Content,
  type ContentFieldType,
} from "@hexabot-ai/types";
import { RJSFSchema } from "@rjsf/utils";

import {
  getSchemaDefaults,
  getSchemaProperties,
} from "@/app-components/inputs/JsonSchemaForm/schema-defaults.utils";
import { getContentFieldType } from "@/utils/content-field.utils";

import { type ContentFormData } from "./ContentForm";

export type ContentField = {
  title: string;
  type: ContentFieldType;
};

export type ContentSchemaProperties = Record<string, ContentField>;
const buildStringFieldSchema = (title: string): RJSFSchema => ({
  type: "string",
  title,
  default: "",
});
const buildFileFieldSchema = (
  title: string,
  isRequired: boolean,
): RJSFSchema => ({
  type: "object",
  title,
  properties: {
    type: { type: "string" },
    payload: {
      type: "object",
      properties: {
        id: isRequired
          ? { type: "string", minLength: 1 }
          : {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
      },
      ...(isRequired ? { required: ["id"] } : {}),
      additionalProperties: true,
    },
  },
  ...(isRequired ? { required: ["payload"] } : {}),
  default: {},
  additionalProperties: true,
});
const CONTENT_FIELD_SCHEMA_FACTORIES: Partial<
  Record<ContentField["type"], (title: string) => RJSFSchema>
> = {
  boolean: (title) => ({ type: "boolean", title, default: false }),
  textarea: buildStringFieldSchema,
  // No "" default: "format" refuses an empty URL, and the URL input clears
  // the value to undefined.
  uri: (title) => ({ type: "string", format: "uri", title }),
  html: buildStringFieldSchema,
  string: buildStringFieldSchema,
};
const TEXT_FIELD_TYPES = new Set<ContentField["type"]>([
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
  requiredFields: Set<string>,
): RJSFSchema => {
  const fieldTitle = property.title || propertyKey;
  const fieldType = getContentFieldType(property) ?? property.type;
  const schemaFactory =
    CONTENT_FIELD_SCHEMA_FACTORIES[fieldType] ?? buildStringFieldSchema;
  const baseFieldSchema =
    fieldType === "file"
      ? buildFileFieldSchema(fieldTitle, requiredFields.has(propertyKey))
      : schemaFactory(fieldTitle);
  const fieldSchema =
    TEXT_FIELD_TYPES.has(fieldType) && requiredFields.has(propertyKey)
      ? { ...baseFieldSchema, minLength: 1 }
      : baseFieldSchema;
  const fieldUiSchema = CONTENT_FIELD_UI_SCHEMAS[fieldType];

  return fieldUiSchema ? { ...fieldSchema, ...fieldUiSchema } : fieldSchema;
};

export const buildContentSchema = (rjsfSchema: RJSFSchema) => {
  const properties =
    getSchemaProperties<ContentSchemaProperties>(rjsfSchema) ?? {};
  const requiredFields = new Set(["title", ...(rjsfSchema.required ?? [])]);
  const schemaProperties: Record<string, RJSFSchema> = {
    contentType: {
      type: "string",
      title: "contentType",
      "ui:widget": "hidden",
    },
  };

  for (const [propertyKey, property] of Object.entries(properties)) {
    schemaProperties[propertyKey] = buildContentFieldSchema(
      propertyKey,
      property,
      requiredFields,
    );
  }

  return {
    type: "object",
    properties: schemaProperties,
    required: [...requiredFields],
  } as RJSFSchema;
};

/**
 * Form data of a content: the defaults of the form, then the content and its
 * properties. Empty texts are left to the defaults, since an empty URL is
 * not a valid URL.
 */
export const buildContentFormData = (
  schema: RJSFSchema,
  contentTypeId: string,
  content?: Content | null,
) =>
  ({
    contentType: contentTypeId,
    ...getSchemaDefaults(schema),
    ...content,
    ...Object.fromEntries(
      Object.entries(content?.properties ?? {}).filter(
        ([, value]) => value !== "",
      ),
    ),
  }) as ContentFormData;

const isEmptyValue = (value: unknown) =>
  value === undefined ||
  (typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 0);

/**
 * Splits the form data into the columns of the content and its properties.
 * Properties only hold the values of the content type fields: the form data
 * also carries the content it was seeded with (id, dates, content type, ...)
 * and the values of fields removed from the content type.
 */
export const buildContentParams = (
  { title, status, ...values }: ContentFormData,
  contentTypeSchema: unknown,
) => ({
  title,
  status,
  properties: Object.fromEntries(
    Object.keys(getSchemaProperties(contentTypeSchema) ?? {})
      .filter(
        (key) =>
          !CONTENT_TYPE_READ_ONLY_PROPERTY_KEYS.includes(key) &&
          !isEmptyValue(values[key]),
      )
      .map((key) => [key, values[key]]),
  ),
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  AttachmentResourceRef,
  type ContentFieldType,
} from "@hexabot-ai/types";
import { RJSFSchema } from "@rjsf/utils";

import { getSchemaProperties } from "@/app-components/inputs/JsonSchemaForm/schema-defaults.utils";
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
  uri: (title) => ({ type: "string", format: "uri", title, default: "" }),
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
  const fieldSchema = REQUIRED_NON_EMPTY_FIELD_TYPES.has(fieldType)
    ? {
        ...baseFieldSchema,
        minLength:
          typeof baseFieldSchema.minLength === "number"
            ? Math.max(1, baseFieldSchema.minLength)
            : 1,
      }
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

export const buildContentParams = ({
  title,
  status,
  ...rest
}: ContentFormData) => ({
  title,
  status,
  properties: rest,
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JSONSchema7 } from "json-schema";
import { z } from "zod";

import { fileTypeSchema } from "../chat/attachment";
import { baseStubSchema } from "../shared/base";

const contentTypeObjectSchema = baseStubSchema.extend({
  name: z.string(),
  schema: z.any(),
});

export const DEFAULT_CONTENT_TYPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", title: "Title" },
    status: { type: "boolean", title: "Status" },
  },
} satisfies JSONSchema7;

export const CONTENT_TYPE_READ_ONLY_PROPERTY_KEYS = Object.keys(
  DEFAULT_CONTENT_TYPE_SCHEMA.properties,
);

export const withDefaultContentTypeProperties = <
  T extends Record<string, unknown> | undefined,
>(
  properties?: T,
) => ({
  ...DEFAULT_CONTENT_TYPE_SCHEMA.properties,
  ...properties,
});

/**
 * Kinds of content type fields. They are stored as the field's `type`,
 * in place of a JSON Schema type: the admin UI picks the input of each field,
 * and `send_list` the fields it offers, from this value alone.
 */
export const CONTENT_FIELD_TYPES = [
  "string",
  "textarea",
  "uri",
  "boolean",
  "file",
] as const;

export type ContentFieldType = (typeof CONTENT_FIELD_TYPES)[number];

const CONTENT_FIELD_TYPE_DESCRIPTIONS: Record<ContentFieldType, string> = {
  string: "a single-line text, stored as a string",
  textarea: "a multi-line text, stored as a string",
  uri: "a URL, stored as a string (send_list offers it as the link of web_url buttons)",
  boolean: "a switch, stored as a boolean",
  file: 'an attachment, stored as { "type": "image"|"video"|"audio"|"file", "payload": { "id": "<attachment id>" } or { "url": "<file URL>" } } (send_list offers it as the image of an element)',
};

export const contentFieldTypeSchema = z.enum(CONTENT_FIELD_TYPES).meta({
  description: `Hexabot content field type, not a JSON Schema type (no "format"): ${Object.entries(
    CONTENT_FIELD_TYPE_DESCRIPTIONS,
  )
    .map(([type, description]) => `"${type}": ${description}`)
    .join("; ")}.`,
});

export const contentFieldSchema = z
  .strictObject(
    {
      type: contentFieldTypeSchema,
      title: z.string().optional(),
      description: z.string().optional(),
    },
    {
      // Other JSON Schema keywords ("format", "enum", "default", ...) would be
      // saved, then ignored by every consumer of the field.
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `Unsupported key(s) ${issue.keys.map((key) => `"${key}"`).join(", ")}: a content field only takes "type", "title" and "description". Pick the kind of field with "type" (${CONTENT_FIELD_TYPES.join(", ")}), e.g. {"type":"uri"} for a URL, not {"type":"string","format":"uri"}.`
          : undefined,
    },
  )
  .meta({
    description:
      'A content type field: { "type": <field type>, "title"?: <label>, "description"?: <help text> }.',
  });

export const contentTypeJsonSchema = z
  .looseObject({
    type: z.literal(DEFAULT_CONTENT_TYPE_SCHEMA.type),
    properties: z
      .object(
        Object.fromEntries(
          Object.entries(DEFAULT_CONTENT_TYPE_SCHEMA.properties).map(
            ([key, { type }]) => [
              key,
              z.looseObject({ type: z.literal(type), title: z.string() }),
            ],
          ),
        ),
      )
      .catchall(contentFieldSchema),
  })
  .meta({
    description:
      'Content type schema: { "type": "object", "properties": { <field key>: <field> }, "required"?: [<field key>] }. The built-in "title" ({ "type": "string", "title": "Title" }) and "status" ({ "type": "boolean", "title": "Status" }) fields must be kept. Example: {"type":"object","properties":{"title":{"type":"string","title":"Title"},"status":{"type":"boolean","title":"Status"},"link":{"type":"uri","title":"Link"},"image":{"type":"file","title":"Image"}},"required":["link"]}',
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isContentFieldType = (value: unknown): value is ContentFieldType =>
  typeof value === "string" &&
  (CONTENT_FIELD_TYPES as readonly string[]).includes(value);

/**
 * Kind of a stored content type field, `undefined` when it has none. Fields
 * saved with a former spelling are read as the kind they stand for:
 * `{ "type": "string", "format": "uri" }` (saved before the API checked field
 * types) as "uri", and "html" (no longer a field type) as "textarea".
 */
export const resolveContentFieldType = (
  field: unknown,
): ContentFieldType | undefined => {
  if (!isRecord(field)) return undefined;

  const { type, format } = field;

  if (type === "string" && (format === "uri" || format === "url")) {
    return "uri";
  }
  if (type === "html") return "textarea";

  return isContentFieldType(type) ? type : undefined;
};

/**
 * Rewrites the fields of a content type schema saved with a former spelling
 * (see `resolveContentFieldType`) to their current type. Other fields and
 * keys are kept as they are.
 */
export const normalizeContentTypeSchema = <T>(schema: T): T => {
  if (!isRecord(schema) || !isRecord(schema.properties)) return schema;

  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, field]) => {
        const type = resolveContentFieldType(field);

        if (!type || !isRecord(field) || field.type === type) {
          return [key, field];
        }

        const { format: _format, ...rest } = field;

        return [key, { ...rest, type }];
      }),
    ),
  } as T;
};

const contentFileValueSchema = z.object({
  type: fileTypeSchema,
  payload: z.looseObject({
    id: z.string().nullable().optional(),
    url: z.string().optional(),
  }),
});
const buildTextValueSchema = (required: boolean) =>
  required ? z.string().min(1, { error: "Required" }) : z.string();
const CONTENT_FIELD_VALUE_SCHEMAS: Record<
  ContentFieldType,
  (required: boolean) => z.ZodType
> = {
  string: buildTextValueSchema,
  textarea: buildTextValueSchema,
  uri: (required) => (required ? z.url() : z.union([z.url(), z.literal("")])),
  boolean: () => z.boolean(),
  file: (required) =>
    required
      ? contentFileValueSchema.refine(
          ({ payload }) => Boolean(payload.id || payload.url),
          { error: "Required: an attachment id or a file URL" },
        )
      : contentFileValueSchema,
};

/**
 * Validates the `properties` of a content against the schema of its content
 * type: each value matches the type of its field, required fields have a
 * value, and no other key is given (`title` and `status` are columns of the
 * content, not properties). Fields saved with a former spelling are read with
 * `resolveContentFieldType`, fields of an unknown type take any value, and a
 * content type without properties takes any properties.
 */
export const buildContentPropertiesSchema = (contentTypeSchema: unknown) => {
  const { properties, required } = isRecord(contentTypeSchema)
    ? contentTypeSchema
    : {};

  if (!isRecord(properties)) {
    return z.record(z.string(), z.unknown());
  }

  const requiredKeys = new Set(Array.isArray(required) ? required : []);
  const fields = Object.entries(properties).filter(
    ([key]) => !CONTENT_TYPE_READ_ONLY_PROPERTY_KEYS.includes(key),
  );
  const fieldKeys = fields.map(([key]) => `"${key}"`).join(", ");

  return z.strictObject(
    Object.fromEntries(
      fields.map(([key, field]) => {
        const type = resolveContentFieldType(field);
        const isRequired = requiredKeys.has(key);
        const schema = type
          ? CONTENT_FIELD_VALUE_SCHEMAS[type](isRequired)
          : z.unknown();

        return [key, isRequired ? schema : schema.nullable().optional()];
      }),
    ),
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `Unknown field(s) ${issue.keys.map((key) => `"${key}"`).join(", ")}: the content type has ${fieldKeys || "no field"} ("title" and "status" are not properties)`
          : undefined,
    },
  );
};

export const contentTypeStubSchema = contentTypeObjectSchema;

export const contentTypeSchema = contentTypeObjectSchema;

export const contentTypeFullSchema = contentTypeObjectSchema;

export type ContentTypeStub = z.infer<typeof contentTypeStubSchema>;

export type ContentType = z.infer<typeof contentTypeSchema>;

export type ContentTypeFull = z.infer<typeof contentTypeFullSchema>;

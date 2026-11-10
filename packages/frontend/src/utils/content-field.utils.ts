/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { CONTENT_FIELD_TYPES, type ContentFieldType } from "@hexabot-ai/types";

const URI_FORMATS = new Set(["uri", "url"]);
const isContentFieldType = (value: unknown): value is ContentFieldType =>
  typeof value === "string" &&
  (CONTENT_FIELD_TYPES as readonly string[]).includes(value);

/**
 * Kind of a stored content type field, `undefined` when it has none.
 * `{ "type": "string", "format": "uri" }` fields, saved before the API
 * checked field types, are URL fields.
 */
export const getContentFieldType = (
  field: unknown,
): ContentFieldType | undefined => {
  if (!field || typeof field !== "object") return undefined;

  const { type, format } = field as Record<string, unknown>;

  if (
    type === "string" &&
    typeof format === "string" &&
    URI_FORMATS.has(format)
  ) {
    return "uri";
  }

  return isContentFieldType(type) ? type : undefined;
};

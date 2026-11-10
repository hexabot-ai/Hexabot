/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { CONTENT_FIELD_TYPES } from "@hexabot-ai/types";
import { type RJSFSchema } from "@rjsf/utils";
import { describe, expect, it } from "vitest";

import { fromJsonSchema } from "@/app-components/inputs/JsonSchemaObjectBuilder";
import { buildContentSchema } from "@/components/contents/content.schema.utils";

import { getContentFieldType } from "./content-field.utils";

const legacyUrlField = {
  type: "string",
  format: "uri",
  title: "Link",
} as const;

describe("getContentFieldType", () => {
  it("returns the type of content fields", () => {
    for (const type of CONTENT_FIELD_TYPES) {
      expect(getContentFieldType({ type })).toBe(type);
    }
  });

  it("reads string fields with a URL format as URL fields", () => {
    expect(getContentFieldType(legacyUrlField)).toBe("uri");
    expect(getContentFieldType({ type: "string", format: "url" })).toBe("uri");
    expect(getContentFieldType({ type: "string", format: "email" })).toBe(
      "string",
    );
  });

  it("returns undefined for other fields", () => {
    expect(getContentFieldType({ type: "number" })).toBeUndefined();
    expect(getContentFieldType({})).toBeUndefined();
    expect(getContentFieldType(null)).toBeUndefined();
  });
});

describe("legacy URL fields", () => {
  const schema: RJSFSchema = {
    type: "object",
    properties: {
      title: { type: "string", title: "Title" },
      link: legacyUrlField,
    },
  };

  it("are edited as URL fields", () => {
    const node = fromJsonSchema(schema, "object", "fieldInput");

    expect(node.type === "object" && node.properties[1]).toEqual({
      key: "link",
      required: false,
      schema: { type: "uri", title: "Link", description: undefined },
    });
  });

  it("are rendered as URL inputs", () => {
    expect(buildContentSchema(schema).properties?.link).toMatchObject({
      type: "string",
      format: "uri",
      title: "Link",
    });
  });
});

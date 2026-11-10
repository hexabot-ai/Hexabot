/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type RJSFSchema } from "@rjsf/utils";
import { describe, expect, it } from "vitest";

import { fromJsonSchema } from "@/app-components/inputs/JsonSchemaObjectBuilder";

import { buildContentSchema } from "./content.schema.utils";

// Fields saved with a former spelling: before the API checked field types,
// and with the "html" field type.
const schema = {
  type: "object",
  properties: {
    title: { type: "string", title: "Title" },
    link: { type: "string", format: "uri", title: "Link" },
    body: { type: "html", title: "Body" },
  },
} as unknown as RJSFSchema;

describe("content fields saved with a former spelling", () => {
  it("are edited as the kind they stand for", () => {
    const node = fromJsonSchema(schema, "object", "fieldInput");

    expect(node.type === "object" && node.properties.slice(1)).toEqual([
      {
        key: "link",
        required: false,
        schema: { type: "uri", title: "Link", description: undefined },
      },
      {
        key: "body",
        required: false,
        schema: { type: "textarea", title: "Body", description: undefined },
      },
    ]);
  });

  it("are rendered with the input of the kind they stand for", () => {
    const { properties } = buildContentSchema(schema);

    expect(properties?.link).toMatchObject({
      type: "string",
      format: "uri",
      title: "Link",
    });
    expect(properties?.body).toMatchObject({
      type: "string",
      title: "Body",
      "ui:widget": "textarea",
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type RJSFSchema } from "@rjsf/utils";
import { describe, expect, it } from "vitest";

import { getSchemaDefaults } from "@/app-components/inputs/JsonSchemaForm/schema-defaults.utils";

import { buildContentParams, buildContentSchema } from "./content.schema.utils";

// Content type fields are not JSON Schema types ("file").
const contentTypeSchema = {
  type: "object",
  properties: {
    title: { type: "string", title: "Title" },
    status: { type: "boolean", title: "Status" },
    body: { type: "string", title: "Body" },
    image: { type: "file", title: "Image" },
  },
} as unknown as RJSFSchema;

describe("buildContentParams", () => {
  it("saves only the values of the content type fields as properties", () => {
    const content = {
      id: "content-id",
      createdAt: new Date(),
      updatedAt: new Date(),
      contentType: "content-type-id",
      searchText: "title: Title",
      properties: { body: "Before", removed: "Value" },
      title: "Title",
      status: true,
    };

    expect(
      buildContentParams(
        { ...content, ...content.properties, body: "After", image: {} },
        contentTypeSchema,
      ),
    ).toEqual({ title: "Title", status: true, properties: { body: "After" } });
  });

  it("leaves out the fields the form only seeded with defaults", () => {
    const defaults = getSchemaDefaults(buildContentSchema(contentTypeSchema));

    expect(
      buildContentParams(
        {
          ...defaults,
          contentType: "content-type-id",
          title: "Title",
          status: false,
        },
        contentTypeSchema,
      ),
    ).toEqual({ title: "Title", status: false, properties: { body: "" } });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type RJSFSchema } from "@rjsf/utils";
import { describe, expect, it } from "vitest";

import { getSchemaDefaults } from "@/app-components/inputs/JsonSchemaForm/schema-defaults.utils";
import validator from "@/utils/rjsf-zod-validator";

import {
  buildContentFormData,
  buildContentParams,
  buildContentSchema,
} from "./content.schema.utils";

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

describe("content form validation", () => {
  const schema = buildContentSchema({
    type: "object",
    properties: {
      title: { type: "string", title: "Title" },
      status: { type: "boolean", title: "Status" },
      name: { type: "string", title: "Name" },
      body: { type: "textarea", title: "Body" },
      link: { type: "uri", title: "Link" },
      summary: { type: "string", title: "Summary" },
      notes: { type: "textarea", title: "Notes" },
      website: { type: "uri", title: "Website" },
    },
    required: ["name", "body", "link"],
  } as unknown as RJSFSchema);
  const content = {
    id: "content-id",
    contentType: "content-type-id",
    title: "Title",
    status: true,
    searchText: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    properties: { name: "Name", body: "Body", link: "https://hexabot.ai" },
  };
  const isValid = (
    properties: Record<string, unknown>,
    values: Record<string, unknown> = {},
  ) =>
    validator.isValid(
      schema,
      {
        ...buildContentFormData(schema, "content-type-id", {
          ...content,
          properties: { ...content.properties, ...properties },
        }),
        ...values,
      },
      schema,
    );

  it("lets optional text fields be left empty", () => {
    expect(isValid({})).toBe(true);
    // Saved empty, then cleared in the form
    expect(isValid({ summary: "", notes: "", website: "" })).toBe(true);
    expect(isValid({}, { summary: "", notes: "", website: undefined })).toBe(
      true,
    );
  });

  it("requires a value in required text fields", () => {
    expect(isValid({}, { name: "" })).toBe(false);
    expect(isValid({}, { body: "" })).toBe(false);
    expect(isValid({ link: "" })).toBe(false);
    expect(isValid({}, { link: undefined })).toBe(false);
  });

  it("checks the URL of URL fields that have a value", () => {
    expect(isValid({ website: "https://hexabot.ai/docs" })).toBe(true);
    expect(isValid({ website: "hexabot.ai" })).toBe(false);
    expect(isValid({ link: "hexabot.ai" })).toBe(false);
  });
});

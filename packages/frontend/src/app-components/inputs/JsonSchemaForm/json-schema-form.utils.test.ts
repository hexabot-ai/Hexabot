/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { RJSFSchema } from "@rjsf/utils";
import { describe, expect, it } from "vitest";

import {
  buildArrayItemsUiOverlay,
  buildPanelUiSchema,
  errorPropertyToFieldId,
  inferSchemaOptionType,
  isComplexItemSchema,
  mergeUiSchemas,
  withFriendlyOptionTitles,
  type SchemaTypeName,
} from "./json-schema-form.utils";

const resolveTypeTitle = (type: SchemaTypeName) =>
  (
    ({
      string: "Text",
      number: "Number",
      integer: "Number",
      boolean: "Boolean",
      array: "List",
      object: "Object",
      record: "Key-value pairs",
      null: "None",
    }) as const
  )[type];

describe("json schema form utils", () => {
  describe("inferSchemaOptionType", () => {
    it("infers primitive types", () => {
      expect(inferSchemaOptionType({ type: "string" })).toBe("string");
      expect(inferSchemaOptionType({ type: "boolean" })).toBe("boolean");
      expect(inferSchemaOptionType({ type: ["number", "null"] })).toBe(
        "number",
      );
    });

    it("distinguishes records from structured objects", () => {
      expect(
        inferSchemaOptionType({
          type: "object",
          additionalProperties: { type: "string" },
        }),
      ).toBe("record");
      expect(
        inferSchemaOptionType({
          type: "object",
          properties: { name: { type: "string" } },
        }),
      ).toBe("object");
    });

    it("falls back to structural hints when type is missing", () => {
      expect(inferSchemaOptionType({ items: { type: "string" } })).toBe(
        "array",
      );
      expect(inferSchemaOptionType({ enum: ["a", "b"] })).toBe("string");
      expect(inferSchemaOptionType({})).toBeUndefined();
    });
  });

  describe("withFriendlyOptionTitles", () => {
    it("titles untitled anyOf options at any nesting level", () => {
      const schema = {
        type: "object",
        properties: {
          product_updates: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                { type: "object", additionalProperties: {} },
              ],
            },
          },
        },
      } as RJSFSchema;
      const result = withFriendlyOptionTitles(schema, resolveTypeTitle);
      const items = (result.properties?.product_updates as RJSFSchema)
        .items as RJSFSchema;

      expect(items.anyOf).toEqual([
        { type: "string", title: "Text" },
        { type: "object", additionalProperties: {}, title: "Key-value pairs" },
      ]);
    });

    it("titles options nested in tuple items", () => {
      const schema = {
        type: "array",
        items: [{ anyOf: [{ type: "string" }] }],
      } as RJSFSchema;
      const result = withFriendlyOptionTitles(schema, resolveTypeTitle);

      expect((result.items as RJSFSchema[])[0].anyOf).toEqual([
        { type: "string", title: "Text" },
      ]);
    });

    it("keeps explicit option titles and does not mutate the input", () => {
      const schema = {
        anyOf: [{ type: "string", title: "Custom" }, { type: "number" }],
      } as RJSFSchema;
      const result = withFriendlyOptionTitles(schema, resolveTypeTitle);

      expect(result.anyOf?.[0]).toEqual({ type: "string", title: "Custom" });
      expect(result.anyOf?.[1]).toEqual({ type: "number", title: "Number" });
      expect(schema.anyOf?.[1]).toEqual({ type: "number" });
    });
  });

  describe("isComplexItemSchema", () => {
    it("treats structured and union schemas as complex", () => {
      expect(isComplexItemSchema({ type: "object" })).toBe(true);
      expect(isComplexItemSchema({ type: ["array", "null"] })).toBe(true);
      expect(isComplexItemSchema({ properties: { a: {} } })).toBe(true);
      expect(isComplexItemSchema({ items: { type: "string" } })).toBe(true);
      expect(isComplexItemSchema({ anyOf: [{ type: "string" }] })).toBe(true);
      expect(isComplexItemSchema({ oneOf: [{ type: "string" }] })).toBe(true);
      expect(isComplexItemSchema({ allOf: [{ type: "string" }] })).toBe(true);
    });

    it("treats primitive schemas as simple", () => {
      expect(isComplexItemSchema({ type: "string" })).toBe(false);
      expect(isComplexItemSchema({ type: ["number", "null"] })).toBe(false);
      expect(isComplexItemSchema({ enum: ["a", "b"] })).toBe(false);
    });
  });

  describe("buildArrayItemsUiOverlay", () => {
    it("hides labels of array items, including nested arrays", () => {
      const schema = {
        type: "object",
        properties: {
          repositories: {
            type: "array",
            items: { type: "string" },
          },
          matrix: {
            type: "array",
            items: { type: "array", items: { type: "number" } },
          },
          since: { type: "string" },
        },
      };

      expect(buildArrayItemsUiOverlay(schema)).toEqual({
        repositories: { items: { "ui:label": false } },
        matrix: {
          items: { "ui:label": false, items: { "ui:label": false } },
        },
      });
    });

    it("hides value labels of record entries, including inside unions", () => {
      const schema = {
        type: "object",
        properties: {
          product_updates: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                { type: "object", additionalProperties: {} },
              ],
            },
          },
        },
      };

      expect(buildArrayItemsUiOverlay(schema)).toEqual({
        product_updates: {
          items: {
            "ui:label": false,
            anyOf: [
              { "ui:label": false },
              {
                "ui:label": false,
                additionalProperties: { "ui:label": false },
              },
            ],
          },
        },
      });
    });

    it("returns undefined when the schema contains no arrays", () => {
      expect(
        buildArrayItemsUiOverlay({
          type: "object",
          properties: { name: { type: "string" } },
        }),
      ).toBeUndefined();
    });
  });

  describe("errorPropertyToFieldId", () => {
    it("maps property paths to RJSF field ids", () => {
      expect(errorPropertyToFieldId(".repositories[0]", "action-input")).toBe(
        "action-input_repositories_0",
      );
      expect(errorPropertyToFieldId(".items[2].name", "action-input")).toBe(
        "action-input_items_2_name",
      );
      expect(errorPropertyToFieldId(".", "action-input")).toBe("action-input");
    });

    it("handles quoted keys with escapes", () => {
      expect(errorPropertyToFieldId(".map['some key']", "root")).toBe(
        "root_map_some key",
      );
      expect(errorPropertyToFieldId(".map['a\\'b']", "root")).toBe(
        "root_map_a'b",
      );
    });
  });

  describe("mergeUiSchemas", () => {
    it("deep merges and lets the override win", () => {
      expect(
        mergeUiSchemas(
          { repositories: { items: { "ui:label": false } } },
          { repositories: { items: { "ui:label": true, "ui:widget": "x" } } },
        ),
      ).toEqual({
        repositories: { items: { "ui:label": true, "ui:widget": "x" } },
      });
    });

    it("returns the other side when one is missing", () => {
      expect(mergeUiSchemas(undefined, { a: 1 } as never)).toEqual({ a: 1 });
      expect(mergeUiSchemas({ a: 1 } as never, undefined)).toEqual({ a: 1 });
    });
  });

  describe("buildPanelUiSchema", () => {
    it("hides the root title and preserves property order", () => {
      const schema: RJSFSchema = {
        type: "object",
        properties: {
          first: { type: "string" },
          second: { type: "boolean" },
        },
      };

      expect(buildPanelUiSchema(schema)).toEqual({
        "ui:title": "",
        "ui:order": ["first", "second"],
      });
    });

    it("omits ui:order when the schema has no properties", () => {
      expect(buildPanelUiSchema({ type: "object" })).toEqual({
        "ui:title": "",
      });
    });
  });
});

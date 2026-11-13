/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  fromJsonSchema,
  getKeptKeywords,
  makeDefaultSchemaNode,
  type SchemaNodeForm,
  toJsonSchema,
} from "./JsonSchemaObjectBuilder";

const keepSource = { keepSource: true };
const roundTrip = (schema: unknown) =>
  toJsonSchema(
    fromJsonSchema(schema, "object", undefined, keepSource),
    keepSource,
  );
/** Read a schema the way the form holds it, as an object node. */
const read = (schema: unknown) =>
  fromJsonSchema(schema, "object", undefined, keepSource) as Extract<
    SchemaNodeForm,
    { type: "object" }
  >;

describe("JSON Schema builder conversion", () => {
  describe("without keepSource", () => {
    it("writes only what the form edits and closes every object", () => {
      const schema = {
        type: "object",
        properties: {
          pages: { type: "integer", default: 1, minimum: 1 },
          filters: { type: "object", properties: {} },
        },
        required: ["pages"],
      };

      expect(toJsonSchema(fromJsonSchema(schema))).toEqual({
        type: "object",
        properties: {
          pages: { type: "integer" },
          filters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        required: ["pages"],
        additionalProperties: false,
      });
    });

    it("does not keep the schema a node was read from", () => {
      expect(fromJsonSchema({ type: "string", default: "x" })).toEqual({
        type: "string",
      });
    });
  });

  describe("with keepSource", () => {
    it.each([
      [
        "keywords the form does not edit",
        {
          type: "object",
          properties: {
            question: { type: "string", minLength: 3 },
            pages: { type: "integer", default: 1, minimum: 1 },
            lang: { type: "string", enum: ["en", "fr"], default: "en" },
            when: { type: "string", format: "date-time" },
          },
          required: ["question"],
        },
      ],
      [
        "an object open to other properties",
        { type: "object", properties: { question: { type: "string" } } },
      ],
      [
        "an object closed to other properties",
        {
          type: "object",
          properties: { question: { type: "string" } },
          additionalProperties: false,
        },
      ],
      [
        "an object that declares no properties",
        { type: "object", properties: { meta: { type: "object" } } },
      ],
      [
        "types the form reads loosely",
        {
          type: "object",
          properties: {
            nickname: { type: ["string", "null"] },
            level: { enum: [1, 2, 3] },
            anything: {},
          },
        },
      ],
      [
        "arrays without items, with items and with a tuple",
        {
          type: "object",
          properties: {
            tags: { type: "array" },
            names: { type: "array", items: { type: "string", minLength: 1 } },
            pair: {
              type: "array",
              items: [{ type: "string" }, { type: "number" }],
            },
          },
        },
      ],
      [
        "the draft and the key order",
        {
          $schema: "http://json-schema.org/draft-07/schema#",
          description: "What to answer",
          type: "object",
          required: ["question"],
          properties: { question: { description: "Asked", type: "string" } },
        },
      ],
    ])("writes back %s unchanged", (_, schema) => {
      const written = roundTrip(schema);

      expect(written).toEqual(schema);
      expect(JSON.stringify(written)).toBe(JSON.stringify(schema));
    });

    it("applies what the form edited over the kept schema", () => {
      const node = read({
        type: "object",
        properties: {
          question: { type: "string", minLength: 3 },
          pages: { type: "integer", default: 1 },
        },
        required: ["question"],
      });

      node.properties[0].required = false;
      node.properties[1].required = true;
      node.properties[1].schema.title = "Pages";
      node.properties.push({
        key: "lang",
        required: false,
        schema: makeDefaultSchemaNode("string"),
      });

      expect(toJsonSchema(node, keepSource)).toEqual({
        type: "object",
        properties: {
          question: { type: "string", minLength: 3 },
          pages: { type: "integer", default: 1, title: "Pages" },
          lang: { type: "string" },
        },
        required: ["pages"],
      });
    });

    it("drops the keywords of a property whose type was changed in the form", () => {
      const node = read({
        type: "object",
        properties: { pages: { type: "integer", default: 1, minimum: 1 } },
      });

      // What the type selector does: a new node, without a source.
      node.properties[0].schema = makeDefaultSchemaNode("string");

      expect(toJsonSchema(node, keepSource)).toEqual({
        type: "object",
        properties: { pages: { type: "string" } },
      });
    });

    it("removes a property and what required it", () => {
      const node = read({
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
        additionalProperties: false,
      });

      node.properties = [];

      expect(toJsonSchema(node, keepSource)).toEqual({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
    });

    it("closes the objects added in the form, as the form always did", () => {
      const node = makeDefaultSchemaNode("object", [
        {
          key: "filters",
          required: true,
          schema: makeDefaultSchemaNode("object"),
        },
      ]);

      expect(toJsonSchema(node, keepSource)).toEqual({
        type: "object",
        properties: {
          filters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        required: ["filters"],
        additionalProperties: false,
      });
    });

    it("writes the items given to an array that had none", () => {
      const node = read({
        type: "object",
        properties: { tags: { type: "array", maxItems: 3 } },
      });
      const tags = node.properties[0].schema as Extract<
        SchemaNodeForm,
        { type: "array" }
      >;

      tags.items = makeDefaultSchemaNode("integer");

      expect(toJsonSchema(node, keepSource)).toEqual({
        type: "object",
        properties: {
          tags: { type: "array", maxItems: 3, items: { type: "integer" } },
        },
      });
    });
  });

  describe("getKeptKeywords", () => {
    it("lists the keywords the form does not show", () => {
      expect(
        getKeptKeywords({
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "integer",
          title: "Pages",
          default: 1,
          minimum: 1,
          additionalProperties: false,
        }),
      ).toEqual(["default", "minimum"]);
      expect(getKeptKeywords(undefined)).toEqual([]);
    });
  });
});

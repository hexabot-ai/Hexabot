/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Validator } from "jsonschema";
import { describe, expect, it } from "vitest";

import { WORKFLOW_YAML_SCHEMA } from "./schema";

const validate = (inputs: unknown) =>
  new Validator().validate(
    { defs: {}, flow: [], outputs: {}, inputs },
    WORKFLOW_YAML_SCHEMA as object,
  );

describe("workflow YAML editor schema", () => {
  it("describes inputs.schema as a JSON Schema of type object", () => {
    const schema = (
      WORKFLOW_YAML_SCHEMA.properties?.inputs as {
        properties: { schema: { required: string[]; allOf: unknown[] } };
      }
    ).properties.schema;

    expect(schema.required).toEqual(["type"]);
    expect(schema.allOf).toEqual([
      { $ref: "#/definitions/__workflowInputField" },
    ]);
    expect(
      Object.keys(
        (
          WORKFLOW_YAML_SCHEMA.definitions?.__workflowInputField as {
            properties: object;
          }
        ).properties,
      ),
    ).toEqual(
      expect.arrayContaining([
        "type",
        "default",
        "enum",
        "properties",
        "required",
      ]),
    );
  });

  it("accepts a JSON Schema, with keywords it does not list", () => {
    expect(
      validate({
        schema: {
          type: "object",
          properties: {
            question: { type: "string", minLength: 3 },
            pages: { type: ["integer", "null"], default: 1, multipleOf: 1 },
            tags: {
              type: "array",
              items: { type: "string" },
              uniqueItems: true,
            },
          },
          required: ["question"],
          additionalProperties: false,
        },
      }).errors,
    ).toEqual([]);
  });

  it("flags the field map the definition used to take", () => {
    expect(
      validate({ schema: { question: { type: "string" } } }).errors,
    ).not.toEqual([]);
  });

  it("flags a schema whose root is not an object", () => {
    expect(validate({ schema: { type: "string" } }).errors).not.toEqual([]);
  });
});

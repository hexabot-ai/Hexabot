/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowInputSchema } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import {
  makeDefaultSchemaNode,
  type SchemaNodeForm,
} from "@/app-components/inputs/JsonSchemaObjectBuilder";

import {
  readWorkflowInputSchema,
  writeWorkflowInputSchema,
} from "./workflow-input-schema.utils";

type ObjectNode = Extract<SchemaNodeForm, { type: "object" }>;

const PROPERTIES = {
  question: { type: "string" },
  pages: { type: "integer", default: 1 },
  lang: { type: "string", enum: ["en", "fr"] },
};
const DECLARED: WorkflowInputSchema = {
  type: "object",
  properties: PROPERTIES,
  required: ["question"],
};
const read = (schema?: WorkflowInputSchema) =>
  readWorkflowInputSchema(schema) as ObjectNode;

describe("workflow input schema form", () => {
  it("reports no change for a schema the form left as it was", () => {
    expect(writeWorkflowInputSchema(read(DECLARED), DECLARED)).toBeUndefined();
  });

  it("reports no change for a workflow that declares nothing and still does", () => {
    expect(writeWorkflowInputSchema(read(), undefined)).toBeUndefined();
  });

  it("writes the first fields of a workflow that declared none", () => {
    const node = read();

    node.properties.push({
      key: "question",
      required: true,
      schema: { ...makeDefaultSchemaNode("string"), title: "Question" },
    });

    expect(writeWorkflowInputSchema(node, undefined)).toEqual({
      schema: {
        type: "object",
        properties: { question: { type: "string", title: "Question" } },
        required: ["question"],
        additionalProperties: false,
      },
    });
  });

  it("keeps the keywords it does not edit when a field is added", () => {
    const node = read(DECLARED);

    node.properties.push({
      key: "topic",
      required: false,
      schema: makeDefaultSchemaNode("string"),
    });

    expect(writeWorkflowInputSchema(node, DECLARED)).toEqual({
      schema: {
        ...DECLARED,
        properties: { ...PROPERTIES, topic: { type: "string" } },
      },
    });
  });

  it("takes the schema out of the definition once it has no field left", () => {
    const declared: WorkflowInputSchema = {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    };
    const node = read(declared);

    node.properties = [];

    expect(writeWorkflowInputSchema(node, declared)).toEqual({});
  });

  it("keeps a schema without fields that still constrains the input", () => {
    const declared: WorkflowInputSchema = {
      type: "object",
      properties: { question: { type: "string" } },
      minProperties: 1,
    };
    const node = read(declared);

    node.properties = [];

    expect(writeWorkflowInputSchema(node, declared)).toEqual({
      schema: { type: "object", properties: {}, minProperties: 1 },
    });
  });

  it("does not rewrite a schema that refuses every input, unless it is edited", () => {
    const declared: WorkflowInputSchema = {
      type: "object",
      properties: {},
      additionalProperties: false,
    };

    expect(writeWorkflowInputSchema(read(declared), declared)).toBeUndefined();
  });
});

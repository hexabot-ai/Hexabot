/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowDefinitionSchema } from "@hexabot-ai/agentic";
import type { JSONSchema } from "monaco-yaml";

export const WORKFLOW_SCHEMA_URI =
  "inmemory://model/hexabot-workflow.schema.json";

// "input" keeps defaulted fields optional; the default "output" perspective
// marks them required, causing false warnings and stray completions.
const workflowSchema = WorkflowDefinitionSchema.toJSONSchema({
  target: "draft-07",
  io: "input",
}) as JSONSchema;
const INPUT_FIELD_SCHEMA_REF = "#/definitions/__workflowInputField";
/**
 * The JSON Schema keywords most used to describe an input field. It only
 * drives completion and hover in the editor: any other keyword is accepted,
 * since the workflow validation is what checks `inputs.schema`.
 */
const inputFieldSchema: JSONSchema = {
  type: "object",
  properties: {
    type: {
      description: "Type of the value.",
      anyOf: [
        {
          enum: [
            "string",
            "number",
            "integer",
            "boolean",
            "object",
            "array",
            "null",
          ],
        },
        { type: "array", items: { type: "string" } },
      ],
    },
    title: { type: "string", description: "Label shown in the run form." },
    description: { type: "string", description: "Help shown in the run form." },
    default: { description: "Value used when the input does not give one." },
    enum: { type: "array", description: "The values that are accepted." },
    format: {
      type: "string",
      description: "Format of a string, such as date-time, email or uri.",
    },
    minimum: { type: "number" },
    maximum: { type: "number" },
    minLength: { type: "integer" },
    maxLength: { type: "integer" },
    pattern: { type: "string" },
    items: {
      $ref: INPUT_FIELD_SCHEMA_REF,
      description: "Schema of the items of an array.",
    },
    properties: {
      type: "object",
      description: "The fields of an object, by name.",
      additionalProperties: { $ref: INPUT_FIELD_SCHEMA_REF },
    },
    required: {
      type: "array",
      items: { type: "string" },
      description: "Names of the fields that must be given.",
    },
    additionalProperties: {
      description: "Set to false to refuse fields that are not declared.",
    },
  },
};
/**
 * `inputs.schema` is a JSON Schema of type `object`. The generated schema
 * only says it is an object, so describe it for the editor to complete its
 * keywords.
 */
const withInputSchemaCompletion = (schema: JSONSchema): JSONSchema => {
  const inputs = schema.properties?.inputs;

  if (!inputs || typeof inputs !== "object" || !inputs.properties?.schema) {
    return schema;
  }

  return {
    ...schema,
    definitions: {
      ...schema.definitions,
      __workflowInputField: inputFieldSchema,
    },
    properties: {
      ...schema.properties,
      inputs: {
        ...inputs,
        properties: {
          ...inputs.properties,
          schema: {
            description:
              "JSON Schema of the input a manual workflow is run with. Conversational and scheduled workflows take the input of their trigger and cannot declare one.",
            allOf: [{ $ref: INPUT_FIELD_SCHEMA_REF }],
            properties: { type: { const: "object" } },
            required: ["type"],
          },
        },
      },
    },
  };
};

export const WORKFLOW_YAML_SCHEMA = withInputSchemaCompletion(workflowSchema);

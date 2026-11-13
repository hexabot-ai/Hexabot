/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowInputSchema } from "@hexabot-ai/agentic";

import {
  fromJsonSchema,
  makeDefaultSchemaNode,
  type SchemaNodeForm,
  toJsonSchema,
} from "@/app-components/inputs/JsonSchemaObjectBuilder";

/**
 * What a form changed about the input a manual workflow declares: the schema
 * `inputs.schema` becomes, or none when the workflow declares no input any
 * more and takes any object.
 */
export type WorkflowInputsChange = { schema?: WorkflowInputSchema };

// The schema may be written by hand or over MCP, with keywords the form does
// not edit: they are kept as they are.
const KEEP_SOURCE = { keepSource: true };
/** The keywords an object that declares nothing may still carry. */
const NEUTRAL_KEYWORDS = [
  "$schema",
  "type",
  "properties",
  "additionalProperties",
];
/**
 * Whether a schema declares no field and constrains nothing else, so that
 * writing it down would only say "an object", or refuse every input.
 */
const declaresNothing = (schema: Record<string, unknown>): boolean =>
  Object.keys(schema.properties ?? {}).length === 0 &&
  Object.keys(schema).every((keyword) => NEUTRAL_KEYWORDS.includes(keyword));

/**
 * Read the input schema a definition declares into what the schema form
 * edits.
 *
 * @param schema `inputs.schema` of the definition, if it declares one.
 * @returns The form value: the declared fields, or none.
 */
export const readWorkflowInputSchema = (
  schema: WorkflowInputSchema | undefined,
): SchemaNodeForm =>
  schema
    ? fromJsonSchema(schema, "object", undefined, KEEP_SOURCE)
    : makeDefaultSchemaNode("object");

/**
 * Tell what the schema form changed about the input a definition declares.
 *
 * A schema left as it was is not rewritten, whatever it holds. One left
 * without any field is taken out of the definition: the workflow then takes
 * any object, where an empty schema closed to other properties would refuse
 * every input.
 *
 * @param node The form value.
 * @param declared `inputs.schema` of the definition the form was opened on.
 * @returns The change to apply, or `undefined` when there is none.
 */
export const writeWorkflowInputSchema = (
  node: SchemaNodeForm,
  declared: WorkflowInputSchema | undefined,
): WorkflowInputsChange | undefined => {
  const schema = toJsonSchema(node, KEEP_SOURCE);

  if (declared && JSON.stringify(schema) === JSON.stringify(declared)) {
    return undefined;
  }

  if (declaresNothing(schema)) {
    return declared ? {} : undefined;
  }

  return { schema: schema as WorkflowInputSchema };
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { buildWorkflowInputParser } from '@hexabot-ai/agentic';
import { WorkflowType } from '@hexabot-ai/types';
import { isMap, parseDocument } from 'yaml';

type JsonObject = Record<string, unknown>;

/** The workflow a definition belongs to, as it was stored until v3.6. */
export type LegacyWorkflow = {
  /** The workflow type. */
  type: unknown;
  /** The `inputSchema` the workflow record carried, when it had one. */
  inputSchema?: unknown;
};

export type LegacyWorkflowInputsUpgrade = {
  /** The definition to store: the one given when nothing had to change. */
  definitionYml: string;
  changed: boolean;
  /** What could not be carried over as it was, for the caller to report. */
  warnings: string[];
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Whether a schema accepts any object, which is what a manual workflow takes
 * when it declares nothing: such a schema is not worth writing down.
 */
const acceptsAnyObject = (schema: JsonObject): boolean => {
  const {
    $schema: _$schema,
    type,
    properties,
    additionalProperties,
    ...rest
  } = schema;

  return (
    Object.keys(rest).length === 0 &&
    (type === undefined || type === 'object') &&
    (properties === undefined ||
      (isJsonObject(properties) && Object.keys(properties).length === 0)) &&
    (additionalProperties === undefined ||
      additionalProperties === true ||
      (isJsonObject(additionalProperties) &&
        Object.keys(additionalProperties).length === 0))
  );
};
/**
 * Give the schema of the workflow record as `inputs.schema` can hold it, or
 * say why it cannot.
 */
const readRecordSchema = (
  inputSchema: unknown,
): { schema?: JsonObject; warning?: string } => {
  if (!isJsonObject(inputSchema) || acceptsAnyObject(inputSchema)) {
    return {};
  }

  // A schema without a type was only ever matched against objects.
  const schema =
    inputSchema.type === undefined
      ? { type: 'object', ...inputSchema }
      : inputSchema;
  if (schema.type !== 'object') {
    return {
      warning:
        'the input schema of the workflow does not describe an object and ' +
        'was dropped (no run could match it)',
    };
  }

  try {
    buildWorkflowInputParser(
      schema as Parameters<typeof buildWorkflowInputParser>[0],
    );
  } catch {
    return {
      warning:
        'the input schema of the workflow is not a valid JSON Schema and ' +
        'was dropped (every run was refused with it)',
    };
  }

  return { schema };
};
/**
 * Convert one field of the field map `inputs.schema` held until v3.6 to the
 * JSON Schema matching the same values. A nested object that declared fields
 * refused any other key.
 */
const fieldToJsonSchema = (field: unknown): JsonObject => {
  if (!isJsonObject(field)) {
    return {};
  }

  const { items, properties, ...schema } = field;
  if (items !== undefined) {
    schema.items = fieldToJsonSchema(items);
  }

  if (isJsonObject(properties) && Object.keys(properties).length > 0) {
    schema.properties = fieldsToJsonSchema(properties);
    schema.additionalProperties = false;
  }

  return schema;
};
const fieldsToJsonSchema = (fields: JsonObject): JsonObject =>
  Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      fieldToJsonSchema(field),
    ]),
  );

/**
 * Bring the `inputs` of a definition written for v3.6 or earlier to the form
 * definitions have since v3.7.0, where `inputs.schema` is a JSON Schema and
 * the only description of the input of a manual workflow.
 *
 * - A manual workflow whose record carried an input schema of its own gets
 *   that schema as `inputs.schema`: it is the one its callers and the editor
 *   knew. It replaces the fields the definition declared, if any.
 * - Otherwise, the field map of the definition (`{ question: { type: string } }`)
 *   becomes the JSON Schema accepting the same input: every field optional,
 *   no other key allowed.
 * - A conversational or scheduled workflow loses its `inputs`: its input is
 *   the one of its trigger.
 *
 * A definition already in the new form is returned as it is, so this is safe
 * to run again, and on definitions of any version. A definition that changes
 * is written the way `Workflow.stringifyDefinition` writes one: its comments
 * are kept, its spacing and line folding may not be.
 *
 * @param definitionYml The stored definition.
 * @param workflow The workflow it belongs to.
 * @returns The definition to store, and what could not be carried over.
 */
export const upgradeLegacyWorkflowInputs = (
  definitionYml: string,
  workflow: LegacyWorkflow,
): LegacyWorkflowInputsUpgrade => {
  const unchanged = { definitionYml, changed: false, warnings: [] };
  const document = parseDocument(definitionYml);
  const root = document.contents;
  if (document.errors.length > 0 || !isMap(root)) {
    return unchanged;
  }

  const upgraded = (warnings: string[] = []) => ({
    definitionYml: document.toString(),
    changed: true,
    warnings,
  });

  if (workflow.type !== WorkflowType.manual) {
    if (!root.has('inputs')) {
      return unchanged;
    }

    root.delete('inputs');

    return upgraded();
  }

  const declared = (document.toJS() as JsonObject).inputs;
  const declaredSchema = isJsonObject(declared) ? declared.schema : undefined;
  if (isJsonObject(declaredSchema) && declaredSchema.type === 'object') {
    return unchanged;
  }

  const fields =
    isJsonObject(declaredSchema) && Object.keys(declaredSchema).length > 0
      ? declaredSchema
      : undefined;
  const record = readRecordSchema(workflow.inputSchema);
  const warnings = record.warning ? [record.warning] : [];
  const schema =
    record.schema ??
    (fields && {
      type: 'object',
      properties: fieldsToJsonSchema(fields),
      additionalProperties: false,
    });
  if (record.schema && fields) {
    warnings.push(
      `the fields the definition declared (${Object.keys(fields).join(', ')}) ` +
        'were replaced by the input schema of the workflow',
    );
  }

  if (schema) {
    if (isJsonObject(declared)) {
      document.setIn(['inputs', 'schema'], document.createNode(schema));
    } else {
      // Before the flow, where `inputs` is usually written.
      const pair = document.createPair('inputs', {
        schema,
      }) as (typeof root.items)[number];
      const flowIndex = root.items.findIndex(
        (item) => (item.key as { value?: unknown } | null)?.value === 'flow',
      );
      root.delete('inputs');
      root.items.splice(flowIndex < 0 ? root.items.length : flowIndex, 0, pair);
    }

    return upgraded(warnings);
  }

  if (declaredSchema !== undefined && isJsonObject(declared)) {
    // An empty field map declared nothing.
    if (Object.keys(declared).length === 1) {
      root.delete('inputs');
    } else {
      document.deleteIn(['inputs', 'schema']);
    }

    return upgraded(warnings);
  }

  return warnings.length > 0 ? { ...unchanged, warnings } : unchanged;
};

/**
 * Take the `inputs` of a definition out of it, for the versions that read
 * them as a field map (v3.6 and earlier) and kept the input schema of a
 * workflow on its record.
 *
 * @param definitionYml The stored definition.
 * @returns The definition without `inputs`, and the schema it declared.
 */
export const extractWorkflowInputs = (
  definitionYml: string,
): { definitionYml: string; changed: boolean; inputSchema?: JsonObject } => {
  const document = parseDocument(definitionYml);
  const root = document.contents;
  if (document.errors.length > 0 || !isMap(root) || !root.has('inputs')) {
    return { definitionYml, changed: false };
  }

  const declared = (document.toJS() as JsonObject).inputs;
  const schema = isJsonObject(declared) ? declared.schema : undefined;
  root.delete('inputs');

  return {
    definitionYml: document.toString(),
    changed: true,
    inputSchema: isJsonObject(schema) ? schema : undefined,
  };
};

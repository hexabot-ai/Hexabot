/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { TASK_KIND } from "@hexabot-ai/agentic";
import type { JSONSchema } from "monaco-yaml";

import type { WorkflowBindingsCatalog } from "@/contexts/workflow-bindings.context";
import type { IAction } from "@/types/action.types";

import { extractDefinitionNamesByKind } from "../../utils/workflow-definition.utils";

import { WORKFLOW_YAML_SCHEMA } from "./schema";

const asSchema = (schema: unknown): JSONSchema => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new TypeError("Expected an object JSON schema");

  return schema;
};
const getProperty = (schema: JSONSchema, key: string) =>
  asSchema(schema.properties?.[key]);
const extendSchema = (
  schema: JSONSchema,
  ...extensions: JSONSchema[]
): JSONSchema =>
  Object.assign({}, schema, ...extensions, {
    required: schema.required,
    properties: Object.assign(
      {},
      schema.properties,
      ...extensions.map(({ properties }) => properties),
    ),
  });
const enumSchema = (values: readonly string[]): JSONSchema => ({
  type: "string",
  ...(values.length ? { enum: [...values].sort() } : {}),
});

export const buildWorkflowYamlSchema = (
  actions: IAction[] = [],
  bindings: WorkflowBindingsCatalog = {},
  defs: Record<string, unknown> = {},
): JSONSchema => {
  const schema = structuredClone(WORKFLOW_YAML_SCHEMA);
  const createReference = (kind: string): JSONSchema => {
    const reference = enumSchema(extractDefinitionNamesByKind(defs, kind));

    return bindings[kind]?.multiple
      ? { type: "array", items: reference }
      : reference;
  };
  const createReferences = (kinds: readonly string[]): JSONSchema => ({
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      kinds.map((kind) => [kind, createReference(kind)]),
    ),
  });
  const defsSchema = getProperty(schema, "defs");
  const definitionSchema = asSchema(defsSchema.additionalProperties);
  const [taskSchema, bindingSchema] = definitionSchema.anyOf!.map(asSchema);
  const bindingSettings = getProperty(bindingSchema, "settings");
  const inputs = getProperty(taskSchema, "inputs");
  const settings = getProperty(taskSchema, "settings");
  const actionSchema = enumSchema(actions.map(({ name }) => name));
  const { action: _action, ...bindingProperties } = bindingSchema.properties!;

  asSchema(defsSchema.propertyNames).doNotSuggest = true;

  const actionVariants = actions.map((action) =>
    extendSchema(taskSchema, {
      properties: {
        action: { type: "string", const: action.name },
        inputs: extendSchema(inputs, action.inputSchema),
        settings: extendSchema(settings, action.settingSchema),
        bindings: createReferences(action.supportedBindings),
      },
    }),
  );
  const bindingVariants = Object.entries(bindings).flatMap(([kind, binding]) =>
    (binding.actionPolicy === "required" && actions.length
      ? actions
      : [undefined]
    ).map((action) =>
      extendSchema(
        { ...bindingSchema, properties: bindingProperties },
        {
          properties: {
            kind: { type: "string", const: kind },
            settings: extendSchema(
              bindingSettings,
              binding.schema,
              action?.settingSchema ?? {},
            ),
            bindings: createReferences(
              action?.supportedBindings ?? binding.supportedBindings ?? [],
            ),
            ...(binding.actionPolicy !== "forbidden" && {
              action: action
                ? { type: "string", const: action.name }
                : actionSchema,
            }),
          },
        },
      ),
    ),
  );

  definitionSchema.anyOf = [
    ...(actionVariants.length ? actionVariants : [taskSchema]),
    ...(bindingVariants.length ? bindingVariants : [bindingSchema]),
  ];

  const flowItem = asSchema(getProperty(schema, "flow").items);
  const flowStep = schema.definitions![flowItem.$ref!.split("/").at(-1)!];
  const doStep = flowStep
    .anyOf!.map(asSchema)
    .find(({ properties }) => properties?.do)!;

  doStep.properties!.do = enumSchema(
    extractDefinitionNamesByKind(defs, TASK_KIND),
  );

  return schema;
};

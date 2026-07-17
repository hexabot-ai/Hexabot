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

const asSchema = (schema: boolean | JSONSchema | undefined) =>
  schema && typeof schema === "object" ? schema : undefined;
const getProperties = (schema: JSONSchema) => (schema.properties ??= {});
const extendSchema = (
  schema: JSONSchema,
  extension: JSONSchema,
): JSONSchema => ({
  ...schema,
  ...extension,
  required: schema.required,
  properties: { ...schema.properties, ...extension.properties },
});
const enumSchema = (values: readonly string[]): JSONSchema => ({
  type: "string",
  ...(values.length ? { enum: [...values].sort() } : {}),
});
const createReferences = (
  kinds: readonly string[],
  bindings: WorkflowBindingsCatalog,
  defs: Record<string, unknown>,
): JSONSchema => ({
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    kinds.map((kind) => {
      const reference = enumSchema(extractDefinitionNamesByKind(defs, kind));

      return [
        kind,
        bindings[kind]?.multiple
          ? { type: "array", items: reference }
          : reference,
      ];
    }),
  ),
});

export const buildWorkflowYamlSchema = (
  actions: IAction[] = [],
  bindings: WorkflowBindingsCatalog = {},
  defs: Record<string, unknown> = {},
): JSONSchema => {
  const schema = structuredClone(WORKFLOW_YAML_SCHEMA);
  const defsSchema = asSchema(schema.properties?.defs);
  const definitionNames = asSchema(defsSchema?.propertyNames);
  const definitionSchema = asSchema(defsSchema?.additionalProperties);
  const [taskSchema, bindingSchema] =
    definitionSchema?.anyOf?.map(asSchema) ?? [];

  if (definitionNames) definitionNames.doNotSuggest = true;

  if (definitionSchema && taskSchema && bindingSchema) {
    const bindingSettings = asSchema(getProperties(bindingSchema).settings)!;
    const inputs = asSchema(getProperties(taskSchema).inputs)!;
    const settings = asSchema(getProperties(taskSchema).settings)!;
    const actionSchema = enumSchema(actions.map(({ name }) => name));
    const actionVariants = actions.map((action) =>
      extendSchema(taskSchema, {
        properties: {
          action: { type: "string", const: action.name },
          inputs: extendSchema(inputs, action.inputSchema),
          settings: extendSchema(settings, action.settingSchema),
          bindings: createReferences(action.supportedBindings, bindings, defs),
        },
      }),
    );
    const bindingVariants = Object.entries(bindings).map(([kind, binding]) => {
      const variant = extendSchema(bindingSchema, {
        properties: {
          kind: { type: "string", const: kind },
          settings: extendSchema(bindingSettings, binding.schema),
          bindings: createReferences(
            binding.supportedBindings ?? [],
            bindings,
            defs,
          ),
        },
      });
      const properties = getProperties(variant);

      if (binding.actionPolicy === "forbidden") delete properties.action;
      else properties.action = actionSchema;

      return variant;
    });

    definitionSchema.anyOf = [
      ...(actionVariants.length ? actionVariants : [taskSchema]),
      ...(bindingVariants.length ? bindingVariants : [bindingSchema]),
    ];
  }

  const flowSchema = asSchema(schema.properties?.flow);
  const flowItem = Array.isArray(flowSchema?.items)
    ? undefined
    : asSchema(flowSchema?.items);
  const flowStepName = flowItem?.$ref?.split("/").at(-1);
  const doStep = asSchema(schema.definitions?.[flowStepName ?? ""])
    ?.anyOf?.map(asSchema)
    .find((candidate) => candidate?.properties?.do);

  if (doStep)
    getProperties(doStep).do = enumSchema(
      extractDefinitionNamesByKind(defs, TASK_KIND),
    );

  return schema;
};

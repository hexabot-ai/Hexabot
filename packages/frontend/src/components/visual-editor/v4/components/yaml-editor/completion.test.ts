/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { JSONSchema } from "monaco-yaml";
import { describe, expect, it } from "vitest";

import type { WorkflowBindingsCatalog } from "@/contexts/workflow-bindings.context";
import type { IAction } from "@/types/action.types";

import { extractDefsFromYaml } from "../../utils/workflow-definition.utils";

import { buildWorkflowYamlSchema } from "./completion";

const asSchema = (schema: boolean | JSONSchema | undefined) =>
  schema as JSONSchema;
const getDefinitionSchema = (
  schema: JSONSchema,
  kind: string,
  action?: string,
) => {
  const defs = asSchema(schema.properties?.defs);
  const definitions = asSchema(defs.additionalProperties);
  const variants = definitions.anyOf?.map(asSchema) ?? [];

  return variants.find(
    (variant) =>
      asSchema(variant.properties?.kind).const === kind &&
      (!action || asSchema(variant.properties?.action).const === action),
  )!;
};
const itemSchema = (schema: JSONSchema) =>
  asSchema(Array.isArray(schema.items) ? schema.items[0] : schema.items);
const objectSchema = (properties: JSONSchema["properties"]): JSONSchema => ({
  type: "object",
  properties,
  additionalProperties: false,
  required: Object.keys(properties ?? {}),
});
const action = (
  name: string,
  inputs: JSONSchema["properties"],
  settings: JSONSchema["properties"] = {},
  supportedBindings: string[] = [],
) =>
  ({
    name,
    supportedBindings,
    inputSchema: objectSchema(inputs),
    settingSchema: objectSchema(settings),
  }) as unknown as IAction;
const catalogAction = action(
  "ai_agent",
  { input_mode: { type: "string", enum: ["prompt", "history"] } },
  { max_output_tokens: { type: "number" } },
  ["memory", "tools"],
);
const attachmentAction = action("attachment", {
  attachment: { type: "string" },
});
const bindings: WorkflowBindingsCatalog = {
  memory: {
    multiple: true,
    actionPolicy: "forbidden",
    schema: objectSchema({ definition_id: { type: "string" } }),
  },
  tools: {
    multiple: true,
    actionPolicy: "required",
    schema: objectSchema({ api_key: { type: "string" } }),
  },
};

describe("YAML completion schema", () => {
  it("keeps the generated schema immutable", () => {
    const schema = buildWorkflowYamlSchema();
    const defs = asSchema(schema.properties?.defs);

    buildWorkflowYamlSchema([catalogAction], bindings);

    expect(buildWorkflowYamlSchema()).toEqual(schema);
    expect(asSchema(defs.propertyNames).doNotSuggest).toBe(true);
  });

  it("adds action names, inputs, settings, and supported bindings", () => {
    const schema = buildWorkflowYamlSchema(
      [catalogAction, attachmentAction],
      bindings,
      {
        memory: { kind: "memory" },
        ai_agent_2: { kind: "tools" },
        incomplete: null,
      },
    );
    const task = getDefinitionSchema(schema, "task", "ai_agent");
    const attachmentTask = getDefinitionSchema(schema, "task", "attachment");
    const inputs = asSchema(task.properties?.inputs);
    const attachmentInputs = asSchema(attachmentTask.properties?.inputs);
    const settings = asSchema(task.properties?.settings);
    const taskBindings = asSchema(task.properties?.bindings);
    const memoryReferences = asSchema(taskBindings.properties?.memory);
    const toolReferences = asSchema(taskBindings.properties?.tools);

    expect(asSchema(task.properties?.action).const).toBe("ai_agent");
    expect(inputs.properties).toHaveProperty("input_mode");
    expect(inputs.properties).not.toHaveProperty("attachment");
    expect(inputs.additionalProperties).toBe(false);
    expect(inputs.required).toBeUndefined();
    expect(attachmentInputs.properties).toHaveProperty("attachment");
    expect(attachmentInputs.properties).not.toHaveProperty("input_mode");
    expect(settings.properties).toHaveProperty("max_output_tokens");
    expect(settings.properties).toHaveProperty("timeout_ms");
    expect(itemSchema(memoryReferences).enum).toEqual(["memory"]);
    expect(itemSchema(toolReferences).enum).toEqual(["ai_agent_2"]);
  });

  it("filters binding settings by definition kind", () => {
    const schema = buildWorkflowYamlSchema([catalogAction], bindings);
    const memorySettings = asSchema(
      getDefinitionSchema(schema, "memory").properties?.settings,
    );
    const toolSettings = asSchema(
      getDefinitionSchema(schema, "tools", "ai_agent").properties?.settings,
    );

    expect(memorySettings.properties).toHaveProperty("definition_id");
    expect(memorySettings.properties).not.toHaveProperty("api_key");
    expect(memorySettings.required).toBeUndefined();
    expect(toolSettings.properties).toHaveProperty("api_key");
    expect(toolSettings.properties).toHaveProperty("max_output_tokens");
    expect(toolSettings.properties).not.toHaveProperty("definition_id");
  });

  it("adds task ids to every flow do reference", () => {
    const defs = extractDefsFromYaml(
      "defs:\n  send_message:\n    kind: task\n  ai_agent:\n    kind: task\n  incomplete:",
    );
    const schema = buildWorkflowYamlSchema(undefined, undefined, defs);
    const item = itemSchema(asSchema(schema.properties?.flow));
    const ref = item.$ref?.split("/").at(-1);
    const step = asSchema(ref ? schema.definitions?.[ref] : undefined);
    const doStep = step.anyOf
      ?.map(asSchema)
      .find((variant) => variant.properties?.do);

    expect(asSchema(doStep?.properties?.do).enum).toEqual([
      "ai_agent",
      "send_message",
    ]);
  });
});

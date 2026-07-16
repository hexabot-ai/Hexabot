/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import { WORKFLOW_YAML_SCHEMA } from "./schema";

const getTaskDefSchema = () => {
  const defsSchema = WORKFLOW_YAML_SCHEMA.properties?.defs;

  if (!defsSchema || typeof defsSchema === "boolean") {
    throw new Error("Expected defs schema to be an object");
  }

  const additionalProperties = defsSchema.additionalProperties;

  if (!additionalProperties || typeof additionalProperties === "boolean") {
    throw new Error("Expected defs.additionalProperties to be an object");
  }

  const taskSchema = additionalProperties.anyOf?.find(
    (candidate) =>
      typeof candidate !== "boolean" &&
      candidate.properties?.action !== undefined,
  );

  if (!taskSchema || typeof taskSchema === "boolean") {
    throw new Error("Expected to find the task branch of defs' anyOf");
  }

  return taskSchema;
};

describe("WORKFLOW_YAML_SCHEMA", () => {
  it("drops the trivial propertyNames on a task's inputs record so monaco-yaml doesn't offer a generic 'property' placeholder", () => {
    const taskSchema = getTaskDefSchema();
    const inputsSchema = taskSchema.properties?.inputs;

    if (!inputsSchema || typeof inputsSchema === "boolean") {
      throw new Error("Expected inputs schema to be an object");
    }

    expect(inputsSchema.propertyNames).toBeUndefined();
    expect(inputsSchema.additionalProperties).toBeDefined();
  });

  it("keeps propertyNames where it carries a real constraint (defs' snake_case key pattern)", () => {
    const defsSchema = WORKFLOW_YAML_SCHEMA.properties?.defs;

    if (!defsSchema || typeof defsSchema === "boolean") {
      throw new Error("Expected defs schema to be an object");
    }

    const propertyNames = defsSchema.propertyNames;

    if (!propertyNames || typeof propertyNames === "boolean") {
      throw new Error("Expected defs.propertyNames to be an object");
    }

    expect(propertyNames.pattern).toBe("^[a-z0-9]+(?:_[a-z0-9]+)*$");
  });
});

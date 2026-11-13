/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";
import { resolveWorkflowInputSchema, WorkflowType } from "@hexabot-ai/types";
import { describe, expect, it } from "vitest";

import {
  getDeclaredInputSchemaKey,
  resolveInputSchemaFromKey,
} from "./useWorkflowInputSchema";

const buildDefinition = (
  schema?: Record<string, unknown>,
  outputs: Record<string, string> = {},
): WorkflowDefinition =>
  ({
    defs: {},
    flow: [],
    outputs,
    ...(schema ? { inputs: { schema } } : {}),
  }) as WorkflowDefinition;
const QUESTION = {
  type: "object",
  properties: { question: { type: "string" } },
  required: ["question"],
};
const resolve = (
  type: WorkflowType | undefined,
  definition: WorkflowDefinition | undefined,
) =>
  resolveInputSchemaFromKey(type, getDeclaredInputSchemaKey(type, definition));

describe("workflow input schema of the editor", () => {
  it("gives a manual workflow the input its definition declares", () => {
    expect(resolve(WorkflowType.manual, buildDefinition(QUESTION))).toEqual(
      QUESTION,
    );
  });

  it("gives a manual workflow that declares nothing any object", () => {
    expect(resolve(WorkflowType.manual, buildDefinition())).toEqual(
      resolveWorkflowInputSchema(WorkflowType.manual),
    );
  });

  it.each([WorkflowType.conversational, WorkflowType.scheduled])(
    "gives a %s workflow the input of its trigger",
    (type) => {
      expect(resolve(type, buildDefinition(QUESTION))).toBe(
        resolveWorkflowInputSchema(type),
      );
    },
  );

  it("gives nothing when no workflow is open", () => {
    expect(resolve(undefined, undefined)).toBeUndefined();
  });

  it("identifies the declared input by its content, not by the parsed definition", () => {
    const key = getDeclaredInputSchemaKey(
      WorkflowType.manual,
      buildDefinition(QUESTION),
    );

    // An edit elsewhere parses the definition again: new objects, same input.
    expect(
      getDeclaredInputSchemaKey(
        WorkflowType.manual,
        buildDefinition(structuredClone(QUESTION), { done: "=true" }),
      ),
    ).toBe(key);
    expect(
      getDeclaredInputSchemaKey(
        WorkflowType.manual,
        buildDefinition({ ...QUESTION, required: [] }),
      ),
    ).not.toBe(key);
    expect(
      getDeclaredInputSchemaKey(
        WorkflowType.conversational,
        buildDefinition(QUESTION),
      ),
    ).toBeUndefined();
  });
});

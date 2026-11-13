/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";
import { resolveWorkflowInputSchema, WorkflowType } from "@hexabot-ai/types";
import type { JSONSchema7 as JsonSchema } from "json-schema";
import { useMemo } from "react";

/**
 * Give the input a manual workflow declares as a string, which is equal for
 * two definitions that declare the same input.
 *
 * @returns The declared `inputs.schema` as JSON, or `undefined` when the
 * workflow declares none or takes the input of its trigger.
 */
export const getDeclaredInputSchemaKey = (
  type: WorkflowType | undefined,
  definition: WorkflowDefinition | undefined,
): string | undefined => {
  const declared =
    type === WorkflowType.manual ? definition?.inputs?.schema : undefined;

  return declared ? JSON.stringify(declared) : undefined;
};

/**
 * Give the input schema of a workflow from its type and the input it
 * declares (see {@link getDeclaredInputSchemaKey}).
 */
export const resolveInputSchemaFromKey = (
  type: WorkflowType | undefined,
  declaredKey: string | undefined,
): JsonSchema | undefined =>
  type
    ? resolveWorkflowInputSchema(
        type,
        declaredKey
          ? { inputs: { schema: JSON.parse(declaredKey) } }
          : undefined,
      )
    : undefined;

/**
 * Give the JSON Schema of the input the workflow being edited is run with:
 * the one its trigger fixes, or, for a manual workflow, the one its
 * definition declares under `inputs.schema`.
 *
 * The definition is parsed again on every edit, so the schema is compared by
 * content: the returned object only changes when the declared input does.
 * What reads it (the run form, the `$input` suggestions) is not reset by
 * edits made elsewhere in the definition.
 *
 * @param type The type of the workflow, if one is open.
 * @param definition The definition being edited.
 * @returns The input schema, or `undefined` when no workflow is open.
 */
export const useWorkflowInputSchema = (
  type: WorkflowType | undefined,
  definition: WorkflowDefinition | undefined,
): JsonSchema | undefined => {
  const declaredKey = getDeclaredInputSchemaKey(type, definition);

  return useMemo(
    () => resolveInputSchemaFromKey(type, declaredKey),
    [declaredKey, type],
  );
};

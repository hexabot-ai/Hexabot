/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowDefinitionSchema } from "@hexabot-ai/agentic";
import type { JSONSchema } from "monaco-yaml";

export const WORKFLOW_SCHEMA_URI =
  "inmemory://model/hexabot-workflow.schema.json";

// Zod emits a trivial `propertyNames: { type: "string" }` on every record
// type, which makes monaco-yaml offer a useless generic "property" suggestion
// alongside the real ones from completion.ts. Rebuild the tree without it,
// keeping meaningful constraints intact (e.g. defs' snake_case key pattern).
const stripTrivialPropertyNames = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(stripTrivialPropertyNames);
  if (typeof node !== "object" || node === null) return node;

  const record = node as Record<string, unknown>;
  const propertyNames = record.propertyNames as
    | Record<string, unknown>
    | undefined;
  const dropPropertyNames =
    record.type === "object" &&
    record.additionalProperties &&
    propertyNames &&
    Object.keys(propertyNames).length === 1 &&
    "type" in propertyNames;

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "propertyNames" || !dropPropertyNames)
      .map(([key, value]) => [key, stripTrivialPropertyNames(value)]),
  );
};
const workflowSchema = stripTrivialPropertyNames(
  // "input" keeps defaulted fields optional; the default "output" perspective
  // marks them required, causing false warnings and stray completions.
  WorkflowDefinitionSchema.toJSONSchema({ target: "draft-07", io: "input" }),
);

export const WORKFLOW_YAML_SCHEMA = workflowSchema as JSONSchema;

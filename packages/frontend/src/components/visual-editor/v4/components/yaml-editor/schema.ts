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
});

export const WORKFLOW_YAML_SCHEMA = workflowSchema as JSONSchema;

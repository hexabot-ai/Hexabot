/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { validateWorkflow } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import type { IAction } from "@/types/action.types";

import { createWorkflowValidationActions } from "./workflow-validation.utils";

const action = {
  name: "send_message",
  inputSchema: {
    type: "object",
    properties: { recipient: { type: "string" } },
    required: ["recipient"],
  },
  settingSchema: {
    type: "object",
    properties: { channel: { type: "string" } },
    required: ["channel"],
  },
  outputSchema: {},
  supportedBindings: [],
} as unknown as IAction;
const yaml = [
  "defs:",
  "  send_message_task:",
  "    kind: task",
  "    action: send_message",
  "flow:",
  "  - do: send_message_task",
  "outputs:",
  '  result: "=$output.send_message_task"',
].join("\n");

describe("workflow action catalog validation adapter", () => {
  it("lets the shared validator report catalog schema issues", () => {
    const actions = createWorkflowValidationActions(
      new Map([[action.name, action]]),
    );
    const result = validateWorkflow(yaml, { actions });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "action_inputs",
          path: ["defs", "send_message_task", "inputs", "recipient"],
        }),
        expect.objectContaining({
          code: "action_settings",
          path: ["defs", "send_message_task", "settings", "channel"],
        }),
      ]),
    );
  });
});

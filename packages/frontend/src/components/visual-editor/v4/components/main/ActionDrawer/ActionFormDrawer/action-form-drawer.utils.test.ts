/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_TIMEOUT_MS,
  type TaskDefinition,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import {
  applyTaskEdits,
  buildNewTask,
  getTaskSettingsFormState,
  getWorkflowExecutionDefaults,
  splitTaskSettings,
} from "./action-form-drawer.utils";

const sendTask: TaskDefinition = {
  kind: "task",
  description: "Send the reply",
  action: "send_text",
  inputs: { text: "Hello" },
  settings: { channel: "web", timeout_ms: 500 },
};
const definition: WorkflowDefinition = {
  defaults: { settings: { timeout_ms: 1000 } },
  defs: {
    send: sendTask,
    other: { kind: "task", action: "noop" },
  },
  flow: [{ do: "send" }, { do: "other" }],
  outputs: {},
};

describe("splitTaskSettings", () => {
  it("returns empty settings without a task settings object", () => {
    expect(splitTaskSettings(undefined)).toEqual({
      actionSettings: {},
      executionSettings: {},
      hasExecutionOverride: false,
    });
  });

  it("separates the execution settings from the action settings", () => {
    expect(
      splitTaskSettings({
        channel: "web",
        timeout_ms: 500,
        retries: { max_attempts: 2 },
      }),
    ).toEqual({
      actionSettings: { channel: "web" },
      executionSettings: { timeout_ms: 500, retries: { max_attempts: 2 } },
      hasExecutionOverride: true,
    });
  });

  it("reports no override when only action settings are set", () => {
    expect(splitTaskSettings({ channel: "web" }).hasExecutionOverride).toBe(
      false,
    );
  });
});

describe("getWorkflowExecutionDefaults", () => {
  it("falls back to the default timeout and retries", () => {
    expect(getWorkflowExecutionDefaults(undefined)).toEqual({
      timeout_ms: DEFAULT_TIMEOUT_MS,
      retries: DEFAULT_RETRY_SETTINGS,
    });
  });

  it("applies the workflow execution settings and ignores the others", () => {
    expect(
      getWorkflowExecutionDefaults({ timeout_ms: 1000, channel: "web" }),
    ).toEqual({ timeout_ms: 1000, retries: DEFAULT_RETRY_SETTINGS });
  });
});

describe("getTaskSettingsFormState", () => {
  const workflowDefaults = getWorkflowExecutionDefaults({ timeout_ms: 1000 });

  it("shows the workflow defaults when the task overrides nothing", () => {
    const formState = getTaskSettingsFormState(
      { channel: "web" },
      workflowDefaults,
    );

    expect(formState.actionSettings).toEqual({ channel: "web" });
    expect(formState.executionSettings).toBe(workflowDefaults);
    expect(formState.usesWorkflowExecutionDefaults).toBe(true);
  });

  it("merges the task overrides into the workflow defaults", () => {
    expect(
      getTaskSettingsFormState(
        { channel: "web", timeout_ms: 500 },
        workflowDefaults,
      ),
    ).toEqual({
      actionSettings: { channel: "web" },
      executionSettings: { timeout_ms: 500, retries: DEFAULT_RETRY_SETTINGS },
      usesWorkflowExecutionDefaults: false,
    });
  });
});

describe("buildNewTask", () => {
  it("leaves out an empty description, inputs and settings", () => {
    expect(
      buildNewTask("send_text", { description: "", inputs: {}, settings: {} }),
    ).toEqual({ kind: "task", action: "send_text" });
  });

  it("writes the form values in the task key order", () => {
    const task = buildNewTask("send_text", {
      description: "Send the reply",
      inputs: { text: "Hello" },
      settings: { channel: "web" },
    });

    expect(task).toEqual({
      kind: "task",
      action: "send_text",
      description: "Send the reply",
      inputs: { text: "Hello" },
      settings: { channel: "web" },
    });
    expect(Object.keys(task)).toEqual([
      "kind",
      "action",
      "description",
      "inputs",
      "settings",
    ]);
  });
});

describe("applyTaskEdits", () => {
  it("replaces the task values in place, keeping its key order", () => {
    const next = applyTaskEdits(definition, "send", "send", sendTask, {
      description: "Reply",
      inputs: { text: "Hi" },
      settings: { channel: "sms" },
    });

    expect(next.defs.send).toEqual({
      kind: "task",
      description: "Reply",
      action: "send_text",
      inputs: { text: "Hi" },
      settings: { channel: "sms" },
    });
    expect(Object.keys(next.defs.send)).toEqual(Object.keys(sendTask));
    expect(next.defs.other).toBe(definition.defs.other);
    expect(next.flow).toBe(definition.flow);
  });

  it("removes the description when the form empties it", () => {
    const next = applyTaskEdits(definition, "send", "send", sendTask, {
      description: "",
      inputs: { text: "Hello" },
      settings: {},
    });

    expect(next.defs.send).not.toHaveProperty("description");
    expect(sendTask.description).toBe("Send the reply");
  });

  it("keeps emptied inputs and settings the task already had", () => {
    const next = applyTaskEdits(definition, "send", "send", sendTask, {
      description: "Send the reply",
      inputs: {},
      settings: {},
    });

    expect(next.defs.send).toMatchObject({ inputs: {}, settings: {} });
  });

  it("does not add empty inputs and settings the task did not have", () => {
    const next = applyTaskEdits(
      definition,
      "other",
      "other",
      definition.defs.other as TaskDefinition,
      { description: "", inputs: {}, settings: {} },
    );

    expect(next.defs.other).toEqual({ kind: "task", action: "noop" });
  });

  it("renames the task and its flow references", () => {
    const next = applyTaskEdits(definition, "send", "reply", sendTask, {
      description: "Send the reply",
      inputs: { text: "Hello" },
      settings: { channel: "web", timeout_ms: 500 },
    });

    expect(Object.keys(next.defs)).toEqual(["reply", "other"]);
    expect(next.defs.reply).toEqual(sendTask);
    expect(next.flow).toEqual([{ do: "reply" }, { do: "other" }]);
  });
});

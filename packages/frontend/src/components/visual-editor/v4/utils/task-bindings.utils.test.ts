/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { DefDefinition, TaskDefinition } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import {
  mountDefBindingRef,
  mountTaskBindingRef,
  renameDefBindingRefs,
  toBindingRefs,
  unmountDefBindingRef,
  unmountTaskBindingRef,
} from "./task-bindings.utils";

const createTaskDefinition = (
  bindings?: Record<string, string | string[]>,
): TaskDefinition => ({
  kind: "task",
  action: "ai_generate_reply",
  ...(bindings ? { bindings } : {}),
});
const createNonTaskDefinition = (
  bindings?: Record<string, string | string[]>,
): DefDefinition => ({
  kind: "tools",
  action: "search_web",
  settings: {},
  ...(bindings ? { bindings } : {}),
});

describe("task-bindings.utils", () => {
  it("normalizes refs for both multi and single binding kinds", () => {
    expect(toBindingRefs(["a", "b"], true)).toEqual(["a", "b"]);
    expect(toBindingRefs("openai_chatgpt", false)).toEqual(["openai_chatgpt"]);
    expect(toBindingRefs(["openai_chatgpt"], false)).toEqual([
      "openai_chatgpt",
    ]);
    expect(toBindingRefs(undefined, true)).toEqual([]);
    expect(toBindingRefs(undefined, false)).toEqual([]);
  });

  it("mounts multi refs as arrays", () => {
    const task = createTaskDefinition({ tools: ["search"] });
    const nextTask = mountTaskBindingRef(task, "tools", "calculator", true);

    expect(nextTask.bindings?.tools).toEqual(["search", "calculator"]);
  });

  it("mounts single refs as string values", () => {
    const task = createTaskDefinition();
    const nextTask = mountTaskBindingRef(
      task,
      "model",
      "openai_chatgpt",
      false,
    );

    expect(nextTask.bindings?.model).toBe("openai_chatgpt");
  });

  it("unmounts multi refs and keeps array shape", () => {
    const task = createTaskDefinition({ tools: ["search", "calculator"] });
    const nextTask = unmountTaskBindingRef(task, "tools", "search", true);

    expect(nextTask.bindings?.tools).toEqual(["calculator"]);
  });

  it("unmounts single refs and removes binding key", () => {
    const task = createTaskDefinition({ model: "openai_chatgpt" });
    const nextTask = unmountTaskBindingRef(
      task,
      "model",
      "openai_chatgpt",
      false,
    );

    expect(nextTask.bindings?.model).toBeUndefined();
    expect(nextTask.bindings).toBeUndefined();
  });

  it("mounts selected single-binding refs as a single string", () => {
    const task = createTaskDefinition();
    const nextTask = mountTaskBindingRef(
      task,
      "model",
      "anthropic_claude",
      false,
    );

    expect(nextTask.bindings?.model).toBe("anthropic_claude");
  });

  it("mounts and unmounts refs on non-task owner defs", () => {
    const ownerDef = createNonTaskDefinition({ memory: ["profile"] });
    const mounted = mountDefBindingRef(ownerDef, "memory", "session", true);
    const unmounted = unmountDefBindingRef(mounted, "memory", "profile", true);

    expect(mounted.bindings?.memory).toEqual(["profile", "session"]);
    expect(unmounted.bindings?.memory).toEqual(["session"]);
  });

  it("renames the refs of every def that points at the renamed binding", () => {
    const untouched = createTaskDefinition({ memory: ["session"] });
    const defs = renameDefBindingRefs(
      {
        agent: createTaskDefinition({ memory: ["profile", "session"] }),
        router: createNonTaskDefinition({ memory: ["profile"] }),
        other: untouched,
      },
      "memory",
      "profile",
      "user_profile",
      true,
    );

    expect(defs.agent.bindings?.memory).toEqual(["user_profile", "session"]);
    expect(defs.router.bindings?.memory).toEqual(["user_profile"]);
    expect(defs.other).toBe(untouched);
  });

  it("keeps one ref when the def already pointed at the new name", () => {
    const defs = renameDefBindingRefs(
      { agent: createTaskDefinition({ memory: ["profile", "session"] }) },
      "memory",
      "profile",
      "session",
      true,
    );

    expect(defs.agent.bindings?.memory).toEqual(["session"]);
  });

  it("renames single refs as a string", () => {
    const defs = renameDefBindingRefs(
      { agent: createTaskDefinition({ model: "openai" }) },
      "model",
      "openai",
      "anthropic",
      false,
    );

    expect(defs.agent.bindings?.model).toBe("anthropic");
  });
});

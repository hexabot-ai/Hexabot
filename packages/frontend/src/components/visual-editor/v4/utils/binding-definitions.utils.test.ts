/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import {
  unmountBindingMutation,
  updateBindingDefinitionMutation,
} from "./binding-definitions.utils";

const createDefinition = (): WorkflowDefinition => ({
  defs: {
    profile: {
      kind: "memory",
      description: "User profile",
      settings: { provider: "redis" },
    },
    session: { kind: "memory", settings: { provider: "local" } },
    openai: { kind: "model", settings: { provider: "openai" } },
    agent: {
      kind: "task",
      action: "agent_action",
      bindings: { memory: ["profile", "session"], model: "openai" },
    },
    router: {
      kind: "memory_router",
      settings: {},
      bindings: { memory: ["profile"] },
    },
  },
  flow: [{ do: "agent" }],
  outputs: {},
});
const update = (
  definition: WorkflowDefinition,
  args: Partial<Parameters<typeof updateBindingDefinitionMutation>[1]> = {},
) =>
  updateBindingDefinitionMutation(definition, {
    bindingKind: "memory",
    currentBindingName: "profile",
    nextBindingName: "profile",
    settings: { provider: "postgres" },
    description: "User profile",
    multiple: true,
    ...args,
  });

describe("updateBindingDefinitionMutation", () => {
  it("saves the settings and trimmed description in place", () => {
    const definition = createDefinition();
    const next = update(definition, { description: "  Profile  " });

    expect(next.defs.profile).toEqual({
      kind: "memory",
      description: "Profile",
      settings: { provider: "postgres" },
    });
    expect(Object.keys(next.defs)).toEqual(Object.keys(definition.defs));
    expect(next.defs.agent).toBe(definition.defs.agent);
  });

  it("removes the description when it is emptied", () => {
    expect(
      update(createDefinition(), { description: "  " }).defs.profile,
    ).toEqual({ kind: "memory", settings: { provider: "postgres" } });
  });

  it("renames the binding and the refs to it", () => {
    const next = update(createDefinition(), {
      nextBindingName: "user_profile",
    });

    expect(next.defs).not.toHaveProperty("profile");
    expect(next.defs.user_profile).toMatchObject({ kind: "memory" });
    expect(next.defs.agent.bindings?.memory).toEqual([
      "user_profile",
      "session",
    ]);
    expect(next.defs.router.bindings?.memory).toEqual(["user_profile"]);
  });

  it("renames single refs as a string", () => {
    const next = update(createDefinition(), {
      bindingKind: "model",
      currentBindingName: "openai",
      nextBindingName: "gpt",
      multiple: false,
    });

    expect(next.defs.agent.bindings?.model).toBe("gpt");
  });

  it("returns the definition itself when the binding cannot be saved", () => {
    const definition = createDefinition();

    expect(update(definition, { currentBindingName: "missing" })).toBe(
      definition,
    );
    expect(update(definition, { bindingKind: "model" })).toBe(definition);
    expect(update(definition, { nextBindingName: "session" })).toBe(definition);
  });
});

describe("unmountBindingMutation", () => {
  it("removes the ref from the owner bindings", () => {
    const definition = createDefinition();
    const next = unmountBindingMutation(definition, {
      ownerDefName: "agent",
      bindingKind: "memory",
      bindingName: "profile",
      multiple: true,
    });

    expect(next.defs.agent.bindings).toEqual({
      memory: ["session"],
      model: "openai",
    });
    expect(next.defs.profile).toBe(definition.defs.profile);
  });

  it("returns the definition itself when the owner does not reference it", () => {
    const definition = createDefinition();

    expect(
      unmountBindingMutation(definition, {
        ownerDefName: "router",
        bindingKind: "memory",
        bindingName: "session",
        multiple: true,
      }),
    ).toBe(definition);
    expect(
      unmountBindingMutation(definition, {
        ownerDefName: "missing",
        bindingKind: "memory",
        bindingName: "profile",
        multiple: true,
      }),
    ).toBe(definition);
  });
});

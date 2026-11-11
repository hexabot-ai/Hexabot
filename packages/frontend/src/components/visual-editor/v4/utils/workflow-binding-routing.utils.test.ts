/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";
import { ENodeType } from "@hexabot-ai/graph";
import { describe, expect, it } from "vitest";

import type { WorkflowBindingDefinition } from "@/contexts/workflow-bindings.context";

import {
  getBindingNodeTarget,
  getDisabledBindingRefs,
  isNonToolBindingKind,
} from "./workflow-binding-routing.utils";

const createBindingsByName = () =>
  new Map<string, WorkflowBindingDefinition>([
    ["tools", { schema: {}, multiple: true }],
    ["model", { schema: {}, multiple: false }],
    ["memory", { schema: {}, multiple: true }],
  ]);
const createDefinition = (): WorkflowDefinition => ({
  defs: {
    openai_chatgpt: {
      kind: "model",
      settings: {
        provider: "openai",
      },
    },
    profile: {
      kind: "memory",
      settings: {
        provider: "redis",
      },
    },
    agent: {
      kind: "task",
      action: "agent_action",
      bindings: {
        model: "openai_chatgpt",
        memory: ["profile"],
        tools: ["search"],
      },
    },
    memory_router: {
      kind: "memory_router",
      settings: {
        strategy: "all",
      },
      bindings: {
        memory: ["profile"],
      },
    },
  },
  flow: [{ do: "agent" }],
  outputs: {
    result: "=$output.agent",
  },
});

describe("workflow-binding-routing.utils", () => {
  it("recognizes non-tool binding kinds from the catalog", () => {
    const bindingsByName = createBindingsByName();

    expect(isNonToolBindingKind("model", bindingsByName)).toBe(true);
    expect(isNonToolBindingKind("memory", bindingsByName)).toBe(true);
    expect(isNonToolBindingKind("tools", bindingsByName)).toBe(false);
    expect(isNonToolBindingKind("unknown", bindingsByName)).toBe(false);
  });

  it("returns mounted refs as disabled for multiple non-tool kinds", () => {
    const definition = createDefinition();
    const bindingsByName = createBindingsByName();

    expect(
      getDisabledBindingRefs({
        definition,
        ownerDefName: "agent",
        bindingKind: "memory",
        bindingsByName,
      }),
    ).toEqual(["profile"]);
  });

  it("returns an empty list for single non-tool kinds", () => {
    const definition = createDefinition();
    const bindingsByName = createBindingsByName();

    expect(
      getDisabledBindingRefs({
        definition,
        ownerDefName: "agent",
        bindingKind: "model",
        bindingsByName,
      }),
    ).toEqual([]);
  });

  it("supports disabled refs lookup for non-task owner defs", () => {
    const definition = createDefinition();
    const bindingsByName = createBindingsByName();

    expect(
      getDisabledBindingRefs({
        definition,
        ownerDefName: "memory_router",
        bindingKind: "memory",
        bindingsByName,
      }),
    ).toEqual(["profile"]);
  });

  it("returns an empty list for tools and unknown tasks", () => {
    const definition = createDefinition();
    const bindingsByName = createBindingsByName();

    expect(
      getDisabledBindingRefs({
        definition,
        ownerDefName: "agent",
        bindingKind: "tools",
        bindingsByName,
      }),
    ).toEqual([]);
    expect(
      getDisabledBindingRefs({
        definition,
        ownerDefName: "unknown",
        bindingKind: "memory",
        bindingsByName,
      }),
    ).toEqual([]);
  });
});

describe("getBindingNodeTarget", () => {
  const defs = createDefinition().defs;
  const bindingsByName = createBindingsByName();
  const bindingNode = (type: string, data: unknown) => ({ type, data });

  it("opens the tool drawer for a tool binding node", () => {
    expect(
      getBindingNodeTarget(
        bindingNode(ENodeType.BINDING_MULTI, {
          bindingKind: "tools",
          bindingName: "search",
          ownerDefName: "agent",
        }),
        defs,
        bindingsByName,
      ),
    ).toEqual({ drawer: "tool", ownerDefName: "agent", bindingName: "search" });
  });

  it("ignores a tool binding node without its owner", () => {
    expect(
      getBindingNodeTarget(
        bindingNode(ENodeType.BINDING_MULTI, {
          bindingKind: "tools",
          bindingName: "search",
        }),
        defs,
        bindingsByName,
      ),
    ).toBeUndefined();
  });

  it("opens the binding drawer with the kind its definition declares", () => {
    expect(
      getBindingNodeTarget(
        bindingNode(ENodeType.BINDING_SINGLE, {
          bindingKind: "memory",
          bindingName: "openai_chatgpt",
        }),
        defs,
        bindingsByName,
      ),
    ).toEqual({
      drawer: "binding",
      bindingKind: "model",
      bindingName: "openai_chatgpt",
    });
  });

  it("falls back to the node kind for an undefined binding", () => {
    expect(
      getBindingNodeTarget(
        bindingNode(ENodeType.BINDING_MULTI, {
          bindingKind: "memory",
          bindingName: "missing",
        }),
        defs,
        bindingsByName,
      ),
    ).toEqual({
      drawer: "binding",
      bindingKind: "memory",
      bindingName: "missing",
    });
  });

  it("ignores other nodes, unknown kinds and incomplete data", () => {
    const target = (type: string, data: unknown) =>
      getBindingNodeTarget(bindingNode(type, data), defs, bindingsByName);

    expect(
      target("task", { bindingKind: "memory", bindingName: "profile" }),
    ).toBeUndefined();
    expect(
      target(ENodeType.BINDING_SINGLE, {
        bindingKind: "cache",
        bindingName: "x",
      }),
    ).toBeUndefined();
    expect(
      target(ENodeType.BINDING_SINGLE, { bindingName: "profile" }),
    ).toBeUndefined();
    expect(target(ENodeType.BINDING_SINGLE, null)).toBeUndefined();
  });
});

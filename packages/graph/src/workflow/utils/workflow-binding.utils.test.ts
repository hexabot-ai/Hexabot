/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  getBindingAddPayload,
  getBindingRemovalPayload,
} from "./workflow-binding.utils";

const placeholder = {
  stepId: "0",
  stepPath: ["flow", 0],
  ownerDefName: "agent",
  bindingKind: "tools",
};
const mountedBinding = {
  ...placeholder,
  ownerBindingKind: "tools",
  bindingKind: "agent_tool",
  bindingName: "search",
};

describe("workflow-binding.utils", () => {
  it("builds the add payload of a complete binding placeholder", () => {
    expect(getBindingAddPayload("node-1", placeholder)).toEqual({
      nodeId: "node-1",
      stepId: "0",
      stepPath: ["flow", 0],
      ownerDefName: "agent",
      bindingKind: "tools",
    });
  });

  it.each(["stepId", "stepPath", "ownerDefName", "bindingKind"] as const)(
    "cannot add a binding without %s",
    (field) => {
      expect(
        getBindingAddPayload("node-1", { ...placeholder, [field]: undefined }),
      ).toBeUndefined();
    },
  );

  it("removes a mounted binding from its owner's binding slot", () => {
    expect(getBindingRemovalPayload("node-2", mountedBinding)).toEqual({
      nodeId: "node-2",
      stepId: "0",
      stepPath: ["flow", 0],
      ownerDefName: "agent",
      bindingKind: "tools",
      bindingName: "search",
    });
  });

  it("falls back to the node's binding kind without an owner slot", () => {
    expect(
      getBindingRemovalPayload("node-2", {
        ...mountedBinding,
        ownerBindingKind: undefined,
      })?.bindingKind,
    ).toBe("agent_tool");
  });

  it.each(["stepId", "stepPath", "ownerDefName", "bindingName"] as const)(
    "cannot remove a binding without %s",
    (field) => {
      expect(
        getBindingRemovalPayload("node-2", {
          ...mountedBinding,
          [field]: undefined,
        }),
      ).toBeUndefined();
    },
  );

  it("cannot remove a binding without any binding kind", () => {
    expect(
      getBindingRemovalPayload("node-2", {
        ...mountedBinding,
        ownerBindingKind: undefined,
        bindingKind: undefined,
      }),
    ).toBeUndefined();
  });
});

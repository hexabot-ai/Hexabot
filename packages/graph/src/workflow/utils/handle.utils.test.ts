/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ELinkType } from "../types/workflow-node.types";

import { getHandleConfig } from "./handle.utils";
import { parseConditionalBranchIndex } from "./layout/graph-maps";
import {
  buildBindingOutPort,
  buildConditionalOperatorOutPort,
  getBindingOutHandleMeta,
  getConditionalOperatorOutHandleMeta,
  resolveWorkflowPortRule,
} from "./port-rules";

describe("handle.utils", () => {
  it("parses conditional operator out handle metadata", () => {
    expect(getConditionalOperatorOutHandleMeta("operatorOut-1-3")).toEqual({
      index: 1,
      total: 3,
    });
    expect(
      getConditionalOperatorOutHandleMeta("operatorOut-4-3"),
    ).toBeUndefined();
    expect(
      getConditionalOperatorOutHandleMeta("operatorOut-x-y"),
    ).toBeUndefined();
  });

  it("parses dynamic binding handle metadata", () => {
    expect(getBindingOutHandleMeta("bindingOut-1-3-tools")).toEqual({
      baseId: ELinkType.BINDING_OUT,
      index: 1,
      total: 3,
      bindingKind: "tools",
    });
    expect(getBindingOutHandleMeta("bindingOut-0-2-tools")).toEqual({
      baseId: ELinkType.BINDING_OUT,
      index: 0,
      total: 2,
      bindingKind: "tools",
    });
    expect(getBindingOutHandleMeta("bindingOut-x-y-tools")).toBeUndefined();
  });

  it("parses the indexed out ports it builds", () => {
    const bindingPort = buildBindingOutPort("my tools/v2", 0, 2);

    expect(buildConditionalOperatorOutPort(2, 3)).toBe("operatorOut-2-3");
    expect(
      getConditionalOperatorOutHandleMeta(
        buildConditionalOperatorOutPort(2, 3),
      ),
    ).toEqual({ index: 2, total: 3 });
    expect(bindingPort).toBe("bindingOut-0-2-my%20tools%2Fv2");
    expect(getBindingOutHandleMeta(bindingPort)).toEqual({
      baseId: ELinkType.BINDING_OUT,
      index: 0,
      total: 2,
      bindingKind: "my tools/v2",
    });
  });

  it("reads branch indexes from conditional operator out handles only", () => {
    expect(
      parseConditionalBranchIndex(buildConditionalOperatorOutPort(1, 2)),
    ).toBe(1);
    expect(parseConditionalBranchIndex(ELinkType.OPERATOR_OUT)).toBe(-1);
    expect(parseConditionalBranchIndex(undefined)).toBe(-1);
    expect(parseConditionalBranchIndex(null)).toBe(-1);
    expect(
      parseConditionalBranchIndex(buildBindingOutPort("operatorOut-1-2", 0, 1)),
    ).toBe(-1);
  });

  it("resolves handle config for conditional out handles", () => {
    const config = getHandleConfig("operatorOut-1-3", "horizontal");

    expect(config.type).toBe("source");
    expect(config.position).toBe(Position.Right);
    expect(config.style?.top).toBe("50%");
  });

  it("resolves dynamic binding handle positions for horizontal and vertical directions", () => {
    const horizontal = getHandleConfig("bindingOut-1-3-tools", "horizontal");
    const vertical = getHandleConfig("bindingOut-1-3-tools", "vertical");

    expect(horizontal.position).toBe(Position.Bottom);
    expect(horizontal.style?.left).toBe("50%");
    expect(vertical.position).toBe(Position.Left);
    expect(vertical.style?.top).toBe("50%");
  });

  it("keeps port resolution consistent for render and layout rules", () => {
    const rule = resolveWorkflowPortRule(
      ELinkType.BINDING_MULTI_IN,
      "horizontal",
    );
    const handle = getHandleConfig(ELinkType.BINDING_MULTI_IN, "horizontal");

    expect(rule.type).toBe(handle.type);
    expect(rule.position).toBe(handle.position);
    expect(rule.position).toBe(Position.Top);
  });
});

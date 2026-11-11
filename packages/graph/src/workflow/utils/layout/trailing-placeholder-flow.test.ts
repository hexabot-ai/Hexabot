/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType } from "@hexabot-ai/agentic";
import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";
import { getWorkflowDefaultConfig } from "../workflow-node.utils";

import { tightenTrailingPlaceholders } from "./trailing-placeholder-flow";

// Task cards are 256 wide, placeholders 64; the layer gap is 186 and a
// group overlay pads its content by 48 (24 per side).
const node = (id: string, type: ENodeType, x: number, y = 0) =>
  ({
    id,
    type,
    position: { x, y },
    measured: type === ENodeType.TASK ? { width: 256, height: 86 } : undefined,
    data: {},
  }) as GraphNode;
const link = (source: string, target: string, hidden = false): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  hidden,
});
const tighten = (
  nodes: GraphNode[],
  edges: Edge[],
  groups = new Map<string, GroupMeta>(),
) =>
  Object.fromEntries(
    tightenTrailingPlaceholders(nodes, edges, groups, {
      config: getWorkflowDefaultConfig("horizontal"),
    }).map((n) => [n.id, n.position]),
  );
const { TASK, INDICATOR, OPERATOR, BRANCH_PLACEHOLDER } = ENodeType;

describe("tightenTrailingPlaceholders", () => {
  it("pulls a trailing placeholder back to one layer gap after its step", () => {
    expect(
      tighten(
        [node("t", TASK, 0), node("p", BRANCH_PLACEHOLDER, 1000, 30)],
        [link("t", "p")],
      ).p,
    ).toEqual({ x: 442, y: 30 });
  });

  it("measures a group source up to its future overlay's padded edge", () => {
    const loop: GroupMeta = {
      id: "g",
      operatorType: StepType.Loop,
      level: 0,
      memberNodeIds: new Set(["m1", "m2"]),
    };

    expect(
      tighten(
        [
          node("m1", TASK, 0),
          node("m2", TASK, 300, 100),
          node("p", BRANCH_PLACEHOLDER, 2000),
        ],
        [link("g", "p")],
        new Map([["g", loop]]),
      ).p,
    ).toEqual({ x: 300 + 256 + 24 + 186, y: 0 });
  });

  it("keeps join and empty-branch placeholders where ELK put them", () => {
    const positions = tighten(
      [
        node("a", TASK, 0),
        node("b", TASK, 0, 200),
        node("op", OPERATOR, 0, 400),
        node("join", BRANCH_PLACEHOLDER, 1000),
        node("empty", BRANCH_PLACEHOLDER, 1000, 400),
      ],
      [link("a", "join"), link("b", "join"), link("op", "empty")],
    );

    expect(positions.join).toEqual({ x: 1000, y: 0 });
    expect(positions.empty).toEqual({ x: 1000, y: 400 });
  });

  it("ignores hidden links when counting a placeholder's sources", () => {
    expect(
      tighten(
        [
          node("a", TASK, 0),
          node("b", TASK, 0, 200),
          node("p", BRANCH_PLACEHOLDER, 1000),
        ],
        [link("a", "p"), link("b", "p", true)],
      ).p,
    ).toEqual({ x: 442, y: 0 });
  });

  it("pulls Stop back to one layer gap after its furthest source", () => {
    const positions = tighten(
      [
        node("t", TASK, 0),
        node("p", BRANCH_PLACEHOLDER, 1000),
        node("t2", TASK, 0, 200),
        node("end", INDICATOR, 1500, 10),
      ],
      [link("t", "p"), link("p", "end"), link("t2", "end")],
    );

    // The placeholder, once tightened (442 + 64), ends after t2 (256).
    expect(positions.p).toEqual({ x: 442, y: 0 });
    expect(positions.end).toEqual({ x: 442 + 64 + 186, y: 10 });
  });

  it("never pushes Stop further along the flow", () => {
    expect(
      tighten(
        [node("t", TASK, 0), node("end", INDICATOR, 300, 10)],
        [link("t", "end")],
      ).end,
    ).toEqual({ x: 300, y: 10 });
  });
});

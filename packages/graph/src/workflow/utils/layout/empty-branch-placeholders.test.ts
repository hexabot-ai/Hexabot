/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import { getWorkflowDefaultConfig } from "../workflow-node.utils";

import { alignEmptyBranchPlaceholders } from "./empty-branch-placeholders";

// Sizes from the default config: task 256x86, operator 156x68,
// placeholder 64x64, binding 200x76; ELK layer gap 186, node spacing 64.
const node = (id: string, type: ENodeType, x: number, y: number) =>
  ({ id, type, position: { x, y }, data: {} }) as GraphNode;
const branch = (target: string, index: number, total: number): Edge => ({
  id: `op->${target}`,
  source: "op",
  target,
  sourceHandle: `operatorOut-${index}-${total}`,
});
const align = (
  nodes: GraphNode[],
  edges: Edge[],
  direction: "horizontal" | "vertical" = "horizontal",
) =>
  Object.fromEntries(
    alignEmptyBranchPlaceholders(nodes, edges, {
      config: getWorkflowDefaultConfig(direction),
    }).map((n) => [n.id, n.position]),
  );
const OPERATOR = ENodeType.OPERATOR;
const TASK = ENodeType.TASK;
const PLACEHOLDER = ENodeType.BRANCH_PLACEHOLDER;

describe("alignEmptyBranchPlaceholders", () => {
  it("spreads the placeholders of an all-empty conditional around its operator", () => {
    const positions = align(
      [
        node("op", OPERATOR, 0, 100),
        node("p0", PLACEHOLDER, 500, 0),
        node("p1", PLACEHOLDER, 500, 0),
        node("p2", PLACEHOLDER, 500, 0),
      ],
      [branch("p0", 0, 3), branch("p1", 1, 3), branch("p2", 2, 3)],
    );

    // One layer after the operator; task-sized slots (86 + 64) centered on
    // the operator's middle (134), each placeholder centered in its slot.
    expect(positions).toEqual({
      op: { x: 0, y: 100 },
      p0: { x: 342, y: -48 },
      p1: { x: 342, y: 102 },
      p2: { x: 342, y: 252 },
    });
  });

  it("uses the width of a task as the slot size in vertical mode", () => {
    const positions = align(
      [
        node("op", OPERATOR, 100, 0),
        node("p0", PLACEHOLDER, 0, 500),
        node("p1", PLACEHOLDER, 0, 500),
      ],
      [branch("p0", 0, 2), branch("p1", 1, 2)],
      "vertical",
    );

    expect(positions.p0).toEqual({ x: -14, y: 254 });
    expect(positions.p1).toEqual({ x: 306, y: 254 });
  });

  it("shares the gap between two non-empty branches, attachments included", () => {
    const positions = align(
      [
        node("op", OPERATOR, 0, 300),
        node("t0", TASK, 400, 0),
        node("tool", ENodeType.BINDING_MULTI, 400, 200),
        node("p1", PLACEHOLDER, 900, 0),
        node("p2", PLACEHOLDER, 900, 0),
        node("t3", TASK, 420, 600),
      ],
      [
        branch("t0", 0, 4),
        branch("p1", 1, 4),
        branch("p2", 2, 4),
        branch("t3", 3, 4),
        {
          id: "t0->tool",
          source: "t0",
          target: "tool",
          sourceHandle: "bindingOut-0-1-tools",
        },
      ],
    );

    // Flow: where the first non-empty branch starts (x = 400). Spread: the
    // gap from the tool's bottom (276) to t3's top (600), minus both
    // placeholders, split into three equal paddings of 65.33.
    expect(positions.p1.x).toBe(400);
    expect(positions.p1.y).toBeCloseTo(341.333, 3);
    expect(positions.p2).toEqual({ x: 400, y: expect.closeTo(470.667, 3) });
    expect(positions.t0).toEqual({ x: 400, y: 0 });
    expect(positions.t3).toEqual({ x: 420, y: 600 });
  });

  it("reads the branch order from the operator handles, not the edges", () => {
    const nodes = [
      node("op", OPERATOR, 0, 100),
      node("t0", TASK, 400, 0),
      node("t1", TASK, 400, 300),
      node("p2", PLACEHOLDER, 500, 50),
    ];

    expect(
      align(nodes, [branch("p2", 2, 3), branch("t1", 1, 3), branch("t0", 0, 3)])
        .p2,
    ).toEqual({ x: 400, y: 504 });
  });

  it("extrapolates past a single non-empty branch with ELK's widest gap", () => {
    const positions = align(
      [
        node("op", OPERATOR, 0, 300),
        node("p0", PLACEHOLDER, 600, 100),
        node("t1", TASK, 400, 250),
        node("p2", PLACEHOLDER, 600, 420),
        node("p3", PLACEHOLDER, 600, 520),
      ],
      [
        branch("p0", 0, 4),
        branch("t1", 1, 4),
        branch("p2", 2, 4),
        branch("p3", 3, 4),
      ],
    );

    // Pitch 170 (the widest gap between ELK's branch positions), one
    // placeholder centered per pitch-sized slot before and after t1.
    expect(positions).toMatchObject({
      p0: { x: 400, y: 27 },
      p2: { x: 400, y: 389 },
      p3: { x: 400, y: 559 },
    });
  });

  it("falls back to a task's size plus 20 when ELK stacked every branch", () => {
    const positions = align(
      [
        node("op", OPERATOR, 0, 300),
        node("p0", PLACEHOLDER, 600, 250),
        node("t1", TASK, 400, 250),
        node("p2", PLACEHOLDER, 600, 250),
      ],
      [branch("p0", 0, 3), branch("t1", 1, 3), branch("p2", 2, 3)],
    );

    expect(positions.p0).toEqual({ x: 400, y: 123 });
    expect(positions.p2).toEqual({ x: 400, y: 357 });
  });

  it("measures the pitch between the outermost non-empty branches", () => {
    const positions = align(
      [
        node("op", OPERATOR, 0, 100),
        node("t0", TASK, 400, 0),
        node("t1", TASK, 400, 300),
        node("p2", PLACEHOLDER, 500, 50),
      ],
      [branch("t0", 0, 3), branch("t1", 1, 3), branch("p2", 2, 3)],
    );

    // Centers 43 and 343 one branch apart: a pitch of 300.
    expect(positions.p2).toEqual({ x: 400, y: 504 });
  });

  it("leaves operators without indexed branches alone", () => {
    const nodes = [
      node("op", OPERATOR, 0, 0),
      node("p0", PLACEHOLDER, 900, 900),
    ];

    expect(
      align(nodes, [{ id: "op->p0", source: "op", target: "p0" }]),
    ).toEqual({ op: { x: 0, y: 0 }, p0: { x: 900, y: 900 } });
  });
});

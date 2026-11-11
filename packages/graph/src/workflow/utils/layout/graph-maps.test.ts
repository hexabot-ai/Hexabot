/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import type { GroupMeta } from "../graph-builder/types";

import { collectGroupSubtreeIds, findNestedGroupIds } from "./graph-maps";

const group = (id: string, level: number, members: string[]): GroupMeta => ({
  id,
  operatorType: StepType.Loop,
  level,
  memberNodeIds: new Set(members),
});
// outer holds a task and the inner group; "other" is a sibling of outer.
const groups = new Map(
  [
    group("outer", 0, ["outer-op", "task", "inner-op", "inner-task"]),
    group("inner", 1, ["inner-op", "inner-task"]),
    group("other", 0, ["other-op"]),
  ].map((meta) => [meta.id, meta]),
);
const nodesById = new Map(
  ["outer", "inner", "outer-op", "task", "tool", "inner-op", "inner-task"].map(
    (id) => [id, { id, type: ENodeType.TASK } as GraphNode],
  ),
);

describe("graph-maps group helpers", () => {
  it("finds the deeper groups sharing a member with the given ids", () => {
    const outer = groups.get("outer")!;

    expect(findNestedGroupIds(outer, groups, outer.memberNodeIds)).toEqual([
      "inner",
    ]);
    expect(findNestedGroupIds(outer, groups, new Set(["task"]))).toEqual([]);
    expect(
      findNestedGroupIds(groups.get("inner")!, groups, new Set(["inner-op"])),
    ).toEqual([]);
  });

  it("collects a group's members, attachments and present overlays", () => {
    expect(
      collectGroupSubtreeIds(
        groups.get("outer")!,
        groups,
        new Map([["task", ["tool"]]]),
        nodesById,
      ),
    ).toEqual(
      new Set([
        "outer-op",
        "task",
        "tool",
        "inner-op",
        "inner-task",
        "outer",
        "inner",
      ]),
    );
    // Overlays not laid out yet are left out.
    expect(
      collectGroupSubtreeIds(
        groups.get("other")!,
        groups,
        new Map(),
        nodesById,
      ),
    ).toEqual(new Set(["other-op"]));
  });
});

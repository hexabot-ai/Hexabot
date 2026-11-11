/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import { getWorkflowDefaultConfig } from "../workflow-node.utils";

import { createPositionTracker } from "./position-tracker";

const node = (id: string, x: number, y: number) =>
  ({ id, type: ENodeType.TASK, position: { x, y }, data: {} }) as GraphNode;

describe("createPositionTracker", () => {
  it.each([
    ["horizontal", { x: 15, y: 27 }],
    ["vertical", { x: 17, y: 25 }],
  ] as const)(
    "moves nodes along the flow and spread axes (%s)",
    (direction, expected) => {
      const tracker = createPositionTracker([node("a", 10, 20)], {
        config: getWorkflowDefaultConfig(direction),
      });

      tracker.move("a", "flow", 5);
      tracker.move("a", "spread", 7);
      tracker.move("missing", "flow", 100);

      expect(tracker.apply()).toEqual([node("a", expected.x, expected.y)]);
    },
  );

  it("reads bounds at the moved position", () => {
    const tracker = createPositionTracker([node("a", 10, 20)], {
      config: getWorkflowDefaultConfig("horizontal"),
    });

    tracker.move("a", "flow", 5);

    expect(tracker.getBounds("a", "flow")).toEqual({
      leading: 15,
      trailing: 15 + 256,
    });
    expect(tracker.getBounds("missing", "flow")).toBeUndefined();
  });

  it("leaves the input nodes untouched", () => {
    const nodes = [node("a", 10, 20)];
    const tracker = createPositionTracker(nodes, {});

    tracker.move("a", "flow", 5);

    expect(nodes[0].position).toEqual({ x: 10, y: 20 });
  });
});

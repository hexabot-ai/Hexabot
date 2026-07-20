/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";
import { beforeEach, expect, it, vi } from "vitest";

import { ENodeType, type GraphNode } from "../../types/workflow-node.types";
import { getWorkflowDefaultConfig } from "../workflow-node.utils";

import { layoutNodesWithElk } from "./elk-layout";

const mocks = vi.hoisted(() => ({ layout: vi.fn() }));

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class {
    layout = mocks.layout;
  },
}));

const node = (id: string, type: ENodeType, grouped = false) =>
  ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: grouped ? { groupName: "group" } : {},
  }) as GraphNode;

beforeEach(() => {
  mocks.layout.mockImplementation(async (graph) => ({
    ...graph,
    children: graph.children.map((child: { id: string }) => ({
      ...child,
      x: 10,
      y: 20,
    })),
  }));
});

it.each([
  ["horizontal", "grouped"],
  ["horizontal", "ungrouped"],
  ["vertical", "grouped"],
  ["vertical", "ungrouped"],
] as const)(
  "does not offset attachment-inflated nodes in %s mode (%s)",
  async (direction, grouping) => {
    const grouped = grouping === "grouped";
    const nodes = [
      node("agent", ENodeType.TASK, grouped),
      node("tool-1", ENodeType.BINDING_MULTI, grouped),
      node("tool-2", ENodeType.BINDING_MULTI, grouped),
    ];
    const edges: Edge[] = ["tool-1", "tool-2"].map((target, index) => ({
      id: `agent-${target}`,
      source: "agent",
      target,
      sourceHandle: `bindingOut-${index}-2-tools`,
    }));
    const result = await layoutNodesWithElk(nodes, edges, {
      config: getWorkflowDefaultConfig(direction),
    });

    expect(result[0]?.position).toEqual({ x: 10, y: 20 });
  },
);

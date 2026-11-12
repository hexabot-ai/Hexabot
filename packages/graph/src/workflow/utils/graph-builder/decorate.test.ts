/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import { ENodeType } from "../../types/workflow-node.types";

import { decorateSemanticGraph } from "./decorate";
import { GraphRegistry } from "./registry";
import type { SemanticEdge, SemanticNode } from "./types";

const semanticNode = (
  id: string,
  groupPath: string[],
  type = ENodeType.TASK,
  meta: Partial<SemanticNode["meta"]> = {},
): SemanticNode => ({
  id,
  type,
  data: {},
  meta: { groupPath, level: groupPath.length, ...meta },
});
const directEdge = (
  source: string,
  target: string,
  extra: Partial<SemanticEdge> = {},
): SemanticEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  kind: "direct",
  ...extra,
});
const decorate = (nodes: SemanticNode[], edges: SemanticEdge[]) => {
  const registry = new GraphRegistry();

  nodes.forEach((node) => registry.upsertNode(node));
  edges.forEach((edge) => registry.upsertEdge(edge));
  decorateSemanticGraph(registry);

  return registry.listEdges();
};
// The overlay edges added for one direct edge, as "source -> target".
const overlaysOf = (sourcePath: string[], targetPath: string[]) =>
  decorate(
    [semanticNode("a", sourcePath), semanticNode("b", targetPath)],
    [directEdge("a", "b")],
  )
    .filter((edge) => edge.kind === "group")
    .map((edge) => `${edge.source} -> ${edge.target}`);

describe("decorateSemanticGraph", () => {
  it.each([
    ["inside one group", ["g1"], ["g1"], []],
    ["at the top level", [], [], []],
    ["into a group", [], ["g1"], ["a -> g1"]],
    ["out of a group", ["g1"], [], ["g1 -> b"]],
    ["into a nested group", ["g1"], ["g1", "g2"], ["a -> g2"]],
    ["out of a nested group", ["g1", "g2"], ["g1"], ["g2 -> b"]],
    ["between sibling groups", ["g1"], ["g3"], ["g1 -> g3"]],
    ["between nested siblings", ["g1", "g2"], ["g1", "g3"], ["g2 -> g3"]],
    ["between cousins", ["g1", "g2"], ["g3"], ["g2 -> g3"]],
  ])(
    "links the innermost groups of an edge %s",
    (_case, sourcePath, targetPath, expected) => {
      expect(overlaysOf(sourcePath, targetPath)).toEqual(expected);
    },
  );

  it("moves the insert button to the overlay and hides the direct edge", () => {
    const edges = decorate(
      [semanticNode("a", []), semanticNode("b", ["g1"])],
      [
        directEdge("a", "b", {
          sourceHandle: "taskOut",
          targetHandle: "operatorIn",
          label: "yes",
          insertPath: ["flow", 1],
        }),
      ],
    );

    expect(edges).toEqual([
      {
        ...directEdge("a", "b"),
        sourceHandle: "taskOut",
        targetHandle: "operatorIn",
        label: "yes",
        hidden: true,
        insertPath: undefined,
      },
      {
        id: "edge:group:a#taskOut->g1",
        source: "a",
        target: "g1",
        // Handles are kept only on the ends that are still the original nodes.
        sourceHandle: "taskOut",
        targetHandle: undefined,
        label: "yes",
        insertPath: ["flow", 1],
        kind: "group",
      },
    ]);
  });

  it("merges the overlays of edges leaving one group for the same node", () => {
    const edges = decorate(
      [
        semanticNode("x", ["g1"]),
        semanticNode("y", ["g1"]),
        semanticNode("end", [], ENodeType.INDICATOR),
      ],
      [
        directEdge("x", "end", { insertPath: ["flow", 1] }),
        directEdge("y", "end", { insertPath: ["flow", 2] }),
      ],
    );

    expect(edges.filter((edge) => edge.kind === "group")).toEqual([
      {
        id: "edge:group:g1->end",
        source: "g1",
        target: "end",
        sourceHandle: undefined,
        targetHandle: undefined,
        label: undefined,
        hidden: false,
        insertPath: ["flow", 2],
        kind: "group",
      },
    ]);
  });

  it("keeps attachment links and links to binding nodes direct", () => {
    const edges = decorate(
      [
        semanticNode("agent", ["g1"]),
        semanticNode("tool", [], ENodeType.BINDING_MULTI),
        semanticNode("model", [], ENodeType.TASK),
      ],
      [
        directEdge("agent", "tool"),
        directEdge("agent", "model", { sourceHandle: "bindingOut-0-1-model" }),
      ],
    );

    expect(edges.map((edge) => [edge.kind, edge.hidden])).toEqual([
      ["direct", undefined],
      ["direct", undefined],
    ]);
  });

  it("hides links from a placeholder into real content", () => {
    const edges = decorate(
      [
        semanticNode("ph", ["g1"], ENodeType.BRANCH_PLACEHOLDER, {
          isPlaceholder: true,
        }),
        semanticNode("next", ["g1"]),
        semanticNode("ph2", ["g1"], ENodeType.BRANCH_PLACEHOLDER, {
          isPlaceholder: true,
        }),
      ],
      [
        directEdge("ph", "next", { insertPath: ["flow", 3] }),
        directEdge("ph", "ph2"),
      ],
    );

    expect(
      edges.map((edge) => [edge.id, edge.hidden, edge.insertPath]),
    ).toEqual([
      ["ph->next", true, ["flow", 3]],
      ["ph->ph2", undefined, undefined],
    ]);
  });

  it("keeps hidden edges hidden and ignores edges to unknown nodes", () => {
    const edges = decorate(
      [semanticNode("a", []), semanticNode("b", [])],
      [directEdge("a", "b", { hidden: true }), directEdge("a", "ghost")],
    );

    expect(edges.map((edge) => [edge.id, edge.hidden])).toEqual([
      ["a->b", true],
      ["a->ghost", undefined],
    ]);
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  generateLayoutFixture,
  NAMED_LAYOUT_FIXTURES,
  type LayoutFixture,
} from "../../test/layout-fixtures";
import type { GraphNode } from "../types/workflow-node.types";

import {
  buildNodesAndEdges,
  getWorkflowDefaultConfig,
} from "./workflow-node.utils";

/*
 * Pins the full output of the graph builder and of every layout pass for a
 * corpus of workflows, so that any change to where a node lands, or to the
 * data and edges the builder emits, shows up in review. When a layout change
 * is intended, update the snapshots (`vitest -u`) and review their diff.
 */

const NAMED_FIXTURES = Object.entries(NAMED_LAYOUT_FIXTURES);
const FIXTURES: Array<[string, LayoutFixture]> = [
  ...NAMED_FIXTURES,
  ...Array.from({ length: 12 }, (_, index): [string, LayoutFixture] => [
    `generated #${index + 1}`,
    generateLayoutFixture(index + 1),
  ]),
];
const DATA_KEYS = [
  "title",
  "i18nTitle",
  "description",
  "stepId",
  "stepPath",
  "taskName",
  "actionName",
  "ownerDefName",
  "ownerBindingKind",
  "bindingKind",
  "bindingName",
  "groupName",
  "level",
  "insertPath",
  "indicator",
  "operatorType",
  "strategy",
];
const round = (value: unknown) => Number(Number(value).toFixed(2)) + 0;
const build = async (
  fixture: LayoutFixture,
  direction: "horizontal" | "vertical",
) => {
  const graph = await buildNodesAndEdges({
    config: getWorkflowDefaultConfig(direction),
    ...fixture,
  });

  if (!graph) {
    throw new Error("Expected a graph");
  }

  return graph;
};
const describePosition = (node: GraphNode) => {
  const style = node.style as { width?: number; height?: number } | undefined;
  const size =
    node.type === "group"
      ? ` ${round(style?.width)}x${round(style?.height)}`
      : "";
  const handles = node.sourcePosition
    ? ` handles ${node.targetPosition}/${node.sourcePosition}`
    : "";

  return `${node.id} @ ${round(node.position.x)},${round(node.position.y)}${size}${handles}`;
};
const describeData = (node: GraphNode) => {
  const data = node.data as Record<string, unknown>;
  const ports = (
    (data.ports ?? []) as Array<string | { id: string; label?: string }>
  )
    .map((port) =>
      typeof port === "string" ? port : `${port.id}(${port.label ?? ""})`,
    )
    .join(" ");
  const fields = DATA_KEYS.filter((key) => data[key] !== undefined).map(
    (key) => `${key}=${JSON.stringify(data[key])}`,
  );

  return [
    `${node.id} ${node.type}${node.selectable ? " selectable" : ""}`,
    `  ports: ${ports}`,
    ...(fields.length ? [`  ${fields.join(" ")}`] : []),
  ].join("\n");
};
const describeEdge = (edge: Edge) => {
  const end = (id: string, handle?: string | null) =>
    handle ? `${id}#${handle}` : id;
  const insertPath = (edge.data as { insertPath?: unknown } | undefined)
    ?.insertPath;

  return [
    `${end(edge.source, edge.sourceHandle)} -> ${end(edge.target, edge.targetHandle)}`,
    edge.hidden ? "hidden" : "",
    insertPath ? `insert=${JSON.stringify(insertPath)}` : "",
    edge.label ? `label=${JSON.stringify(edge.label)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

describe("workflow layout regression", () => {
  describe.each(["horizontal", "vertical"] as const)("%s", (direction) => {
    it.each(FIXTURES)("positions the nodes of %s", async (_name, fixture) => {
      const { nodes } = await build(fixture, direction);

      expect(`\n${nodes.map(describePosition).join("\n")}\n`).toMatchSnapshot();
    });
  });

  it.each(NAMED_FIXTURES)(
    "builds the nodes and edges of %s",
    async (_name, fixture) => {
      const { nodes, edges } = await build(fixture, "horizontal");

      expect(
        `\n${nodes.map(describeData).join("\n")}\n\n${edges.map(describeEdge).join("\n")}\n`,
      ).toMatchSnapshot();
    },
  );
});

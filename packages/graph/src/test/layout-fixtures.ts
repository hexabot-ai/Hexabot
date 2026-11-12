/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  type CompiledStep,
  type DefDefinitions,
} from "@hexabot-ai/agentic";

import type {
  WorkflowAction,
  WorkflowBindingCatalog,
} from "../workflow/types/workflow-node.types";

export type LayoutFixture = {
  flow: CompiledStep[];
  defs: DefDefinitions;
  actionCatalog: ReadonlyMap<string, WorkflowAction>;
  bindingCatalog: WorkflowBindingCatalog;
};

const task = (id: string, taskName: string): CompiledStep => ({
  id,
  label: taskName,
  type: StepType.Task,
  taskName,
});
const conditional = (id: string, branches: CompiledStep[][]): CompiledStep => ({
  id,
  label: "conditional",
  type: StepType.Conditional,
  branches: branches.map((steps, index) => ({
    id: `${id}:when:${index}`,
    ...(index < branches.length - 1
      ? { condition: { kind: "literal" as const, value: `case ${index}` } }
      : {}),
    steps,
  })),
});
const parallel = (
  id: string,
  steps: CompiledStep[],
  strategy: "wait_all" | "wait_any" = "wait_all",
): CompiledStep => ({
  id,
  label: "parallel",
  type: StepType.Parallel,
  strategy,
  steps,
});
const loop = (id: string, steps: CompiledStep[]): CompiledStep => ({
  id,
  label: "loop",
  type: StepType.Loop,
  loopType: "for_each",
  forEach: { item: "item", in: { kind: "literal", value: [] } },
  steps,
});
const DEFS = {
  a: { kind: "task", action: "plain", settings: {}, description: "Step A" },
  b: { kind: "task", action: "plain", settings: {} },
  c: { kind: "task", action: "plain", settings: {} },
  d: { kind: "task", action: "plain", settings: {} },
  agent: {
    kind: "task",
    action: "agent_action",
    description: "Answers",
    settings: {},
    bindings: {
      tools: ["search", "calc", "self_ref", "missing_tool"],
      model: "gpt",
      memory: ["profile"],
      unknown_kind: ["search"],
    },
  },
  search: { kind: "tools", action: "search_action", description: "Search" },
  calc: { kind: "tools" },
  self_ref: {
    kind: "tools",
    action: "agent_action",
    bindings: { tools: ["self_ref", "search"], model: "gpt" },
  },
  gpt: { kind: "model", description: "GPT" },
  profile: { kind: "memory", bindings: { model: "gpt" } },
} as unknown as DefDefinitions;
const ACTION_CATALOG: ReadonlyMap<string, WorkflowAction> = new Map([
  ["plain", { name: "plain" }],
  [
    "agent_action",
    { name: "agent_action", supportedBindings: ["tools", "model", "memory"] },
  ],
  ["search_action", { name: "search_action", supportedBindings: ["model"] }],
]);
const BINDING_CATALOG: WorkflowBindingCatalog = new Map([
  [
    "tools",
    { schema: {}, multiple: true, color: "#ff8800", actionPolicy: "required" },
  ],
  ["model", { schema: {}, multiple: false, icon: "Brain" }],
  [
    "memory",
    {
      schema: {},
      multiple: true,
      actionPolicy: "optional",
      supportedBindings: ["model"],
    },
  ],
]);
const fixture = (flow: CompiledStep[]): LayoutFixture => ({
  flow,
  defs: DEFS,
  actionCatalog: ACTION_CATALOG,
  bindingCatalog: BINDING_CATALOG,
});

/** Workflows exercising each layout rule. */
export const NAMED_LAYOUT_FIXTURES: Record<string, LayoutFixture> = {
  sequence: fixture([task("0", "a"), task("1", "b"), task("2", "c")]),
  "mixed conditional": fixture([
    task("0", "a"),
    conditional("1", [
      [task("1.0", "agent")],
      [],
      [parallel("1.2", [task("1.2.0", "b"), task("1.2.1", "c")])],
    ]),
    loop("2", [task("2.0", "b")]),
    task("3", "d"),
  ]),
  "all-empty conditional": fixture([conditional("0", [[], [], [], []])]),
  "empty branches around content": fixture([
    conditional("0", [[], [task("0.1", "a")], [], [], [task("0.4", "b")], []]),
  ]),
  "nested parallel": fixture([
    parallel(
      "0",
      [
        task("0.0", "a"),
        loop("0.1", [task("0.1.0", "b"), task("0.1.1", "c")]),
        conditional("0.2", [[task("0.2.0", "d")], []]),
      ],
      "wait_any",
    ),
  ]),
  "group chain in a branch": fixture([
    loop("0", [
      parallel("0.0", [task("0.0.0", "a"), task("0.0.1", "b")]),
      task("0.1", "c"),
      conditional("0.2", [[task("0.2.0", "a")], [task("0.2.1", "b")]]),
      task("0.3", "d"),
    ]),
  ]),
  "top-level groups": fixture([
    parallel("0", [task("0.0", "a"), task("0.1", "b")]),
    conditional("1", [[task("1.0", "c")], []]),
    loop("2", [task("2.0", "d")]),
  ]),
  "agent bindings": fixture([task("0", "agent"), task("1", "missing_def")]),
  "deep nesting": fixture([
    conditional("0", [
      [
        parallel("0.0", [
          loop("0.0.0", [conditional("0.0.0.0", [[task("x", "a")], []])]),
          task("0.0.1", "b"),
        ]),
      ],
      [task("0.1", "c")],
    ]),
  ]),
  "group then step in a branch": fixture([
    conditional("0", [
      [
        parallel("0.0", [task("0.0.0", "a"), task("0.0.1", "b")]),
        task("0.1", "c"),
      ],
      [task("0.2", "agent")],
    ]),
  ]),
};

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A random but reproducible workflow mixing every step type, up to 3 levels deep. */
export const generateLayoutFixture = (seed: number): LayoutFixture => {
  const rng = mulberry32(seed);
  const int = (min: number, max: number) =>
    min + Math.floor(rng() * (max - min + 1));
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(rng() * values.length)];
  const maxDepth = int(1, 3);
  let counter = 0;
  const steps = (depth: number, min: number, max: number): CompiledStep[] =>
    Array.from({ length: int(min, max) }, () => step(depth));
  const step = (depth: number): CompiledStep => {
    const id = `s${counter++}`;
    const roll = depth >= maxDepth ? 0 : rng();

    if (roll < 0.5) {
      return task(id, pick(["a", "b", "c", "agent", "missing_def"]));
    }

    if (roll < 0.7) {
      return conditional(
        id,
        Array.from({ length: int(1, 4) }, () =>
          rng() < 0.3 ? [] : steps(depth + 1, 1, 3),
        ),
      );
    }

    if (roll < 0.85) {
      return parallel(
        id,
        rng() < 0.15 ? [] : steps(depth + 1, 1, 3),
        pick(["wait_all", "wait_any"] as const),
      );
    }

    return loop(id, rng() < 0.25 ? [] : steps(depth + 1, 1, 3));
  };

  return fixture(steps(0, 1, 5));
};

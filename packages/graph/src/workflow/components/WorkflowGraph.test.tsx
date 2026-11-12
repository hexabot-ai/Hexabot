/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

// @vitest-environment jsdom

import {
  StepType,
  type CompiledStep,
  type DefDefinitions,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { installXyflowDom } from "../../test/xyflow-dom";
import {
  WorkflowGraph,
  type WorkflowGraphHandle,
  type WorkflowGraphProps,
} from "../index";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const dom = installXyflowDom();
const task = (id: string, taskName: string): CompiledStep => ({
  id,
  label: taskName,
  type: StepType.Task,
  taskName,
});
const defs = {
  greet: { kind: "task", action: "send_action", settings: {} },
  agent: {
    kind: "task",
    action: "agent_action",
    description: "Answers",
    settings: {},
    // gpt is a model def mounted in the tools slot.
    bindings: { tools: ["search", "gpt"], model: "gpt" },
  },
  search: { kind: "tools", action: "search_action" },
  gpt: { kind: "model" },
} as unknown as DefDefinitions;
const FLOW: CompiledStep[] = [
  task("s0", "greet"),
  {
    id: "s1",
    label: "conditional",
    type: StepType.Conditional,
    branches: [
      {
        id: "s1:when:0",
        condition: { kind: "literal", value: "yes" },
        steps: [task("s1.0", "agent")],
      },
      { id: "s1:when:1", steps: [] },
    ],
  } as CompiledStep,
];
const actionCatalog = new Map([
  ["send_action", { name: "send_action" }],
  [
    "agent_action",
    { name: "agent_action", supportedBindings: ["tools", "model"] },
  ],
  ["search_action", { name: "search_action" }],
]);
const bindingCatalog = new Map([
  ["tools", { schema: {}, multiple: true }],
  ["model", { schema: {}, multiple: false }],
]);

type Callback = (...args: any[]) => any;
type Callbacks = Record<string, Mock<Callback>>;
let container: HTMLDivElement;
let root: Root;
let callbacks: Callbacks;
const ref = createRef<WorkflowGraphHandle>();
const createProps = (
  overrides: {
    model?: Partial<WorkflowGraphProps["model"]>;
    viewport?: Partial<WorkflowGraphProps["viewport"]>;
    callbacks?: Partial<WorkflowGraphProps["callbacks"]>;
    colorMode?: WorkflowGraphProps["colorMode"];
    selectedNodeIds?: string[];
  } = {},
): WorkflowGraphProps => ({
  t: (key) => key,
  colorMode: overrides.colorMode,
  model: {
    definition: { defs } as WorkflowDefinition,
    compiledFlow: FLOW,
    actionCatalog,
    bindingCatalog,
    executionStates: {},
    layoutDirection: "horizontal",
    ...overrides.model,
  },
  selection: {
    selectedNodeIds: overrides.selectedNodeIds ?? [],
    onChange: callbacks.onSelectionChange,
  },
  insertion: {
    onInsertAtPath: callbacks.onInsertAtPath,
    onInsertAtRoot: callbacks.onInsertAtRoot,
  },
  viewport: {
    value: { id: "workflow-1", x: 10, y: 20, zoom: 0.8 },
    onChange: callbacks.onViewportChange,
    ...overrides.viewport,
  },
  callbacks: {
    onRemoveStep: callbacks.onRemoveStep,
    onAddBinding: callbacks.onAddBinding,
    onRemoveBinding: callbacks.onRemoveBinding,
    onRotate: callbacks.onRotate,
    onViewNodeCode: callbacks.onViewNodeCode,
    onOpenYamlEditor: callbacks.onOpenYamlEditor,
    ...overrides.callbacks,
  },
});
// Lets the async ELK layout and xyflow's effects settle.
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
};
const render = async (props: WorkflowGraphProps) => {
  await act(async () => {
    root.render(createElement(WorkflowGraph, { ...props, ref }));
  });
  await settle();
};
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
};
const query = (selector: string) => container.querySelector(selector);
// Waits for the animated viewport moves (and their reports) to finish.
const waitForCalls = async (mock: Mock<Callback>, count: number) => {
  for (let i = 0; i < 100 && mock.mock.calls.length < count; i++) {
    await settle();
  }
  await settle();
};

beforeEach(() => {
  callbacks = Object.fromEntries(
    [
      "onSelectionChange",
      "onInsertAtPath",
      "onInsertAtRoot",
      "onViewportChange",
      "onRemoveStep",
      "onAddBinding",
      "onRemoveBinding",
      "onViewNodeCode",
      "onOpenYamlEditor",
    ].map((name) => [name, vi.fn<Callback>()]),
  );
  callbacks.onRotate = vi.fn<Callback>(async () => true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  dom.setPrefersDark(false);
});

const nodeIds = () =>
  [...container.querySelectorAll(".react-flow__node")]
    .map((node) => node.getAttribute("data-id"))
    .sort();
const node = (id: string) => query(`.react-flow__node[data-id="${id}"]`);
const menuItems = () =>
  [...container.querySelectorAll("[role=menu] [role=menuitem]")].map((item) =>
    item.getAttribute("data-item-id"),
  );
const AGENT_STEP_PATH = ["flow", 1, "conditional", "when", 0, "steps", 0];
// The whole graph fitted at once (it does not fit at the current zoom).
const CENTERED = { x: 72.4762, y: 134.2434, zoom: 0.46032 };

describe("WorkflowGraph", () => {
  it("shows a spinner until the flow is compiled, then lays it out", async () => {
    await render(createProps({ model: { compiledFlow: undefined } }));

    expect(query(".workflow-loading-overlay")).not.toBeNull();
    expect(nodeIds()).toEqual([]);

    await render(createProps());

    expect(query(".workflow-loading-overlay")).toBeNull();
    expect(nodeIds()).toEqual([
      "attachment:s1.0:binding-placeholder:agent:tools",
      "attachment:s1.0:binding:agent:model:0:gpt",
      "attachment:s1.0:binding:agent:tools:0:search",
      "attachment:s1.0:binding:agent:tools:1:gpt",
      "group:s1",
      "indicator:end",
      "indicator:start",
      "placeholder:s1:conditional:0",
      "placeholder:s1:conditional:1",
      "step:s0:task",
      "step:s1.0:task",
      "step:s1:operator",
    ]);
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(10);
  });

  it("blocks the canvas with the compile issues, linking them to the YAML", async () => {
    await render(
      createProps({
        model: {
          compiledFlow: undefined,
          issues: [{ message: "Missing action", line: 3 }, { message: "Bad" }],
        },
      }),
    );

    expect(query(".workflow-loading-overlay")).toBeNull();
    expect(
      [...container.querySelectorAll(".workflow-error-message")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Missing action", "Bad"]);
    expect(container.querySelectorAll(".workflow-error-goto")).toHaveLength(1);

    await click(query(".workflow-error-goto"));
    await click(query(".workflow-error-cta"));

    expect(callbacks.onOpenYamlEditor.mock.calls).toEqual([[3], []]);

    await render(
      createProps({
        model: { issues: [{ message: "Missing action", line: 3 }] },
        callbacks: { onOpenYamlEditor: undefined },
      }),
    );

    expect(query(".workflow-error-overlay")).not.toBeNull();
    expect(query(".workflow-error-goto")).toBeNull();
    expect(query(".workflow-error-cta")).toBeNull();
  });

  it("offers the insert menu at the root of an empty workflow", async () => {
    await render(createProps({ model: { compiledFlow: [] } }));

    expect(nodeIds()).toEqual([]);

    await click(query(".workflow-empty-state-action button"));

    expect(menuItems()).toEqual(["step", "conditional", "loop", "parallel"]);

    await click(query("[role=menu] [data-item-id='loop']"));

    expect(callbacks.onInsertAtRoot).toHaveBeenCalledWith(StepType.Loop);
    expect(query("[role=menu]")).toBeNull();
  });

  it("inserts on an edge or into an empty branch at its flow path", async () => {
    await render(createProps());

    expect(
      container.querySelectorAll(".button-edge__label button"),
    ).toHaveLength(4);

    await click(query(".button-edge__label button"));

    expect(menuItems()).toEqual(["step", "conditional", "loop", "parallel"]);

    await click(query("[role=menu] [data-item-id='parallel']"));
    await click(query('[data-id="placeholder:s1:conditional:1"] button'));
    await click(query("[role=menu] [data-item-id='step']"));

    expect(callbacks.onInsertAtPath.mock.calls).toEqual([
      [StepType.Parallel, ["flow", 0]],
      ["step", ["flow", 1, "conditional", "when", 1, "steps", 0]],
    ]);
  });

  it("hides the insert controls when the host cannot insert", async () => {
    await render({ ...createProps(), insertion: undefined });

    expect(
      container.querySelectorAll(".button-edge__label button"),
    ).toHaveLength(0);
    expect(
      (
        query(
          '[data-id="placeholder:s1:conditional:1"] button',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("removes steps and mounted bindings from their delete buttons", async () => {
    await render(createProps());

    const deleteButton = (id: string) =>
      node(id)?.querySelector(".workflow-node-delete-button") ?? null;

    expect(deleteButton("indicator:start")).toBeNull();
    expect(deleteButton("placeholder:s1:conditional:1")).toBeNull();

    await click(deleteButton("step:s0:task"));
    await click(deleteButton("step:s1:operator"));
    await click(deleteButton("attachment:s1.0:binding:agent:tools:0:search"));
    await click(deleteButton("attachment:s1.0:binding:agent:tools:1:gpt"));

    expect(callbacks.onRemoveStep.mock.calls).toEqual([
      [["flow", 0], "step:s0:task"],
      [["flow", 1], "step:s1:operator"],
    ]);
    expect(callbacks.onRemoveBinding.mock.calls).toEqual([
      [
        {
          nodeId: "attachment:s1.0:binding:agent:tools:0:search",
          stepId: "s1.0",
          stepPath: AGENT_STEP_PATH,
          ownerDefName: "agent",
          bindingKind: "tools",
          bindingName: "search",
        },
      ],
      [
        {
          nodeId: "attachment:s1.0:binding:agent:tools:1:gpt",
          stepId: "s1.0",
          stepPath: AGENT_STEP_PATH,
          ownerDefName: "agent",
          // Removed from the slot it is mounted in, not from its own kind.
          bindingKind: "tools",
          bindingName: "gpt",
        },
      ],
    ]);

    await render(createProps({ callbacks: { onRemoveBinding: undefined } }));

    expect(
      deleteButton("attachment:s1.0:binding:agent:tools:0:search"),
    ).toBeNull();
    expect(deleteButton("step:s0:task")).not.toBeNull();
  });

  it("adds a binding from the placeholder of a binding slot", async () => {
    await render(createProps());

    // A single-def slot (model) loses its placeholder once a def is mounted.
    expect(node("attachment:s1.0:binding-placeholder:agent:model")).toBeNull();

    await click(
      query(
        '[data-id="attachment:s1.0:binding-placeholder:agent:tools"] button',
      ),
    );

    expect(callbacks.onAddBinding.mock.calls).toEqual([
      [
        {
          nodeId: "attachment:s1.0:binding-placeholder:agent:tools",
          stepId: "s1.0",
          stepPath: AGENT_STEP_PATH,
          ownerDefName: "agent",
          bindingKind: "tools",
        },
      ],
    ]);

    await render(createProps({ callbacks: { onAddBinding: undefined } }));

    expect(
      (
        query(
          '[data-id="attachment:s1.0:binding-placeholder:agent:tools"] button',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("toggles the definition view of steps and bindings", async () => {
    await render(createProps({ model: { activeCodeDefName: "greet" } }));

    const seeCode = (id: string) =>
      node(id)?.querySelector(".workflow-node-see-code-button") ?? null;

    expect(seeCode("step:s0:task")?.getAttribute("aria-pressed")).toBe("true");
    expect(seeCode("step:s1:operator")).toBeNull();

    await click(seeCode("step:s0:task"));
    await click(seeCode("attachment:s1.0:binding:agent:model:0:gpt"));

    expect(callbacks.onViewNodeCode.mock.calls).toEqual([["greet"], ["gpt"]]);
  });

  it("follows the color mode, tracking the system preference", async () => {
    await render(createProps());

    expect(query(".react-flow")?.classList.contains("light")).toBe(true);

    await act(async () => dom.setPrefersDark(true));

    expect(query(".react-flow")?.classList.contains("dark")).toBe(true);

    await render(createProps({ colorMode: "light" }));

    expect(query(".react-flow")?.classList.contains("light")).toBe(true);
  });

  it("shows the execution state of each step", async () => {
    await render(
      createProps({
        model: {
          executionStates: {
            s0: [
              { state: "start", t: 1 },
              { state: "finish", t: 2 },
            ],
            "s1.0": [{ state: "running", t: 3 }],
          },
        },
      }),
    );

    const isAnimated = (id: string) =>
      node(id)
        ?.querySelector(".workflow-node-card")
        ?.classList.contains("workflow-node-card--animated-execution-border");

    expect(isAnimated("step:s0:task")).toBe(false);
    expect(isAnimated("step:s1.0:task")).toBe(true);
  });

  it("asks the host to rotate the layout", async () => {
    await render(createProps());
    await click(query(".workflow-controls button[title='Rotate']"));

    expect(callbacks.onRotate).toHaveBeenCalledWith("vertical");
  });

  it("opens on the persisted viewport", async () => {
    await render(createProps());

    expect(query(".react-flow__viewport")?.getAttribute("style")).toContain(
      "translate(10px,20px) scale(0.8)",
    );
  });

  it("focuses the inserted step, then the remaining one, saving each viewport", async () => {
    await render(createProps({ model: { compiledFlow: [FLOW[0]] } }));

    // Opening a workflow keeps its persisted viewport and reports nothing.
    expect(callbacks.onViewportChange).not.toHaveBeenCalled();

    await render(createProps());
    await waitForCalls(callbacks.onViewportChange, 1);
    await render(createProps({ model: { compiledFlow: [FLOW[1]] } }));
    await waitForCalls(callbacks.onViewportChange, 2);

    expect(callbacks.onViewportChange.mock.calls).toEqual([
      [
        {
          x: expect.closeTo(-76.8, 3),
          y: expect.closeTo(-71.467, 3),
          zoom: 0.8,
        },
      ],
      [
        {
          x: expect.closeTo(276.8, 3),
          y: expect.closeTo(-63.467, 3),
          zoom: 0.8,
        },
      ],
    ]);
    expect(query(".react-flow__viewport")?.getAttribute("style")).toMatch(
      /translate\(276\.79\d*px,-63\.46\d*px\) scale\(0\.8\)/,
    );
  });

  it("centers the first steps inserted into an empty workflow", async () => {
    const emptyViewport = { value: { id: "workflow-2" } };

    await render(
      createProps({ model: { compiledFlow: [] }, viewport: emptyViewport }),
    );

    expect(query(".react-flow__viewport")?.getAttribute("style")).toContain(
      "translate(600px,400px) scale(1)",
    );

    await act(async () => ref.current?.requestCenterAfterFirstInsert());
    await render(createProps({ viewport: emptyViewport }));
    await waitForCalls(callbacks.onViewportChange, 1);

    expect(callbacks.onViewportChange.mock.calls).toEqual([
      [
        {
          x: expect.closeTo(CENTERED.x, 3),
          y: expect.closeTo(CENTERED.y, 3),
          zoom: expect.closeTo(CENTERED.zoom, 3),
        },
      ],
    ]);
  });

  it("reports the selection of the requested nodes", async () => {
    await render(createProps({ selectedNodeIds: ["step:s0:task", "unknown"] }));

    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith({
      nodeIds: ["step:s0:task"],
      nodes: [
        {
          id: "step:s0:task",
          type: "task",
          stepId: "s0",
          stepPath: ["flow", 0],
          operatorType: undefined,
          taskName: "greet",
          actionName: "send_action",
        },
      ],
    });
  });
});

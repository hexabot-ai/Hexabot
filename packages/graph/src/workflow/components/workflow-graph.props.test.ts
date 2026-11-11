/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType, type WorkflowDefinition } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import {
  areWorkflowGraphPropsEqual,
  type WorkflowGraphModel,
  type WorkflowGraphProps,
  type WorkflowGraphSelection,
} from "./workflow-graph.props";

const fn = () => () => undefined;
const createProps = (): WorkflowGraphProps => {
  const defs = { greet: { kind: "task", action: "send", settings: {} } };

  return {
    t: (key) => key,
    colorMode: "light",
    children: null,
    model: {
      definition: { defs } as unknown as WorkflowDefinition,
      compiledFlow: [
        { id: "0", label: "greet", type: StepType.Task, taskName: "greet" },
      ],
      actionCatalog: new Map(),
      bindingCatalog: new Map(),
      executionStates: {},
      layoutDirection: "horizontal",
      activeCodeDefName: "greet",
      issues: [{ message: "Missing action", line: 3 }],
    },
    selection: {
      selectedNodeIds: ["a", "b"],
      focusNodeIds: ["a"],
      onChange: fn(),
      onFocusComplete: fn(),
    },
    insertion: { onInsertAtPath: fn(), onInsertAtRoot: fn() },
    viewport: {
      value: { id: "workflow-1", x: 10, y: 20, zoom: 1 },
      onChange: fn(),
    },
    callbacks: {
      onNodeClick: fn(),
      onRemoveStep: fn(),
      onAddBinding: fn(),
      onRemoveBinding: fn(),
      onRotate: async () => true,
      onViewNodeCode: fn(),
      onOpenYamlEditor: fn(),
    },
  };
};
// Same values in new arrays and objects: compared by value where it matters.
const copyProps = (props: WorkflowGraphProps): WorkflowGraphProps => ({
  ...props,
  model: {
    ...props.model,
    definition: {
      ...props.model.definition,
    } as WorkflowGraphProps["model"]["definition"],
    issues: props.model.issues?.map((issue) => ({ ...issue })),
  },
  selection: {
    ...props.selection,
    selectedNodeIds: [...props.selection.selectedNodeIds],
    focusNodeIds: props.selection.focusNodeIds && [
      ...props.selection.focusNodeIds,
    ],
  },
  insertion: props.insertion && { ...props.insertion },
  viewport: {
    ...props.viewport,
    value: props.viewport.value && { ...props.viewport.value },
  },
  callbacks: { ...props.callbacks },
});
const PROP_CHANGES: Array<
  [string, (props: WorkflowGraphProps) => WorkflowGraphProps]
> = [
  ["t", (props) => ({ ...props, t: (key) => key })],
  ["colorMode", (props) => ({ ...props, colorMode: "dark" })],
  ["children", (props) => ({ ...props, children: "overlay" })],
  ...(
    [
      ["definition defs", { definition: { defs: {} } as WorkflowDefinition }],
      ["compiledFlow", { compiledFlow: [] }],
      ["actionCatalog", { actionCatalog: new Map() }],
      ["bindingCatalog", { bindingCatalog: new Map() }],
      ["executionStates", { executionStates: {} }],
      ["layoutDirection", { layoutDirection: "vertical" }],
      ["activeCodeDefName", { activeCodeDefName: "other" }],
      ["issue message", { issues: [{ message: "Other", line: 3 }] }],
      ["issue line", { issues: [{ message: "Missing action", line: 4 }] }],
      ["issue count", { issues: [] }],
      ["issues removed", { issues: undefined }],
    ] as Array<[string, Partial<WorkflowGraphModel>]>
  ).map(
    ([name, change]): [
      string,
      (props: WorkflowGraphProps) => WorkflowGraphProps,
    ] => [
      `model.${name}`,
      (props) => ({ ...props, model: { ...props.model, ...change } }),
    ],
  ),
  ...(
    [
      ["selectedNodeIds", { selectedNodeIds: ["a"] }],
      ["selectedNodeIds order", { selectedNodeIds: ["b", "a"] }],
      ["focusNodeIds", { focusNodeIds: ["b"] }],
      ["focusNodeIds removed", { focusNodeIds: undefined }],
      ["onChange", { onChange: fn() }],
      ["onFocusComplete", { onFocusComplete: fn() }],
    ] as Array<[string, Partial<WorkflowGraphSelection>]>
  ).map(
    ([name, change]): [
      string,
      (props: WorkflowGraphProps) => WorkflowGraphProps,
    ] => [
      `selection.${name}`,
      (props) => ({ ...props, selection: { ...props.selection, ...change } }),
    ],
  ),
  [
    "insertion.onInsertAtPath",
    (props) => ({
      ...props,
      insertion: { ...props.insertion, onInsertAtPath: fn() },
    }),
  ],
  [
    "insertion.onInsertAtRoot",
    (props) => ({
      ...props,
      insertion: { ...props.insertion, onInsertAtRoot: fn() },
    }),
  ],
  ["insertion removed", (props) => ({ ...props, insertion: undefined })],
  ...(["id", "x", "y", "zoom"] as const).map(
    (key): [string, (props: WorkflowGraphProps) => WorkflowGraphProps] => [
      `viewport.value.${key}`,
      (props) => ({
        ...props,
        viewport: {
          ...props.viewport,
          value: { ...props.viewport.value, [key]: 2 },
        },
      }),
    ],
  ),
  [
    "viewport.value removed",
    (props) => ({ ...props, viewport: { ...props.viewport, value: null } }),
  ],
  [
    "viewport.onChange",
    (props) => ({ ...props, viewport: { ...props.viewport, onChange: fn() } }),
  ],
  ...(
    [
      "onNodeClick",
      "onRemoveStep",
      "onAddBinding",
      "onRemoveBinding",
      "onRotate",
      "onViewNodeCode",
      "onOpenYamlEditor",
    ] as const
  ).map((key): [string, (props: WorkflowGraphProps) => WorkflowGraphProps] => [
    `callbacks.${key}`,
    (props) => ({
      ...props,
      callbacks: { ...props.callbacks, [key]: fn() },
    }),
  ]),
];

describe("areWorkflowGraphPropsEqual", () => {
  it("treats copies holding the same values as equal", () => {
    const props = createProps();

    expect(areWorkflowGraphPropsEqual(props, props)).toBe(true);
    expect(areWorkflowGraphPropsEqual(props, copyProps(props))).toBe(true);
  });

  it("only compares the definition through its defs", () => {
    const props = createProps();
    const definition = {
      ...props.model.definition,
      metadata: { name: "renamed" },
    } as WorkflowDefinition;

    expect(
      areWorkflowGraphPropsEqual(props, {
        ...props,
        model: { ...props.model, definition },
      }),
    ).toBe(true);
  });

  it("treats a missing viewport and insertion like empty ones", () => {
    const props = createProps();
    const withoutOptional = {
      ...props,
      insertion: undefined,
      viewport: { ...props.viewport, value: undefined },
    };

    expect(
      areWorkflowGraphPropsEqual(withoutOptional, {
        ...withoutOptional,
        insertion: {},
        viewport: { ...props.viewport, value: null },
      }),
    ).toBe(true);
  });

  it.each(PROP_CHANGES)("re-renders when %s changes", (_name, change) => {
    const props = createProps();

    expect(areWorkflowGraphPropsEqual(props, change(copyProps(props)))).toBe(
      false,
    );
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  type CompiledConditionalStep,
  type CompiledLoopStep,
  type CompiledParallelStep,
  type CompiledStep,
  type DefDefinitions,
  type TaskDefinition,
} from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import { NODE_METRICS } from "../constants/workflow.constants";
import {
  ENodeType,
  type INodeConfig,
  type WorkflowAction,
  type WorkflowBindingDefinition,
} from "../types/workflow-node.types";

import {
  END_INDICATOR_ID,
  START_INDICATOR_ID,
  createGroupId,
  createPlaceholderNodeId,
  createStepNodeId,
} from "./graph-builder/id-factory";
import { BRANCH_SPREAD_GAP, FLOW_LAYER_GAP } from "./layout/constants";
import {
  buildNodesAndEdges,
  getWorkflowDefaultConfig,
} from "./workflow-node.utils";

const taskStep = (id: string, taskName: string): CompiledStep => {
  return {
    id,
    label: taskName,
    type: StepType.Task,
    taskName,
  };
};

type TestTaskDefinitions = Record<string, Omit<TaskDefinition, "kind">>;

const withTaskKind = (tasks: TestTaskDefinitions): DefDefinitions => {
  return Object.fromEntries(
    Object.entries(tasks).map(([taskName, taskDefinition]) => [
      taskName,
      {
        kind: "task",
        ...taskDefinition,
      },
    ]),
  );
};
const baseTasks = (taskNames: string[]): TestTaskDefinitions => {
  return taskNames.reduce((acc, taskName) => {
    acc[taskName] = {
      action: `action_${taskName}`,
      settings: {},
    };

    return acc;
  }, {} as TestTaskDefinitions);
};
const createActionCatalog = (
  bindingsByAction: Record<string, readonly string[]>,
): ReadonlyMap<string, WorkflowAction> => {
  return new Map(
    Object.entries(bindingsByAction).map(([actionName, supportedBindings]) => [
      actionName,
      {
        name: actionName,
        supportedBindings,
      },
    ]),
  );
};
const createBindingCatalog = (
  bindingKinds: Array<
    | string
    | {
        kind: string;
        multiple?: boolean;
        color?: string;
        icon?: string;
        supportedBindings?: readonly string[];
        actionPolicy?: "forbidden" | "optional" | "required";
      }
  >,
): ReadonlyMap<string, WorkflowBindingDefinition> => {
  return new Map<string, WorkflowBindingDefinition>(
    bindingKinds.map((bindingKind): [string, WorkflowBindingDefinition] => {
      if (typeof bindingKind === "string") {
        return [
          bindingKind,
          {
            schema: {},
            multiple: true,
          },
        ];
      }

      return [
        bindingKind.kind,
        {
          schema: {},
          multiple: bindingKind.multiple ?? true,
          color: bindingKind.color,
          icon: bindingKind.icon,
          supportedBindings: bindingKind.supportedBindings,
          actionPolicy: bindingKind.actionPolicy,
        },
      ];
    }),
  );
};
const buildGraph = async ({
  flow,
  tasks,
  defs = {},
  actionCatalog = new Map(),
  bindingCatalog = new Map(),
  direction = "horizontal",
}: {
  flow: CompiledStep[];
  tasks: TestTaskDefinitions;
  defs?: DefDefinitions;
  actionCatalog?: ReadonlyMap<string, WorkflowAction>;
  bindingCatalog?: ReadonlyMap<string, WorkflowBindingDefinition>;
  direction?: "horizontal" | "vertical";
}) => {
  const graph = await buildNodesAndEdges({
    config: getWorkflowDefaultConfig(direction),
    flow,
    defs: {
      ...defs,
      ...withTaskKind(tasks),
    },
    actionCatalog,
    bindingCatalog,
  });

  if (!graph) {
    throw new Error("Expected graph to be defined");
  }

  return graph;
};
const getNodePorts = (
  node:
    | {
        data: {
          ports?: Array<string | { id: string }>;
        };
      }
    | undefined,
) => {
  const ports = node?.data.ports ?? [];

  return ports.map((port) => (typeof port === "string" ? port : port.id));
};
const getNodeTitle = (node: { data?: unknown }): string | undefined => {
  const data =
    node.data && typeof node.data === "object"
      ? (node.data as Record<string, unknown>)
      : undefined;

  return typeof data?.title === "string" ? data.title : undefined;
};
const getNodeOwnerDefName = (node: { data?: unknown }): string | undefined => {
  const data =
    node.data && typeof node.data === "object"
      ? (node.data as Record<string, unknown>)
      : undefined;

  return typeof data?.ownerDefName === "string" ? data.ownerDefName : undefined;
};
const getNodeRight = (node: { position: { x: number }; type?: string }) =>
  node.position.x +
  (NODE_METRICS[node.type as ENodeType]?.dimensions.width ?? 0);
const getAttachmentInterval = (
  nodes: Array<{ position: { x: number }; type?: string }>,
) => ({
  left: Math.min(...nodes.map((node) => node.position.x)),
  right: Math.max(...nodes.map(getNodeRight)),
});
const getNodeSpreadSpan = (
  node:
    | {
        position: { x: number; y: number };
        type?: string;
        style?: unknown;
      }
    | undefined,
  direction: "horizontal" | "vertical",
) => {
  if (!node) {
    throw new Error("Expected node to be defined");
  }

  const style = node.style as { width?: number; height?: number } | undefined;
  const dimensions =
    node.type === ENodeType.GROUP
      ? {
          width: style?.width ?? 0,
          height: style?.height ?? 0,
        }
      : (NODE_METRICS[node.type as ENodeType]?.dimensions ?? {
          width: 0,
          height: 0,
        });
  const leading = direction === "vertical" ? node.position.x : node.position.y;
  const size = direction === "vertical" ? dimensions.width : dimensions.height;

  return {
    leading,
    trailing: leading + size,
  };
};
const getNodeSpreadCenter = (
  node: {
    position: { x: number; y: number };
    type?: string;
    style?: unknown;
  },
  direction: "horizontal" | "vertical",
) => {
  const span = getNodeSpreadSpan(node, direction);

  return (span.leading + span.trailing) / 2;
};
const nestedConditionalStep = (id: string): CompiledConditionalStep => ({
  id,
  label: "conditional",
  type: StepType.Conditional,
  branches: [
    {
      id: `${id}:when:0`,
      condition: { kind: "literal", value: "yes" },
      steps: [],
    },
    {
      id: `${id}:when:1`,
      steps: [],
    },
  ],
});
const expectBranchSpansToBeSeparatedAndSymmetric = ({
  branchNodes,
  direction,
  operatorNode,
}: {
  branchNodes: Array<{
    position: { x: number; y: number };
    type?: string;
    style?: unknown;
  }>;
  direction: "horizontal" | "vertical";
  operatorNode: {
    position: { x: number; y: number };
    type?: string;
    style?: unknown;
  };
}) => {
  const spans = branchNodes.map((node) => getNodeSpreadSpan(node, direction));

  spans.forEach((span, index) => {
    if (index === 0) {
      return;
    }

    expect(span.leading).toBeGreaterThanOrEqual(spans[index - 1].trailing);
  });

  const first = spans[0];
  const last = spans[spans.length - 1];
  const branchesCenter = (first.leading + last.trailing) / 2;
  const operatorCenter = getNodeSpreadCenter(operatorNode, direction);

  expect(Math.abs(branchesCenter - operatorCenter)).toBeLessThan(1);
};

describe("buildNodesAndEdges", () => {
  it("always renders action steps as task nodes", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        worker_action: ["model"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "model", multiple: false },
      ]),
    });
    const taskNodeId = createStepNodeId("0:worker", "task");

    expect(graph.nodes.some((node) => node.id === taskNodeId)).toBe(true);
  });

  it("projects node card style variables from node metrics", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          model: "gpt_4o",
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        agent_action: ["model"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "model", multiple: false },
      ]),
    });
    const taskNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("0:agent", "task"),
    );
    const bindingNode = graph.nodes.find(
      (node) => node.type === ENodeType.BINDING_SINGLE,
    );
    const taskStyle = taskNode?.style as Record<string, string | undefined>;
    const bindingStyle = bindingNode?.style as Record<
      string,
      string | undefined
    >;

    expect(taskStyle["--workflow-node-padding-x"]).toBe("16px");
    expect(taskStyle["--workflow-node-padding-y"]).toBe("16px");
    expect(taskStyle["--workflow-node-title-min-height"]).toBe("20px");
    expect(taskStyle["--workflow-node-card-content-variant"]).toBe(
      "title-with-description",
    );
    expect(bindingStyle["--workflow-node-card-content-variant"]).toBe(
      "title-with-description",
    );
  });

  it("uses workflow def description for mounted binding nodes", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          model: "main_model",
        },
        settings: {},
      },
    };
    const graph = await buildNodesAndEdges({
      config: getWorkflowDefaultConfig("horizontal"),
      flow,
      defs: {
        ...withTaskKind(tasks),
        main_model: {
          kind: "model",
          description: "Primary model used by this task",
          settings: {},
        },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["model"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "model", multiple: false },
      ]),
    });
    const bindingNode = graph?.nodes.find(
      (node) => node.type === ENodeType.BINDING_SINGLE,
    );

    expect(
      (bindingNode?.data as { description?: string } | undefined)?.description,
    ).toBe("Primary model used by this task");
  });

  it("falls back to legacy dimensions when nodeMetrics is omitted", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        settings: {},
      },
    };
    const defaultConfig = getWorkflowDefaultConfig("horizontal");
    const legacyConfig: INodeConfig = {
      ...defaultConfig,
      nodeMetrics: undefined,
    };
    const graph = await buildNodesAndEdges({
      config: legacyConfig,
      flow,
      defs: withTaskKind(tasks),
      actionCatalog: createActionCatalog({
        worker_action: [],
      }),
      bindingCatalog: new Map(),
    });

    expect(graph).toBeDefined();
    const taskNode = graph?.nodes.find(
      (node) => node.id === createStepNodeId("0:worker", "task"),
    );

    expect(taskNode?.width).toBe(
      defaultConfig.dimensions?.[ENodeType.TASK]?.width,
    );
    expect(taskNode?.height).toBe(
      defaultConfig.dimensions?.[ENodeType.TASK]?.height,
    );
    expect(taskNode?.measured).toEqual(
      defaultConfig.dimensions?.[ENodeType.TASK],
    );
    expect(taskNode?.style).toBeUndefined();
  });

  it("creates unique tool node IDs for multiple agent tasks using the same binding ref", async () => {
    const flow: CompiledStep[] = [
      taskStep("0:first_agent", "first_agent"),
      taskStep("1:second_agent", "second_agent"),
    ];
    const tasks: TestTaskDefinitions = {
      first_agent: {
        action: "agent_action_a",
        bindings: {
          tools: ["search"],
        },
        settings: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
      second_agent: {
        action: "agent_action_b",
        bindings: {
          tools: ["search"],
        },
        settings: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        agent_action_a: ["model", "tools"],
        agent_action_b: ["model", "tools"],
      }),
      bindingCatalog: createBindingCatalog(["tools"]),
    });
    const toolNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_MULTI,
    );

    expect(toolNodes).toHaveLength(2);
    expect(new Set(toolNodes.map((node) => node.id)).size).toBe(2);
  });

  it("renders mounted tool bindings from task.bindings.tools", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search"],
        },
        settings: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        agent_action: ["model", "tools"],
      }),
      bindingCatalog: createBindingCatalog(["tools"]),
    });
    const agentNodeId = createStepNodeId("0:agent", "task");
    const toolNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_MULTI,
    );
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );

    expect(toolNodes).toHaveLength(1);
    expect((toolNodes[0].data as { title?: string }).title).toBe("search");
    expect(placeholderNodes).toHaveLength(1);
    expect((placeholderNodes[0].data as { title?: string }).title).toBe(
      "tools",
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === agentNodeId &&
          edge.sourceHandle === "bindingOut-0-1-tools",
      ),
    ).toBe(true);
  });

  it("renders mounted memory bindings through generic multi-binding pipeline", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          memory: ["profile"],
        },
        settings: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        agent_action: ["model", "memory"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "model", multiple: false },
        { kind: "memory", multiple: true },
      ]),
    });
    const agentNodeId = createStepNodeId("0:agent", "task");
    const memoryNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_MULTI,
    );
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );
    const agentNode = graph.nodes.find((node) => node.id === agentNodeId);

    expect(memoryNodes).toHaveLength(1);
    expect((memoryNodes[0].data as { title?: string }).title).toBe("profile");
    expect((memoryNodes[0].data as { description?: string }).description).toBe(
      undefined,
    );
    expect(placeholderNodes).toHaveLength(2);
    expect(
      placeholderNodes.some(
        (node) => (node.data as { title?: string }).title === "memory",
      ),
    ).toBe(true);
    expect(getNodePorts(agentNode).includes("agentMemory")).toBe(false);
    expect(getNodePorts(agentNode).includes("bindingOut-1-2-memory")).toBe(
      true,
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === agentNodeId &&
          edge.sourceHandle === "bindingOut-1-2-memory",
      ),
    ).toBe(true);
  });

  it("renders nested binding attachments from mounted binding defs", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        search_tool: {
          kind: "tools",
          action: "search_action",
          settings: {},
          bindings: {
            memory: ["profile_memory"],
          },
        },
        profile_memory: {
          kind: "memory",
          settings: {},
        },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools"],
        search_action: ["memory"],
      }),
      bindingCatalog: createBindingCatalog([
        {
          kind: "tools",
          multiple: true,
          actionPolicy: "required",
          supportedBindings: ["model"],
        },
        { kind: "memory", multiple: true },
        { kind: "model", multiple: false },
      ]),
    });
    const toolNode = graph.nodes.find(
      (node) => getNodeTitle(node) === "search_tool",
    );
    const nestedMemoryNode = graph.nodes.find(
      (node) => getNodeTitle(node) === "profile_memory",
    );

    expect(toolNode).toBeDefined();
    expect(nestedMemoryNode).toBeDefined();
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === toolNode?.id &&
          edge.sourceHandle === "bindingOut-0-1-memory" &&
          edge.target === nestedMemoryNode?.id,
      ),
    ).toBe(true);
  });

  it("positions nested binding placeholders below their owner binding node", async () => {
    const flow: CompiledStep[] = [
      taskStep("0:ai_generate_reply", "ai_generate_reply"),
    ];
    const tasks: TestTaskDefinitions = {
      ai_generate_reply: {
        action: "ai_generate_reply_action",
        bindings: {
          tools: ["ai_generate_reply_2"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        ai_generate_reply_2: {
          kind: "tools",
          action: "ai_generate_reply_action",
          settings: {},
          bindings: {
            model: "model",
          },
        },
        model: {
          kind: "model",
          settings: {},
        },
      },
      actionCatalog: createActionCatalog({
        ai_generate_reply_action: ["tools", "model"],
      }),
      bindingCatalog: createBindingCatalog([
        {
          kind: "tools",
          multiple: true,
          actionPolicy: "required",
        },
        { kind: "model", multiple: false },
      ]),
    });
    const ownerBindingNode = graph.nodes.find(
      (node) => getNodeTitle(node) === "ai_generate_reply_2",
    );
    const nestedPlaceholderNodes = graph.nodes.filter(
      (node) =>
        node.type === ENodeType.BINDING_PLACEHOLDER &&
        getNodeOwnerDefName(node) === "ai_generate_reply_2",
    );

    expect(ownerBindingNode).toBeDefined();
    expect(nestedPlaceholderNodes.length).toBeGreaterThan(0);

    if (!ownerBindingNode) {
      return;
    }

    nestedPlaceholderNodes.forEach((placeholderNode) => {
      expect(placeholderNode.position.y).toBeGreaterThan(
        ownerBindingNode.position.y + 100,
      );
    });
  });

  it("resolves required action-policy nested bindings from action allowlists", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        search_tool: {
          kind: "tools",
          action: "search_action",
          settings: {},
        },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools"],
        search_action: ["memory"],
      }),
      bindingCatalog: createBindingCatalog([
        {
          kind: "tools",
          multiple: true,
          actionPolicy: "required",
          supportedBindings: ["model"],
        },
        { kind: "memory", multiple: true },
        { kind: "model", multiple: false },
      ]),
    });
    const toolNode = graph.nodes.find(
      (node) => getNodeTitle(node) === "search_tool",
    );
    const nestedPlaceholder = graph.nodes.find(
      (node) =>
        node.type === ENodeType.BINDING_PLACEHOLDER &&
        getNodeOwnerDefName(node) === "search_tool" &&
        getNodeTitle(node) === "memory",
    );

    expect(toolNode).toBeDefined();
    expect(getNodePorts(toolNode).includes("bindingOut-0-1-memory")).toBe(true);
    expect(getNodePorts(toolNode).includes("bindingOut-0-1-model")).toBe(false);
    expect(nestedPlaceholder).toBeDefined();
  });

  it("resolves optional action-policy nested bindings from kind allowlists", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        search_tool: {
          kind: "tools",
          action: "search_action",
          settings: {},
        },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools"],
        search_action: ["memory"],
      }),
      bindingCatalog: createBindingCatalog([
        {
          kind: "tools",
          multiple: true,
          actionPolicy: "optional",
          supportedBindings: ["model"],
        },
        { kind: "memory", multiple: true },
        { kind: "model", multiple: false },
      ]),
    });
    const toolNode = graph.nodes.find(
      (node) => getNodeTitle(node) === "search_tool",
    );
    const nestedPlaceholder = graph.nodes.find(
      (node) =>
        node.type === ENodeType.BINDING_PLACEHOLDER &&
        getNodeOwnerDefName(node) === "search_tool" &&
        getNodeTitle(node) === "model",
    );

    expect(toolNode).toBeDefined();
    expect(getNodePorts(toolNode).includes("bindingOut-0-1-model")).toBe(true);
    expect(getNodePorts(toolNode).includes("bindingOut-0-1-memory")).toBe(
      false,
    );
    expect(nestedPlaceholder).toBeDefined();
  });

  it("does not expose nested bindings when required action is missing or unresolved", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        search_tool: {
          kind: "tools",
          action: "missing_action",
          settings: {},
        },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools"],
      }),
      bindingCatalog: createBindingCatalog([
        {
          kind: "tools",
          multiple: true,
          actionPolicy: "required",
          supportedBindings: ["memory"],
        },
        { kind: "memory", multiple: true },
      ]),
    });
    const toolNode = graph.nodes.find(
      (node) => getNodeTitle(node) === "search_tool",
    );
    const nestedPlaceholders = graph.nodes.filter(
      (node) =>
        node.type === ENodeType.BINDING_PLACEHOLDER &&
        getNodeOwnerDefName(node) === "search_tool",
    );

    expect(toolNode).toBeDefined();
    expect(
      getNodePorts(toolNode).some((port) => port.startsWith("bindingOut-")),
    ).toBe(false);
    expect(nestedPlaceholders).toHaveLength(0);
  });

  it("applies binding color and icon metadata to mounted and placeholder nodes", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          memory: ["profile"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        agent_action: ["memory"],
      }),
      bindingCatalog: createBindingCatalog([
        {
          kind: "memory",
          multiple: true,
          color: "#0ea5e9",
          icon: "Database",
        },
      ]),
    });
    const memoryNode = graph.nodes.find(
      (node) => node.type === ENodeType.BINDING_MULTI,
    );
    const placeholderNode = graph.nodes.find(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );

    expect(memoryNode).toBeDefined();
    expect(
      (memoryNode?.data as { theme?: { borderColor?: string; icon?: string } })
        .theme,
    ).toMatchObject({
      borderColor: "#0ea5e9",
      icon: "Database",
    });
    expect(placeholderNode).toBeDefined();
    expect(
      (placeholderNode?.data as { theme?: { borderColor?: string } }).theme,
    ).toMatchObject({
      borderColor: "#0ea5e9",
    });
  });

  it("renders mounted single-ref model bindings from string task bindings", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        bindings: {
          model: "openai_chatgpt",
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        worker_action: ["model"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "model", multiple: false },
      ]),
    });
    const agentNodeId = createStepNodeId("0:worker", "task");
    const modelNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_SINGLE,
    );
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );

    expect(modelNodes).toHaveLength(1);
    expect((modelNodes[0].data as { title?: string }).title).toBe(
      "openai_chatgpt",
    );
    expect(placeholderNodes).toHaveLength(0);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === agentNodeId &&
          edge.sourceHandle === "bindingOut-0-1-model",
      ),
    ).toBe(true);
  });

  it("renders model binding placeholder when model-capable action has no mounted model", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        worker_action: ["model"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "model", multiple: false },
      ]),
    });
    const agentNodeId = createStepNodeId("0:worker", "task");
    const modelNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_SINGLE,
    );
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );

    expect(modelNodes).toHaveLength(0);
    expect(placeholderNodes).toHaveLength(1);
    expect((placeholderNodes[0].data as { title?: string }).title).toBe(
      "model",
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === agentNodeId &&
          edge.sourceHandle === "bindingOut-0-1-model",
      ),
    ).toBe(true);
  });

  it("does not mount legacy settings.provider/model without task model binding", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        settings: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        worker_action: ["model"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "model", multiple: false },
      ]),
    });
    const modelNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_SINGLE,
    );
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );

    expect(modelNodes).toHaveLength(0);
    expect(placeholderNodes).toHaveLength(1);
  });

  it("renders single-binding nodes for custom binding kinds when multiple=false", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        bindings: {
          knowledge_base: "kb_main",
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        worker_action: ["knowledge_base"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "knowledge_base", multiple: false },
      ]),
    });
    const taskNodeId = createStepNodeId("0:worker", "task");
    const singleBindingNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_SINGLE,
    );
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );

    expect(singleBindingNodes).toHaveLength(1);
    expect((singleBindingNodes[0].data as { title?: string }).title).toBe(
      "kb_main",
    );
    expect(placeholderNodes).toHaveLength(0);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === taskNodeId &&
          edge.sourceHandle === "bindingOut-0-1-knowledge_base",
      ),
    ).toBe(true);
  });

  it("renders binding placeholders for tasks with supported bindings", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        worker_action: ["tools"],
      }),
      bindingCatalog: createBindingCatalog(["tools"]),
    });
    const taskNodeId = createStepNodeId("0:worker", "task");
    const taskNode = graph.nodes.find((node) => node.id === taskNodeId);
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );

    expect(taskNode).toBeDefined();
    expect(getNodePorts(taskNode).includes("bindingOut-0-1-tools")).toBe(true);
    expect(placeholderNodes).toHaveLength(1);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === taskNodeId &&
          edge.sourceHandle === "bindingOut-0-1-tools",
      ),
    ).toBe(true);
  });

  it("reserves horizontal layout space for wide binding attachment rows", async () => {
    const flow: CompiledStep[] = [
      taskStep("0:agent", "agent"),
      taskStep("1:next", "next"),
    ];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          mcp: ["mcp_server"],
          memory: ["profile_memory"],
          model: "openai_model",
          tools: ["search_tool"],
        },
        settings: {},
      },
      next: {
        action: "agent_action",
        bindings: {
          mcp: ["next_mcp_server"],
          memory: ["next_profile_memory"],
          model: "next_openai_model",
          tools: ["next_search_tool"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        mcp_server: {
          kind: "mcp",
          settings: {},
        },
        openai_model: {
          kind: "model",
          settings: {},
        },
        profile_memory: {
          kind: "memory",
          settings: {},
        },
        search_tool: {
          kind: "tools",
          settings: {},
        },
        next_mcp_server: {
          kind: "mcp",
          settings: {},
        },
        next_openai_model: {
          kind: "model",
          settings: {},
        },
        next_profile_memory: {
          kind: "memory",
          settings: {},
        },
        next_search_tool: {
          kind: "tools",
          settings: {},
        },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["mcp", "memory", "model", "tools"],
      }),
      bindingCatalog: createBindingCatalog([
        "mcp",
        "memory",
        { kind: "model", multiple: false },
        "tools",
      ]),
    });
    const agentNodeId = createStepNodeId("0:agent", "task");
    const nextNodeId = createStepNodeId("1:next", "task");
    const nextNode = graph.nodes.find((node) => node.id === nextNodeId);
    const agentAttachmentNodes = graph.edges
      .filter(
        (edge) =>
          edge.source === agentNodeId &&
          edge.sourceHandle?.startsWith("bindingOut-"),
      )
      .map((edge) => graph.nodes.find((node) => node.id === edge.target))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
    const nextAttachmentNodes = graph.edges
      .filter(
        (edge) =>
          edge.source === nextNodeId &&
          edge.sourceHandle?.startsWith("bindingOut-"),
      )
      .map((edge) => graph.nodes.find((node) => node.id === edge.target))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));

    expect(nextNode).toBeDefined();
    expect(agentAttachmentNodes.length).toBeGreaterThanOrEqual(4);
    expect(nextAttachmentNodes.length).toBeGreaterThanOrEqual(4);

    if (!nextNode) {
      return;
    }

    const agentAttachmentRight = Math.max(
      ...agentAttachmentNodes.map(getNodeRight),
    );
    const agentAttachmentInterval = getAttachmentInterval(agentAttachmentNodes);
    const nextAttachmentInterval = getAttachmentInterval(nextAttachmentNodes);

    expect(nextNode.position.x).toBeGreaterThan(agentAttachmentRight);
    expect(nextAttachmentInterval.left).toBeGreaterThan(
      agentAttachmentInterval.right,
    );
  });

  it("filters unsupported binding kinds that are missing from the binding catalog", async () => {
    const flow: CompiledStep[] = [taskStep("0:worker", "worker")];
    const tasks: TestTaskDefinitions = {
      worker: {
        action: "worker_action",
        bindings: {
          tools: ["search"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        worker_action: ["tools"],
      }),
      bindingCatalog: createBindingCatalog([]),
    });
    const taskNodeId = createStepNodeId("0:worker", "task");
    const taskNode = graph.nodes.find((node) => node.id === taskNodeId);
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );
    const toolNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_MULTI,
    );

    expect(taskNode).toBeDefined();
    expect(
      getNodePorts(taskNode).some((port) => port.startsWith("bindingOut-")),
    ).toBe(false);
    expect(placeholderNodes).toHaveLength(0);
    expect(toolNodes).toHaveLength(0);
  });

  it("does not mount legacy settings.tools without task bindings", async () => {
    const flow: CompiledStep[] = [taskStep("0:agent", "agent")];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        settings: {
          provider: "openai",
          model: "gpt-4o-mini",
          tools: ["search"],
        },
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      actionCatalog: createActionCatalog({
        agent_action: ["model", "tools"],
      }),
      bindingCatalog: createBindingCatalog(["tools"]),
    });
    const placeholderNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_PLACEHOLDER,
    );
    const toolNodes = graph.nodes.filter(
      (node) => node.type === ENodeType.BINDING_MULTI,
    );

    expect(placeholderNodes).toHaveLength(1);
    expect(toolNodes).toHaveLength(0);
  });

  it("adds conditional branch handles and branch placeholders that join to downstream steps", async () => {
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "yes" },
          steps: [taskStep("0.conditional.0:branch_yes", "branch_yes")],
        },
        {
          id: "0:conditional:when:1",
          steps: [],
        },
      ],
    };
    const flow: CompiledStep[] = [
      conditionalStep,
      taskStep("1:after_conditional", "after_conditional"),
    ];
    const tasks = baseTasks(["branch_yes", "after_conditional"]);
    const graph = await buildGraph({ flow, tasks });
    const operatorNodeId = createStepNodeId(conditionalStep.id, "operator");
    const afterNodeId = createStepNodeId("1:after_conditional", "task");
    const firstPlaceholder = createPlaceholderNodeId(
      conditionalStep.id,
      "conditional",
      0,
    );
    const secondPlaceholder = createPlaceholderNodeId(
      conditionalStep.id,
      "conditional",
      1,
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.source === operatorNodeId &&
          edge.sourceHandle === "operatorOut-0-2",
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === operatorNodeId &&
          edge.sourceHandle === "operatorOut-1-2",
      ),
    ).toBe(true);

    const firstToAfter = graph.edges.find(
      (edge) => edge.source === firstPlaceholder && edge.target === afterNodeId,
    );
    const secondToAfter = graph.edges.find(
      (edge) =>
        edge.source === secondPlaceholder && edge.target === afterNodeId,
    );

    expect(firstToAfter).toBeDefined();
    expect(secondToAfter).toBeDefined();
    expect(firstToAfter?.hidden).toBe(true);
    expect(secondToAfter?.hidden).toBe(true);
  });

  it("preserves conditional branch source handles on overlay edges to nested conditional groups", async () => {
    const nestedConditional: CompiledConditionalStep = {
      id: "0.branch.1:nested_conditional",
      label: "nested_conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0.branch.1:nested_conditional:when:0",
          condition: { kind: "literal", value: "no" },
          steps: [],
        },
        {
          id: "0.branch.1:nested_conditional:when:1",
          steps: [],
        },
      ],
    };
    const outerConditional: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "false" },
          steps: [],
        },
        {
          id: "0:conditional:when:1",
          steps: [nestedConditional],
        },
      ],
    };
    const graph = await buildGraph({
      flow: [outerConditional],
      tasks: {},
    });
    const outerOperatorNodeId = createStepNodeId(
      outerConditional.id,
      "operator",
    );
    const nestedGroupId = createGroupId(nestedConditional.id);
    const firstBranchPlaceholderId = createPlaceholderNodeId(
      outerConditional.id,
      "conditional",
      0,
    );
    const firstBranchEdge = graph.edges.find(
      (edge) =>
        edge.source === outerOperatorNodeId &&
        edge.target === firstBranchPlaceholderId &&
        !edge.hidden,
    );
    const nestedBranchOverlayEdge = graph.edges.find(
      (edge) =>
        edge.source === outerOperatorNodeId &&
        edge.target === nestedGroupId &&
        !edge.hidden,
    );

    expect(firstBranchEdge).toBeDefined();
    expect(firstBranchEdge?.sourceHandle).toBe("operatorOut-0-2");
    expect(nestedBranchOverlayEdge).toBeDefined();
    expect(nestedBranchOverlayEdge?.sourceHandle).toBe("operatorOut-1-2");
  });

  it("creates explicit parallel join edges from branch exits to a join placeholder", async () => {
    const parallelStep: CompiledParallelStep = {
      id: "0:parallel",
      label: "parallel",
      type: StepType.Parallel,
      strategy: "wait_all",
      steps: [
        taskStep("0.parallel.0:parallel_one", "parallel_one"),
        taskStep("0.parallel.1:parallel_two", "parallel_two"),
      ],
    };
    const flow: CompiledStep[] = [
      parallelStep,
      taskStep("1:after_parallel", "after_parallel"),
    ];
    const tasks = baseTasks(["parallel_one", "parallel_two", "after_parallel"]);
    const graph = await buildGraph({ flow, tasks });
    const firstBranchNodeId = createStepNodeId(
      "0.parallel.0:parallel_one",
      "task",
    );
    const secondBranchNodeId = createStepNodeId(
      "0.parallel.1:parallel_two",
      "task",
    );
    const joinPlaceholderId = createPlaceholderNodeId(
      parallelStep.id,
      "parallel",
      2,
    );
    const afterNodeId = createStepNodeId("1:after_parallel", "task");

    expect(
      graph.edges.some(
        (edge) =>
          edge.source === firstBranchNodeId &&
          edge.target === joinPlaceholderId,
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === secondBranchNodeId &&
          edge.target === joinPlaceholderId,
      ),
    ).toBe(true);

    const joinToAfter = graph.edges.find(
      (edge) =>
        edge.source === joinPlaceholderId && edge.target === afterNodeId,
    );

    expect(joinToAfter).toBeDefined();
    expect(joinToAfter?.hidden).toBe(true);
  });

  it("creates loop placeholder join edges for downstream continuation", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:loop_task", "loop_task")],
    };
    const flow: CompiledStep[] = [
      loopStep,
      taskStep("1:after_loop", "after_loop"),
    ];
    const tasks = baseTasks(["loop_task", "after_loop"]);
    const graph = await buildGraph({ flow, tasks });
    const loopTaskId = createStepNodeId("0.loop.0:loop_task", "task");
    const loopPlaceholderId = createPlaceholderNodeId(loopStep.id, "loop", 0);
    const afterNodeId = createStepNodeId("1:after_loop", "task");

    expect(
      graph.edges.some(
        (edge) =>
          edge.source === loopTaskId && edge.target === loopPlaceholderId,
      ),
    ).toBe(true);

    const placeholderToAfter = graph.edges.find(
      (edge) =>
        edge.source === loopPlaceholderId && edge.target === afterNodeId,
    );

    expect(placeholderToAfter).toBeDefined();
    expect(placeholderToAfter?.hidden).toBe(true);
  });

  it("expands the loop group bounds to enclose AI agent binding attachments", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:agent", "agent")],
    };
    const flow: CompiledStep[] = [
      loopStep,
      taskStep("1:after_loop", "after_loop"),
    ];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
          memory: ["profile_memory"],
          model: "openai_model",
          mcp: ["mcp_server"],
        },
        settings: {},
      },
      after_loop: { action: "after_action", settings: {} },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        search_tool: { kind: "tools", settings: {} },
        profile_memory: { kind: "memory", settings: {} },
        openai_model: { kind: "model", settings: {} },
        mcp_server: { kind: "mcp", settings: {} },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools", "memory", "model", "mcp"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "tools", multiple: true },
        { kind: "memory", multiple: true },
        { kind: "model", multiple: false },
        { kind: "mcp", multiple: true },
      ]),
    });
    const loopGroup = graph.nodes.find(
      (node) => node.id === createGroupId(loopStep.id),
    );
    const agentAttachments = graph.nodes.filter(
      (node) =>
        node.type === ENodeType.BINDING_SINGLE ||
        node.type === ENodeType.BINDING_MULTI,
    );

    expect(loopGroup).toBeDefined();
    expect(agentAttachments.length).toBeGreaterThan(0);

    const groupStyle = loopGroup?.style as
      | { width: number; height: number }
      | undefined;
    const groupPosition = loopGroup?.position as
      | { x: number; y: number }
      | undefined;

    expect(groupStyle).toBeDefined();
    expect(groupPosition).toBeDefined();

    const groupBottom = groupPosition!.y + groupStyle!.height;
    const attachmentBottom = Math.max(
      ...agentAttachments.map(
        (node) =>
          node.position.y +
          (NODE_METRICS[node.type as ENodeType]?.dimensions.height ?? 0),
      ),
    );

    expect(groupBottom).toBeGreaterThanOrEqual(attachmentBottom);
  });

  it("uses React Flow node z-index for group overlays", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:loop_task", "loop_task")],
    };
    const graph = await buildGraph({
      flow: [loopStep],
      tasks: baseTasks(["loop_task"]),
    });
    const loopGroup = graph.nodes.find(
      (node) => node.id === createGroupId(loopStep.id),
    );

    expect(loopGroup).toBeDefined();
    expect(loopGroup?.zIndex).toBe(-1);
    expect((loopGroup?.style as { zIndex?: number } | undefined)?.zIndex).toBe(
      undefined,
    );
  });

  it("attaches end-indicator edges with next insert path metadata", async () => {
    const flow: CompiledStep[] = [taskStep("0:single", "single")];
    const graph = await buildGraph({ flow, tasks: baseTasks(["single"]) });
    const singleNodeId = createStepNodeId("0:single", "task");
    const endEdge = graph.edges.find(
      (edge) =>
        edge.source === singleNodeId && edge.target === END_INDICATOR_ID,
    );

    expect(endEdge).toBeDefined();
    expect(
      (endEdge?.data as { insertPath?: unknown[] } | undefined)?.insertPath,
    ).toEqual(["flow", 1]);
  });

  it("creates nested group nodes and deduplicates overlay group edges", async () => {
    const nestedConditional: CompiledConditionalStep = {
      id: "0.loop.0:conditional",
      label: "nested_conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0.loop.0:conditional:when:0",
          condition: { kind: "literal", value: "yes" },
          steps: [
            taskStep(
              "0.loop.0.conditional.0:conditional_inner_task",
              "conditional_inner_task",
            ),
          ],
        },
        {
          id: "0.loop.0:conditional:when:1",
          steps: [],
        },
      ],
    };
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [nestedConditional],
    };
    const flow: CompiledStep[] = [
      loopStep,
      taskStep("1:after_group", "after_group"),
    ];
    const tasks = baseTasks(["conditional_inner_task", "after_group"]);
    const graph = await buildGraph({ flow, tasks });
    const outerGroupId = createGroupId(loopStep.id);
    const innerGroupId = createGroupId(nestedConditional.id);

    expect(graph.nodes.some((node) => node.id === outerGroupId)).toBe(true);
    expect(graph.nodes.some((node) => node.id === innerGroupId)).toBe(true);

    const groupOverlayEdges = graph.edges.filter(
      (edge) =>
        edge.source === outerGroupId && edge.target.includes("after_group"),
    );

    expect(groupOverlayEdges.length).toBe(1);
    expect(
      (groupOverlayEdges[0].data as { insertPath?: unknown[] } | undefined)
        ?.insertPath,
    ).toBeDefined();
  });

  for (const direction of ["horizontal", "vertical"] as const) {
    it(`keeps empty branch placeholders separated from a nested group branch in ${direction} mode`, async () => {
      const nested = nestedConditionalStep("0.conditional.0:nested");
      const conditionalStep: CompiledConditionalStep = {
        id: "0:conditional",
        label: "conditional",
        type: StepType.Conditional,
        branches: [
          {
            id: "0:conditional:when:0",
            condition: { kind: "literal", value: "nested" },
            steps: [nested],
          },
          {
            id: "0:conditional:when:1",
            condition: { kind: "literal", value: "empty" },
            steps: [],
          },
          {
            id: "0:conditional:when:2",
            steps: [],
          },
        ],
      };
      const graph = await buildGraph({
        flow: [conditionalStep],
        tasks: {},
        direction,
      });
      const operator = graph.nodes.find(
        (node) => node.id === createStepNodeId(conditionalStep.id, "operator"),
      );
      const nestedGroup = graph.nodes.find(
        (node) => node.id === createGroupId(nested.id),
      );
      const placeholder1 = graph.nodes.find(
        (node) =>
          node.id ===
          createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
      );
      const placeholder2 = graph.nodes.find(
        (node) =>
          node.id ===
          createPlaceholderNodeId(conditionalStep.id, "conditional", 2),
      );

      expect(operator).toBeDefined();
      expect(nestedGroup).toBeDefined();
      expect(placeholder1).toBeDefined();
      expect(placeholder2).toBeDefined();
      expectBranchSpansToBeSeparatedAndSymmetric({
        branchNodes: [nestedGroup!, placeholder1!, placeholder2!],
        direction,
        operatorNode: operator!,
      });
    });

    it(`keeps an empty branch placeholder between nested group branches in ${direction} mode`, async () => {
      const nested0 = nestedConditionalStep("0.conditional.0:nested");
      const nested2 = nestedConditionalStep("0.conditional.2:nested");
      const conditionalStep: CompiledConditionalStep = {
        id: "0:conditional",
        label: "conditional",
        type: StepType.Conditional,
        branches: [
          {
            id: "0:conditional:when:0",
            condition: { kind: "literal", value: "nested" },
            steps: [nested0],
          },
          {
            id: "0:conditional:when:1",
            condition: { kind: "literal", value: "empty" },
            steps: [],
          },
          {
            id: "0:conditional:when:2",
            steps: [nested2],
          },
        ],
      };
      const graph = await buildGraph({
        flow: [conditionalStep],
        tasks: {},
        direction,
      });
      const operator = graph.nodes.find(
        (node) => node.id === createStepNodeId(conditionalStep.id, "operator"),
      );
      const nestedGroup0 = graph.nodes.find(
        (node) => node.id === createGroupId(nested0.id),
      );
      const placeholder = graph.nodes.find(
        (node) =>
          node.id ===
          createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
      );
      const nestedGroup2 = graph.nodes.find(
        (node) => node.id === createGroupId(nested2.id),
      );

      expect(operator).toBeDefined();
      expect(nestedGroup0).toBeDefined();
      expect(placeholder).toBeDefined();
      expect(nestedGroup2).toBeDefined();
      expectBranchSpansToBeSeparatedAndSymmetric({
        branchNodes: [nestedGroup0!, placeholder!, nestedGroup2!],
        direction,
        operatorNode: operator!,
      });
    });

    for (const nestedPosition of ["before", "after"] as const) {
      it(`keeps task branches ${nestedPosition} a nested group branch separated in ${direction} mode`, async () => {
        const nested = nestedConditionalStep(
          `0.conditional.${nestedPosition}:nested`,
        );
        const conditionalStep: CompiledConditionalStep = {
          id: `0:conditional:${nestedPosition}`,
          label: "conditional",
          type: StepType.Conditional,
          branches:
            nestedPosition === "after"
              ? [
                  {
                    id: "0:conditional:when:0",
                    condition: { kind: "literal", value: "task" },
                    steps: [taskStep("0.conditional.0:task_a", "task_a")],
                  },
                  {
                    id: "0:conditional:when:1",
                    condition: { kind: "literal", value: "task" },
                    steps: [taskStep("0.conditional.1:task_b", "task_b")],
                  },
                  {
                    id: "0:conditional:when:2",
                    steps: [nested],
                  },
                ]
              : [
                  {
                    id: "0:conditional:when:0",
                    condition: { kind: "literal", value: "nested" },
                    steps: [nested],
                  },
                  {
                    id: "0:conditional:when:1",
                    condition: { kind: "literal", value: "task" },
                    steps: [taskStep("0.conditional.1:task_a", "task_a")],
                  },
                  {
                    id: "0:conditional:when:2",
                    steps: [taskStep("0.conditional.2:task_b", "task_b")],
                  },
                ],
        };
        const graph = await buildGraph({
          flow: [conditionalStep],
          tasks: baseTasks(["task_a", "task_b"]),
          direction,
        });
        const operator = graph.nodes.find(
          (node) =>
            node.id === createStepNodeId(conditionalStep.id, "operator"),
        );
        const nestedGroup = graph.nodes.find(
          (node) => node.id === createGroupId(nested.id),
        );
        const taskA = graph.nodes.find(
          (node) =>
            node.id ===
            createStepNodeId(
              nestedPosition === "after"
                ? "0.conditional.0:task_a"
                : "0.conditional.1:task_a",
              "task",
            ),
        );
        const taskB = graph.nodes.find(
          (node) =>
            node.id ===
            createStepNodeId(
              nestedPosition === "after"
                ? "0.conditional.1:task_b"
                : "0.conditional.2:task_b",
              "task",
            ),
        );

        expect(operator).toBeDefined();
        expect(nestedGroup).toBeDefined();
        expect(taskA).toBeDefined();
        expect(taskB).toBeDefined();
        expectBranchSpansToBeSeparatedAndSymmetric({
          branchNodes:
            nestedPosition === "after"
              ? [taskA!, taskB!, nestedGroup!]
              : [nestedGroup!, taskA!, taskB!],
          direction,
          operatorNode: operator!,
        });
      });
    }
  }

  for (const direction of ["horizontal", "vertical"] as const) {
    it(`keeps Stop after the last main-flow node with wide attachment rows in ${direction} mode`, async () => {
      const conditionalStep: CompiledConditionalStep = {
        id: "0:conditional",
        label: "conditional",
        type: StepType.Conditional,
        branches: [
          {
            id: "0:conditional:when:0",
            condition: { kind: "literal", value: "false" },
            steps: [taskStep("0.cond.0:short_agent", "short_agent")],
          },
          {
            id: "0:conditional:when:1",
            steps: [
              taskStep("0.cond.1:long_agent_1", "long_agent_1"),
              taskStep("0.cond.1:long_agent_2", "long_agent_2"),
            ],
          },
        ],
      };
      const graph = await buildGraph({
        flow: [conditionalStep],
        tasks: {
          short_agent: { action: "agent_action", settings: {} },
          long_agent_1: { action: "agent_action", settings: {} },
          long_agent_2: {
            action: "agent_action",
            settings: {},
            bindings: {
              tools: ["tool_1"],
              mcp: ["mcp_1"],
              memory: ["mem_1"],
              model: "model_1",
            },
          },
        },
        defs: {
          tool_1: { kind: "tools", settings: {} },
          mcp_1: { kind: "mcp", settings: {} },
          mem_1: { kind: "memory", settings: {} },
          model_1: { kind: "model", settings: {} },
        },
        actionCatalog: createActionCatalog({
          agent_action: ["tools", "mcp", "model", "memory"],
        }),
        bindingCatalog: createBindingCatalog([
          { kind: "tools", multiple: true },
          { kind: "mcp", multiple: true },
          { kind: "memory", multiple: true },
          { kind: "model", multiple: false },
        ]),
        direction,
      });
      const endNode = graph.nodes.find((node) => node.id === END_INDICATOR_ID);
      const lastMainFlowNode = graph.nodes.find(
        (node) => node.id === createStepNodeId("0.cond.1:long_agent_2", "task"),
      );

      expect(endNode).toBeDefined();
      expect(lastMainFlowNode).toBeDefined();

      const taskDims = NODE_METRICS[ENodeType.TASK]?.dimensions ?? {
        width: 0,
        height: 0,
      };
      const endLeading =
        direction === "vertical" ? endNode!.position.y : endNode!.position.x;
      const lastNodeTrailing =
        direction === "vertical"
          ? lastMainFlowNode!.position.y + taskDims.height
          : lastMainFlowNode!.position.x + taskDims.width;

      expect(endLeading).toBeGreaterThanOrEqual(lastNodeTrailing);
    });
  }

  it("does not create duplicate node or edge IDs", async () => {
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "yes" },
          steps: [taskStep("0.conditional.0:branch_yes", "branch_yes")],
        },
        {
          id: "0:conditional:when:1",
          steps: [taskStep("0.conditional.1:branch_else", "branch_else")],
        },
      ],
    };
    const parallelStep: CompiledParallelStep = {
      id: "1:parallel",
      label: "parallel",
      type: StepType.Parallel,
      strategy: "wait_any",
      steps: [
        taskStep("1.parallel.0:p1", "p1"),
        taskStep("1.parallel.1:p2", "p2"),
      ],
    };
    const flow: CompiledStep[] = [
      conditionalStep,
      parallelStep,
      taskStep("2:end", "end"),
    ];
    const tasks = baseTasks(["branch_yes", "branch_else", "p1", "p2", "end"]);
    const graph = await buildGraph({ flow, tasks });

    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(
      graph.nodes.length,
    );
    expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(
      graph.edges.length,
    );
  });

  it("returns undefined for empty flow", async () => {
    const graph = await buildNodesAndEdges({
      config: getWorkflowDefaultConfig("horizontal"),
      flow: [],
      defs: {},
      actionCatalog: new Map(),
      bindingCatalog: new Map(),
    });

    expect(graph).toBeUndefined();
  });

  it("aligns the next step vertically with the loop's join placeholder in horizontal mode", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:loop_task", "loop_task")],
    };
    const flow: CompiledStep[] = [
      loopStep,
      taskStep("1:after_loop", "after_loop"),
    ];
    const tasks = baseTasks(["loop_task", "after_loop"]);
    const graph = await buildGraph({ flow, tasks });
    const placeholderId = createPlaceholderNodeId(loopStep.id, "loop", 0);
    const placeholder = graph.nodes.find((node) => node.id === placeholderId);
    const afterNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("1:after_loop", "task"),
    );

    expect(placeholder).toBeDefined();
    expect(afterNode).toBeDefined();

    const placeholderCenter =
      placeholder!.position.y +
      (NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]?.dimensions.height ?? 0) / 2;
    const afterCenter =
      afterNode!.position.y +
      (NODE_METRICS[ENodeType.TASK]?.dimensions.height ?? 0) / 2;

    expect(Math.abs(placeholderCenter - afterCenter)).toBeLessThan(1);
  });

  it("aligns the next step horizontally with the loop's join placeholder in vertical mode", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:loop_task", "loop_task")],
    };
    const flow: CompiledStep[] = [
      loopStep,
      taskStep("1:after_loop", "after_loop"),
    ];
    const tasks = baseTasks(["loop_task", "after_loop"]);
    const graph = await buildGraph({ flow, tasks, direction: "vertical" });
    const placeholderId = createPlaceholderNodeId(loopStep.id, "loop", 0);
    const placeholder = graph.nodes.find((node) => node.id === placeholderId);
    const afterNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("1:after_loop", "task"),
    );

    expect(placeholder).toBeDefined();
    expect(afterNode).toBeDefined();

    const placeholderCenter =
      placeholder!.position.x +
      (NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]?.dimensions.width ?? 0) / 2;
    const afterCenter =
      afterNode!.position.x +
      (NODE_METRICS[ENodeType.TASK]?.dimensions.width ?? 0) / 2;

    expect(Math.abs(placeholderCenter - afterCenter)).toBeLessThan(1);
  });

  it("shifts the next group as a whole so its operator aligns with the previous group's join placeholder", async () => {
    const firstLoop: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:loop_task", "loop_task")],
    };
    const secondLoop: CompiledLoopStep = {
      id: "1:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("1.loop.0:loop_task_2", "loop_task_2")],
    };
    const flow: CompiledStep[] = [firstLoop, secondLoop];
    const tasks = baseTasks(["loop_task", "loop_task_2"]);
    const graph = await buildGraph({ flow, tasks });
    const firstPlaceholder = graph.nodes.find(
      (node) => node.id === createPlaceholderNodeId("0:loop", "loop", 0),
    );
    const secondOperator = graph.nodes.find(
      (node) => node.id === createStepNodeId("1:loop", "operator"),
    );
    const secondTask = graph.nodes.find(
      (node) => node.id === createStepNodeId("1.loop.0:loop_task_2", "task"),
    );

    expect(firstPlaceholder).toBeDefined();
    expect(secondOperator).toBeDefined();
    expect(secondTask).toBeDefined();

    const placeholderCenterY =
      firstPlaceholder!.position.y +
      (NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]?.dimensions.height ?? 0) / 2;
    const operatorCenterY =
      secondOperator!.position.y +
      (NODE_METRICS[ENodeType.OPERATOR]?.dimensions.height ?? 0) / 2;
    const taskDeltaY = secondTask!.position.y - secondOperator!.position.y;

    expect(Math.abs(placeholderCenterY - operatorCenterY)).toBeLessThan(1);
    expect(Math.abs(taskDeltaY)).toBeLessThan(20);
  });

  it("aligns the next step with the conditional group's vertical center in horizontal mode", async () => {
    const conditional: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "yes" },
          steps: [taskStep("0.conditional.0:branch_yes", "branch_yes")],
        },
        {
          id: "0:conditional:when:1",
          steps: [taskStep("0.conditional.1:branch_no", "branch_no")],
        },
      ],
    };
    const flow: CompiledStep[] = [
      conditional,
      taskStep("1:after_conditional", "after_conditional"),
    ];
    const tasks = baseTasks(["branch_yes", "branch_no", "after_conditional"]);
    const graph = await buildGraph({ flow, tasks });
    const conditionalGroup = graph.nodes.find(
      (node) => node.id === createGroupId("0:conditional"),
    );
    const afterNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("1:after_conditional", "task"),
    );

    expect(conditionalGroup).toBeDefined();
    expect(afterNode).toBeDefined();

    const groupStyle = conditionalGroup?.style as
      | { width: number; height: number }
      | undefined;
    // The node after the conditional must align with the group's bounding-box
    // center — the same point where xyflow routes the exit overlay edge.
    const groupCenterY =
      conditionalGroup!.position.y + (groupStyle?.height ?? 0) / 2;
    const afterCenterY =
      afterNode!.position.y +
      (NODE_METRICS[ENodeType.TASK]?.dimensions.height ?? 0) / 2;

    expect(Math.abs(groupCenterY - afterCenterY)).toBeLessThan(1);
  });

  it("aligns top-level nodes on the same vertical axis between start and end in horizontal mode", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:loop_task", "loop_task")],
    };
    const flow: CompiledStep[] = [
      loopStep,
      taskStep("1:after_loop", "after_loop"),
    ];
    const tasks = baseTasks(["loop_task", "after_loop"]);
    const graph = await buildGraph({ flow, tasks });
    const startNode = graph.nodes.find(
      (node) => node.id === START_INDICATOR_ID,
    );
    const endNode = graph.nodes.find((node) => node.id === END_INDICATOR_ID);
    const loopOperator = graph.nodes.find(
      (node) => node.id === createStepNodeId("0:loop", "operator"),
    );
    const afterNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("1:after_loop", "task"),
    );

    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
    expect(loopOperator).toBeDefined();
    expect(afterNode).toBeDefined();

    const startCenterY =
      startNode!.position.y +
      (NODE_METRICS[ENodeType.INDICATOR]?.dimensions.height ?? 0) / 2;
    const endCenterY =
      endNode!.position.y +
      (NODE_METRICS[ENodeType.INDICATOR]?.dimensions.height ?? 0) / 2;
    const loopCenterY =
      loopOperator!.position.y +
      (NODE_METRICS[ENodeType.OPERATOR]?.dimensions.height ?? 0) / 2;
    const afterCenterY =
      afterNode!.position.y +
      (NODE_METRICS[ENodeType.TASK]?.dimensions.height ?? 0) / 2;
    const referenceAxis = (startCenterY + endCenterY) / 2;

    expect(Math.abs(loopCenterY - referenceAxis)).toBeLessThan(1);
    expect(Math.abs(afterCenterY - referenceAxis)).toBeLessThan(1);
    // Start and End indicators must share the same perpendicular-axis center
    // as the rest of the flow.
    expect(Math.abs(startCenterY - referenceAxis)).toBeLessThan(1);
    expect(Math.abs(endCenterY - referenceAxis)).toBeLessThan(1);
    expect(Math.abs(startCenterY - endCenterY)).toBeLessThan(1);
  });

  it("aligns start and end indicators on the same axis across multiple groups", async () => {
    const buildLoop = (id: string, taskName: string): CompiledLoopStep => ({
      id,
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep(`${id}.loop.0:${taskName}`, taskName)],
    });
    const flow: CompiledStep[] = [
      buildLoop("0:loop", "loop_task_0"),
      buildLoop("1:loop", "loop_task_1"),
      buildLoop("2:loop", "loop_task_2"),
      buildLoop("3:loop", "loop_task_3"),
      taskStep("4:after_loops", "after_loops"),
    ];
    const tasks = baseTasks([
      "loop_task_0",
      "loop_task_1",
      "loop_task_2",
      "loop_task_3",
      "after_loops",
    ]);
    const graph = await buildGraph({ flow, tasks });
    const startNode = graph.nodes.find(
      (node) => node.id === START_INDICATOR_ID,
    );
    const endNode = graph.nodes.find((node) => node.id === END_INDICATOR_ID);
    const operators = graph.nodes.filter(
      (node) => node.type === ENodeType.OPERATOR,
    );
    const afterNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("4:after_loops", "task"),
    );

    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
    expect(operators.length).toBe(4);
    expect(afterNode).toBeDefined();

    const indicatorDims = NODE_METRICS[ENodeType.INDICATOR]?.dimensions ?? {
      width: 0,
      height: 0,
    };
    const operatorDims = NODE_METRICS[ENodeType.OPERATOR]?.dimensions ?? {
      width: 0,
      height: 0,
    };
    const taskDims = NODE_METRICS[ENodeType.TASK]?.dimensions ?? {
      width: 0,
      height: 0,
    };
    const startCenterY = startNode!.position.y + indicatorDims.height / 2;
    const endCenterY = endNode!.position.y + indicatorDims.height / 2;
    const referenceAxis = (startCenterY + endCenterY) / 2;
    const centers = [
      startCenterY,
      endCenterY,
      ...operators.map(
        (operator) => operator.position.y + operatorDims.height / 2,
      ),
      afterNode!.position.y + taskDims.height / 2,
    ];

    centers.forEach((centerY) => {
      expect(Math.abs(centerY - referenceAxis)).toBeLessThan(1);
    });
  });

  it("stacks conditional branch placeholders on separate lines in horizontal mode", async () => {
    const conditional: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "yes" },
          steps: [taskStep("0.conditional.0:branch_yes", "branch_yes")],
        },
        {
          id: "0:conditional:when:1",
          steps: [taskStep("0.conditional.1:branch_no", "branch_no")],
        },
        {
          id: "0:conditional:when:2",
          steps: [taskStep("0.conditional.2:branch_maybe", "branch_maybe")],
        },
      ],
    };
    const flow: CompiledStep[] = [
      conditional,
      taskStep("1:after_conditional", "after_conditional"),
    ];
    const tasks = baseTasks([
      "branch_yes",
      "branch_no",
      "branch_maybe",
      "after_conditional",
    ]);
    const graph = await buildGraph({ flow, tasks });
    const placeholders = graph.nodes
      .filter((node) => node.type === ENodeType.BRANCH_PLACEHOLDER)
      .sort((a, b) => a.position.y - b.position.y);

    expect(placeholders.length).toBeGreaterThanOrEqual(2);
    const uniqueYs = new Set(
      placeholders.map(
        (node) =>
          node.position.y +
          (NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]?.dimensions.height ?? 0) /
            2,
      ),
    );

    expect(uniqueYs.size).toBe(placeholders.length);
  });

  it("aligns start, stop and the operator on the same axis when a group has AI agent binding attachments", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:agent", "agent")],
    };
    const flow: CompiledStep[] = [
      loopStep,
      taskStep("1:after_loop", "after_loop"),
    ];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
          memory: ["profile_memory"],
          model: "openai_model",
          mcp: ["mcp_server"],
        },
        settings: {},
      },
      after_loop: { action: "after_action", settings: {} },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        search_tool: { kind: "tools", settings: {} },
        profile_memory: { kind: "memory", settings: {} },
        openai_model: { kind: "model", settings: {} },
        mcp_server: { kind: "mcp", settings: {} },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools", "memory", "model", "mcp"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "tools", multiple: true },
        { kind: "memory", multiple: true },
        { kind: "model", multiple: false },
        { kind: "mcp", multiple: true },
      ]),
    });
    const startNode = graph.nodes.find(
      (node) => node.id === START_INDICATOR_ID,
    );
    const endNode = graph.nodes.find((node) => node.id === END_INDICATOR_ID);
    const operatorNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("0:loop", "operator"),
    );
    const loopPlaceholder = graph.nodes.find(
      (node) => node.id === createPlaceholderNodeId("0:loop", "loop", 0),
    );
    const afterNode = graph.nodes.find(
      (node) => node.id === createStepNodeId("1:after_loop", "task"),
    );

    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
    expect(operatorNode).toBeDefined();
    expect(loopPlaceholder).toBeDefined();
    expect(afterNode).toBeDefined();

    const indicatorDims = NODE_METRICS[ENodeType.INDICATOR]?.dimensions ?? {
      width: 0,
      height: 0,
    };
    const operatorDims = NODE_METRICS[ENodeType.OPERATOR]?.dimensions ?? {
      width: 0,
      height: 0,
    };
    const placeholderDims = NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]
      ?.dimensions ?? {
      width: 0,
      height: 0,
    };
    const taskDims = NODE_METRICS[ENodeType.TASK]?.dimensions ?? {
      width: 0,
      height: 0,
    };
    const startCenterY = startNode!.position.y + indicatorDims.height / 2;
    const endCenterY = endNode!.position.y + indicatorDims.height / 2;
    const referenceAxis = (startCenterY + endCenterY) / 2;
    const loopGroup = graph.nodes.find(
      (node) => node.id === createGroupId("0:loop"),
    );
    const groupStyle = loopGroup?.style as
      | { width: number; height: number }
      | undefined;
    const groupCenterY = loopGroup!.position.y + (groupStyle?.height ?? 0) / 2;
    const operatorCenterY = operatorNode!.position.y + operatorDims.height / 2;
    const placeholderCenterY =
      loopPlaceholder!.position.y + placeholderDims.height / 2;
    const afterCenterY = afterNode!.position.y + taskDims.height / 2;

    // Group ports are at the group's visual center (50%), so the loop boundary
    // nodes and next task must share that same horizontal axis.
    expect(Math.abs(groupCenterY - referenceAxis)).toBeLessThan(1);
    expect(Math.abs(operatorCenterY - referenceAxis)).toBeLessThan(1);
    expect(Math.abs(placeholderCenterY - referenceAxis)).toBeLessThan(1);
    expect(Math.abs(afterCenterY - referenceAxis)).toBeLessThan(1);
  });

  it.each([
    ["horizontal", "grouped"],
    ["horizontal", "ungrouped"],
    ["vertical", "grouped"],
    ["vertical", "ungrouped"],
  ] as const)(
    "keeps standard Start/Stop link spacing in %s mode (%s)",
    async (direction, grouping) => {
      const grouped = grouping === "grouped";
      const step = grouped
        ? nestedConditionalStep("0:conditional")
        : taskStep("0:agent", "agent");
      const graph = await buildGraph({
        flow: [step],
        tasks: grouped
          ? {}
          : { agent: { action: "agent_action", settings: {} } },
        direction,
      });
      const boundaryId = grouped
        ? createGroupId(step.id)
        : createStepNodeId(step.id, "task");
      const flowAxis = direction === "vertical" ? "y" : "x";
      const flowSize = direction === "vertical" ? "height" : "width";
      const indicatorSize =
        NODE_METRICS[ENodeType.INDICATOR]?.dimensions[flowSize] ?? 0;
      const findNode = (id: string) =>
        graph.nodes.find((node) => node.id === id)!;
      const start = findNode(START_INDICATOR_ID);
      const end = findNode(END_INDICATOR_ID);
      const boundary = findNode(boundaryId);
      const boundarySize =
        (grouped
          ? (boundary.style as { width?: number; height?: number })[flowSize]
          : NODE_METRICS[boundary.type]?.dimensions[flowSize]) ?? 0;

      expect(
        boundary.position[flowAxis] - start.position[flowAxis] - indicatorSize,
      ).toBe(FLOW_LAYER_GAP);
      expect(
        end.position[flowAxis] - boundary.position[flowAxis] - boundarySize,
      ).toBe(FLOW_LAYER_GAP);
    },
  );

  it("aligns start/stop with group bounding-box center in horizontal mode (group ports at 50%)", async () => {
    // When a group contains AI agent with binding attachments below the operator,
    // Start/Stop must align with the group's bounding-box center (where group
    // ports are at 50% of the group height).
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:agent", "agent")],
    };
    const flow: CompiledStep[] = [loopStep];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
          memory: ["profile_memory"],
          model: "openai_model",
          mcp: ["mcp_server"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      defs: {
        search_tool: { kind: "tools", settings: {} },
        profile_memory: { kind: "memory", settings: {} },
        openai_model: { kind: "model", settings: {} },
        mcp_server: { kind: "mcp", settings: {} },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools", "memory", "model", "mcp"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "tools", multiple: true },
        { kind: "memory", multiple: true },
        { kind: "model", multiple: false },
        { kind: "mcp", multiple: true },
      ]),
    });
    const startNode = graph.nodes.find((n) => n.id === START_INDICATOR_ID);
    const endNode = graph.nodes.find((n) => n.id === END_INDICATOR_ID);
    const loopGroup = graph.nodes.find((n) => n.id === createGroupId("0:loop"));

    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
    expect(loopGroup).toBeDefined();

    const iH = NODE_METRICS[ENodeType.INDICATOR]?.dimensions.height ?? 68;
    const groupStyle = loopGroup?.style as
      | { width: number; height: number }
      | undefined;
    const startCenterY = startNode!.position.y + iH / 2;
    const endCenterY = endNode!.position.y + iH / 2;
    const groupCenterY = loopGroup!.position.y + (groupStyle?.height ?? 0) / 2;

    // Start, Stop and group visual center must share the same horizontal axis.
    expect(Math.abs(startCenterY - endCenterY)).toBeLessThan(1);
    expect(Math.abs(groupCenterY - startCenterY)).toBeLessThan(1);
  });

  it("aligns start/stop with group bounding-box center in vertical mode (group ports at 50%)", async () => {
    const loopStep: CompiledLoopStep = {
      id: "0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [taskStep("0.loop.0:agent", "agent")],
    };
    const flow: CompiledStep[] = [loopStep];
    const tasks: TestTaskDefinitions = {
      agent: {
        action: "agent_action",
        bindings: {
          tools: ["search_tool"],
          memory: ["profile_memory"],
          model: "openai_model",
          mcp: ["mcp_server"],
        },
        settings: {},
      },
    };
    const graph = await buildGraph({
      flow,
      tasks,
      direction: "vertical",
      defs: {
        search_tool: { kind: "tools", settings: {} },
        profile_memory: { kind: "memory", settings: {} },
        openai_model: { kind: "model", settings: {} },
        mcp_server: { kind: "mcp", settings: {} },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools", "memory", "model", "mcp"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "tools", multiple: true },
        { kind: "memory", multiple: true },
        { kind: "model", multiple: false },
        { kind: "mcp", multiple: true },
      ]),
    });
    const startNode = graph.nodes.find((n) => n.id === START_INDICATOR_ID);
    const endNode = graph.nodes.find((n) => n.id === END_INDICATOR_ID);
    const loopGroup = graph.nodes.find((n) => n.id === createGroupId("0:loop"));

    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
    expect(loopGroup).toBeDefined();

    const iW = NODE_METRICS[ENodeType.INDICATOR]?.dimensions.width ?? 68;
    const groupStyle = loopGroup?.style as
      | { width: number; height: number }
      | undefined;
    const startCenterX = startNode!.position.x + iW / 2;
    const endCenterX = endNode!.position.x + iW / 2;
    const groupCenterX = loopGroup!.position.x + (groupStyle?.width ?? 0) / 2;

    // Start, Stop and group visual center must share the same vertical axis.
    expect(Math.abs(startCenterX - endCenterX)).toBeLessThan(1);
    expect(Math.abs(groupCenterX - startCenterX)).toBeLessThan(1);
  });

  it("aligns empty conditional branch placeholder x with sibling first-task x in horizontal mode", async () => {
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "=false" },
          steps: [
            taskStep(
              "0.conditional.0:send_text_message_7",
              "send_text_message_7",
            ),
          ],
        },
        {
          id: "0:conditional:when:1",
          steps: [],
        },
      ],
    };
    const flow: CompiledStep[] = [conditionalStep];
    const tasks = baseTasks(["send_text_message_7"]);
    const graph = await buildGraph({ flow, tasks });
    const siblingFirstTask = graph.nodes.find(
      (node) =>
        node.id ===
        createStepNodeId("0.conditional.0:send_text_message_7", "task"),
    );
    const emptyPlaceholder = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
    );
    const nonEmptyPlaceholder = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 0),
    );

    expect(siblingFirstTask).toBeDefined();
    expect(emptyPlaceholder).toBeDefined();
    expect(nonEmptyPlaceholder).toBeDefined();

    // In horizontal mode, the flow-direction axis (x) is aligned:
    // the empty placeholder's x must match the sibling first task's x.
    expect(
      Math.abs(emptyPlaceholder!.position.x - siblingFirstTask!.position.x),
    ).toBeLessThan(1);

    // The branch-spread axis (y) is re-spaced: the two placeholders must
    // remain on separate vertical lanes — no superposition.
    expect(
      Math.abs(emptyPlaceholder!.position.y - nonEmptyPlaceholder!.position.y),
    ).toBeGreaterThan(1);
  });

  it("aligns empty conditional branch placeholder y with sibling first-task y in vertical mode", async () => {
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "=false" },
          steps: [
            taskStep(
              "0.conditional.0:send_text_message_7",
              "send_text_message_7",
            ),
          ],
        },
        {
          id: "0:conditional:when:1",
          steps: [],
        },
      ],
    };
    const flow: CompiledStep[] = [conditionalStep];
    const tasks = baseTasks(["send_text_message_7"]);
    const graph = await buildGraph({ flow, tasks, direction: "vertical" });
    const siblingFirstTask = graph.nodes.find(
      (node) =>
        node.id ===
        createStepNodeId("0.conditional.0:send_text_message_7", "task"),
    );
    const emptyPlaceholder = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
    );
    const nonEmptyPlaceholder = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 0),
    );

    expect(siblingFirstTask).toBeDefined();
    expect(emptyPlaceholder).toBeDefined();
    expect(nonEmptyPlaceholder).toBeDefined();

    // In vertical mode, the flow-direction axis (y) is aligned:
    // the empty placeholder's y must match the sibling first task's y.
    expect(
      Math.abs(emptyPlaceholder!.position.y - siblingFirstTask!.position.y),
    ).toBeLessThan(1);

    // The branch-spread axis (x) is re-spaced: the two placeholders must
    // remain on separate horizontal lanes — no superposition.
    expect(
      Math.abs(emptyPlaceholder!.position.x - nonEmptyPlaceholder!.position.x),
    ).toBeGreaterThan(1);
  });

  it("spaces multiple empty placeholders with the same gap as non-empty branches", async () => {
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "=false" },
          steps: [
            taskStep(
              "0.conditional.0:send_text_message_7",
              "send_text_message_7",
            ),
          ],
        },
        {
          id: "0:conditional:when:1",
          condition: { kind: "literal", value: "=false" },
          steps: [],
        },
        {
          id: "0:conditional:when:2",
          steps: [],
        },
      ],
    };
    const flow: CompiledStep[] = [conditionalStep];
    const tasks = baseTasks(["send_text_message_7"]);
    const graph = await buildGraph({ flow, tasks });
    const placeholder1 = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
    );
    const placeholder2 = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 2),
    );
    const siblingTask = graph.nodes.find(
      (node) =>
        node.id ===
        createStepNodeId("0.conditional.0:send_text_message_7", "task"),
    );

    expect(placeholder1).toBeDefined();
    expect(placeholder2).toBeDefined();
    expect(siblingTask).toBeDefined();

    // The two empty placeholders must be on different y lanes.
    const gapBetweenEmpties = Math.abs(
      placeholder2!.position.y - placeholder1!.position.y,
    );

    expect(gapBetweenEmpties).toBeGreaterThan(1);

    // The gap between empty placeholders must be at least as large as the
    // placeholder height (64 px) — they should not overlap.
    expect(gapBetweenEmpties).toBeGreaterThanOrEqual(
      NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]?.dimensions.height ?? 64,
    );

    // Both empty placeholders must be aligned to the sibling task's x.
    expect(
      Math.abs(placeholder1!.position.x - siblingTask!.position.x),
    ).toBeLessThan(1);
    expect(
      Math.abs(placeholder2!.position.x - siblingTask!.position.x),
    ).toBeLessThan(1);
  });

  it("does not affect non-empty conditional branch placeholders", async () => {
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "yes" },
          steps: [taskStep("0.conditional.0:branch_yes", "branch_yes")],
        },
        {
          id: "0:conditional:when:1",
          steps: [taskStep("0.conditional.1:branch_no", "branch_no")],
        },
      ],
    };
    const flow: CompiledStep[] = [conditionalStep];
    const tasks = baseTasks(["branch_yes", "branch_no"]);
    const graph = await buildGraph({ flow, tasks });
    const placeholder0 = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 0),
    );
    const placeholder1 = graph.nodes.find(
      (node) =>
        node.id ===
        createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
    );

    expect(placeholder0).toBeDefined();
    expect(placeholder1).toBeDefined();

    // Both branches are non-empty — the alignment pass must not touch them.
    // Their y positions should differ (they represent separate branches).
    expect(
      Math.abs(placeholder0!.position.y - placeholder1!.position.y),
    ).toBeGreaterThan(1);
  });

  it("preserves branch-index visual order when empty branches are interspersed with non-empty ones", async () => {
    // Branch 0: empty, Branch 1: non-empty (Send Text Message 7), Branch 2: empty
    // Visual order (top to bottom) must follow branch index order: 0 → 1 → 2.
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "=false" },
          steps: [],
        },
        {
          id: "0:conditional:when:1",
          condition: { kind: "literal", value: "=false" },
          steps: [
            taskStep(
              "0.conditional.1:send_text_message_7",
              "send_text_message_7",
            ),
          ],
        },
        {
          id: "0:conditional:when:2",
          steps: [],
        },
      ],
    };
    const flow: CompiledStep[] = [conditionalStep];
    const tasks = baseTasks(["send_text_message_7"]);
    const graph = await buildGraph({ flow, tasks });
    const ph0 = graph.nodes.find(
      (n) =>
        n.id === createPlaceholderNodeId(conditionalStep.id, "conditional", 0),
    );
    const task1 = graph.nodes.find(
      (n) =>
        n.id ===
        createStepNodeId("0.conditional.1:send_text_message_7", "task"),
    );
    const ph2 = graph.nodes.find(
      (n) =>
        n.id === createPlaceholderNodeId(conditionalStep.id, "conditional", 2),
    );

    expect(ph0).toBeDefined();
    expect(task1).toBeDefined();
    expect(ph2).toBeDefined();

    // Branch 0 (empty) must appear above branch 1 (task).
    expect(ph0!.position.y).toBeLessThan(task1!.position.y);
    // Branch 2 (empty) must appear below branch 1 (task).
    expect(ph2!.position.y).toBeGreaterThan(task1!.position.y);
  });

  it("does not overlap with nodes in other branches that share the same x column", async () => {
    // Branch 0: stm7 (single node)
    // Branch 1: empty placeholder  ← must not collide with stm10 below
    // Branch 2: stm10 → stm11 (longer branch)
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "=false" },
          steps: [taskStep("0.conditional.0:stm7", "stm7")],
        },
        {
          id: "0:conditional:when:1",
          condition: { kind: "literal", value: "=false" },
          steps: [],
        },
        {
          id: "0:conditional:when:2",
          steps: [
            taskStep("0.conditional.2:stm10", "stm10"),
            taskStep("0.conditional.2.1:stm11", "stm11"),
          ],
        },
      ],
    };
    const flow: CompiledStep[] = [conditionalStep];
    const tasks = baseTasks(["stm7", "stm10", "stm11"]);
    const graph = await buildGraph({ flow, tasks });
    const emptyPh = graph.nodes.find(
      (n) =>
        n.id === createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
    );
    const stm10 = graph.nodes.find(
      (n) => n.id === createStepNodeId("0.conditional.2:stm10", "task"),
    );

    expect(emptyPh).toBeDefined();
    expect(stm10).toBeDefined();

    const phHeight =
      NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]?.dimensions.height ?? 64;
    const taskHeight = NODE_METRICS[ENodeType.TASK]?.dimensions.height ?? 86;
    // The placeholder and stm10 share the same x column — ensure their
    // y ranges do not overlap.
    const phBottom = emptyPh!.position.y + phHeight;
    const stm10Top = stm10!.position.y;
    const stm10Bottom = stm10!.position.y + taskHeight;
    const phTop = emptyPh!.position.y;
    // No vertical overlap: either placeholder is entirely above stm10 or below.
    const noOverlap = phBottom <= stm10Top || phTop >= stm10Bottom;

    expect(noOverlap).toBe(true);
  });

  it("distributes multiple empty placeholders between the same two non-empty branches without superposition", async () => {
    // 4 branches: b0=stm7 (non-empty), b1=empty, b2=empty, b3=stm10 (non-empty)
    // b1 and b2 both fall between b0 and b3 — they must not land at the same y.
    const conditionalStep: CompiledConditionalStep = {
      id: "0:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:conditional:when:0",
          condition: { kind: "literal", value: "=false" },
          steps: [taskStep("0.conditional.0:stm7", "stm7")],
        },
        {
          id: "0:conditional:when:1",
          condition: { kind: "literal", value: "=false" },
          steps: [],
        },
        {
          id: "0:conditional:when:2",
          condition: { kind: "literal", value: "=false" },
          steps: [],
        },
        {
          id: "0:conditional:when:3",
          steps: [taskStep("0.conditional.3:stm10", "stm10")],
        },
      ],
    };
    const flow: CompiledStep[] = [conditionalStep];
    const tasks = baseTasks(["stm7", "stm10"]);
    const graph = await buildGraph({ flow, tasks });
    const ph1 = graph.nodes.find(
      (n) =>
        n.id === createPlaceholderNodeId(conditionalStep.id, "conditional", 1),
    );
    const ph2 = graph.nodes.find(
      (n) =>
        n.id === createPlaceholderNodeId(conditionalStep.id, "conditional", 2),
    );
    const stm7 = graph.nodes.find(
      (n) => n.id === createStepNodeId("0.conditional.0:stm7", "task"),
    );
    const stm10 = graph.nodes.find(
      (n) => n.id === createStepNodeId("0.conditional.3:stm10", "task"),
    );

    expect(ph1).toBeDefined();
    expect(ph2).toBeDefined();
    expect(stm7).toBeDefined();
    expect(stm10).toBeDefined();

    const phHeight =
      NODE_METRICS[ENodeType.BRANCH_PLACEHOLDER]?.dimensions.height ?? 64;

    // The two empty placeholders must NOT be superposed.
    expect(Math.abs(ph1!.position.y - ph2!.position.y)).toBeGreaterThan(1);

    // Both placeholders must be between stm7 and stm10 vertically.
    expect(ph1!.position.y).toBeGreaterThan(stm7!.position.y);
    expect(ph2!.position.y).toBeGreaterThan(stm7!.position.y);
    expect(ph1!.position.y + phHeight).toBeLessThan(
      stm10!.position.y + NODE_METRICS[ENodeType.TASK]!.dimensions.height,
    );
    expect(ph2!.position.y + phHeight).toBeLessThan(
      stm10!.position.y + NODE_METRICS[ENodeType.TASK]!.dimensions.height,
    );

    // ph1 (branchIndex=1) must be above ph2 (branchIndex=2).
    expect(ph1!.position.y).toBeLessThan(ph2!.position.y);
  });

  it("keeps sibling branch gaps uniform when a conditional group follows a parallel inside a branch", async () => {
    // Regression: branch packing used to run before alignGroupChainAxes pulled
    // the chained conditional group onto the parallel's axis, permanently
    // reserving the group's pre-alignment position as an oversized gap between
    // the outer conditional's sibling branches.
    const parallelStep: CompiledParallelStep = {
      id: "1:parallel",
      label: "parallel",
      type: StepType.Parallel,
      strategy: "wait_all",
      steps: [
        nestedConditionalStep("1.parallel.0:nested"),
        taskStep("1.parallel.1:branch_one", "branch_one"),
        taskStep("1.parallel.2:branch_two", "branch_two"),
      ],
    };
    const chainedConditional: CompiledConditionalStep = {
      id: "2:chained",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "2:chained:when:0",
          condition: { kind: "literal", value: "yes" },
          steps: [],
        },
        {
          id: "2:chained:when:1",
          steps: [nestedConditionalStep("2.chained.1:nested")],
        },
      ],
    };
    const rootConditional: CompiledConditionalStep = {
      id: "0:root",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:root:when:0",
          condition: { kind: "literal", value: "top" },
          steps: [nestedConditionalStep("0.root.0:nested")],
        },
        {
          id: "0:root:when:1",
          condition: { kind: "literal", value: "middle" },
          steps: [parallelStep, chainedConditional],
        },
        {
          id: "0:root:when:2",
          steps: [taskStep("0.root.2:last", "last")],
        },
      ],
    };
    const graph = await buildGraph({
      flow: [rootConditional],
      tasks: baseTasks(["branch_one", "branch_two", "last"]),
    });
    const spanOf = (nodeId: string) => {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);

      return getNodeSpreadSpan(node, "horizontal");
    };
    const topSpan = spanOf(createGroupId("0.root.0:nested"));
    const parallelSpan = spanOf(createGroupId(parallelStep.id));
    const chainedSpan = spanOf(createGroupId(chainedConditional.id));
    const middleSpan = {
      leading: Math.min(parallelSpan.leading, chainedSpan.leading),
      trailing: Math.max(parallelSpan.trailing, chainedSpan.trailing),
    };
    const bottomSpan = spanOf(createStepNodeId("0.root.2:last", "task"));
    const gapAbove = middleSpan.leading - topSpan.trailing;
    const gapBelow = bottomSpan.leading - middleSpan.trailing;

    expect(gapAbove).toBeGreaterThan(0);
    expect(gapBelow).toBeGreaterThan(0);
    expect(gapAbove).toBeLessThanOrEqual(BRANCH_SPREAD_GAP + 1);
    expect(gapBelow).toBeLessThanOrEqual(BRANCH_SPREAD_GAP + 1);
  });

  it("keeps sibling group chains separated after final axis alignment", async () => {
    const topParallel: CompiledParallelStep = {
      id: "root.branch.0.2:parallel",
      label: "parallel",
      type: StepType.Parallel,
      strategy: "wait_any",
      steps: [
        taskStep("root.branch.0.2.parallel.0:http", "http"),
        taskStep("root.branch.0.2.parallel.1:quick", "quick"),
        taskStep("root.branch.0.2.parallel.2:text", "text"),
      ],
    };
    const lowerConditional: CompiledConditionalStep = {
      id: "root.branch.1.1:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "root.branch.1.1:when:0",
          condition: { kind: "literal", value: true },
          steps: [taskStep("root.branch.1.1.branch.0.0:agent", "agent")],
        },
        { id: "root.branch.1.1:when:1", steps: [] },
      ],
    };
    const lowerLoop: CompiledLoopStep = {
      id: "root.branch.1.0:loop",
      label: "loop",
      type: StepType.Loop,
      loopType: "while",
      while: { kind: "literal", value: false },
      steps: [taskStep("root.branch.1.0.loop.0:lower", "lower")],
    };
    const root: CompiledConditionalStep = {
      id: "root:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "root:when:0",
          condition: { kind: "literal", value: true },
          steps: [
            nestedConditionalStep("root.branch.0.0:conditional"),
            taskStep("root.branch.0.1:between", "between"),
            topParallel,
          ],
        },
        {
          id: "root:when:1",
          condition: { kind: "literal", value: false },
          steps: [lowerLoop, lowerConditional],
        },
        {
          id: "root:when:2",
          steps: [taskStep("root.branch.2.0:last", "last")],
        },
      ],
    };
    const graph = await buildGraph({
      flow: [root],
      tasks: {
        ...baseTasks(["http", "quick", "text", "between", "last"]),
        agent: { action: "agent_action", settings: {} },
        lower: { action: "agent_action", settings: {} },
      },
      actionCatalog: createActionCatalog({
        agent_action: ["tools", "mcp", "model", "memory"],
      }),
      bindingCatalog: createBindingCatalog([
        "tools",
        "mcp",
        { kind: "model", multiple: false },
        { kind: "memory", multiple: false },
      ]),
    });
    const topSpan = getNodeSpreadSpan(
      graph.nodes.find((node) => node.id === createGroupId(topParallel.id)),
      "horizontal",
    );
    const lowerSpan = getNodeSpreadSpan(
      graph.nodes.find(
        (node) => node.id === createGroupId(lowerConditional.id),
      ),
      "horizontal",
    );

    expect(lowerSpan.leading - topSpan.trailing).toBe(BRANCH_SPREAD_GAP);
  });

  it("aligns a plain step sequenced between two groups inside a branch onto the chain axis", async () => {
    // Regression: alignGroupChainAxes used to break its chain walk at plain
    // (non-group) steps, so a task sequenced between a parallel group and a
    // conditional group inside a branch kept its pre-symmetry position while
    // the groups' contents moved — leaving the step and the following group
    // visually off the parallel group's exit axis.
    const parallelStep: CompiledParallelStep = {
      id: "1:parallel",
      label: "parallel",
      type: StepType.Parallel,
      strategy: "wait_all",
      steps: [
        taskStep("1.parallel.0:msg_one", "msg_one"),
        taskStep("1.parallel.1:msg_two", "msg_two"),
        nestedConditionalStep("1.parallel.2:nested"),
      ],
    };
    const chainedConditional = nestedConditionalStep("3:chained");
    const rootConditional: CompiledConditionalStep = {
      id: "0:root",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:root:when:0",
          condition: { kind: "literal", value: "top" },
          steps: [taskStep("0.root.0:first", "first")],
        },
        {
          id: "0:root:when:1",
          condition: { kind: "literal", value: "middle" },
          steps: [
            parallelStep,
            taskStep("2:between", "between"),
            chainedConditional,
          ],
        },
        {
          id: "0:root:when:2",
          steps: [taskStep("0.root.2:last", "last")],
        },
      ],
    };
    const graph = await buildGraph({
      flow: [rootConditional],
      tasks: baseTasks(["msg_one", "msg_two", "first", "between", "last"]),
    });
    const centerOf = (nodeId: string) => {
      const span = getNodeSpreadSpan(
        graph.nodes.find((candidate) => candidate.id === nodeId),
        "horizontal",
      );

      return (span.leading + span.trailing) / 2;
    };
    const parallelCenter = centerOf(createGroupId(parallelStep.id));
    const betweenCenter = centerOf(createStepNodeId("2:between", "task"));
    const chainedCenter = centerOf(createGroupId(chainedConditional.id));

    expect(Math.abs(betweenCenter - parallelCenter)).toBeLessThan(1);
    expect(Math.abs(chainedCenter - parallelCenter)).toBeLessThan(1);
  });

  it("keeps a nested single-branch loop compact when its task has attachments", async () => {
    const loop = (
      id: string,
      taskName: string,
      trailingTaskName?: string,
    ): CompiledLoopStep => ({
      id,
      label: "loop",
      type: StepType.Loop,
      loopType: "for_each",
      forEach: {
        item: "item",
        in: { kind: "literal", value: [] },
      },
      steps: [
        taskStep(`${id}.loop.0:${taskName}`, taskName),
        ...(trailingTaskName
          ? [taskStep(`${id}.loop.1:${trailingTaskName}`, trailingTaskName)]
          : []),
      ],
    });
    const targetLoop = loop("root.branch.2.3:loop", "agent_nested");
    const conditional: CompiledConditionalStep = {
      id: "root:conditional",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "root:conditional:when:0",
          condition: { kind: "literal", value: false },
          steps: [
            taskStep("root.branch.0.0:before_top", "before_top"),
            loop("root.branch.0.1:loop", "agent_top", "message_top"),
          ],
        },
        {
          id: "root:conditional:when:1",
          condition: { kind: "literal", value: false },
          steps: [
            taskStep("root.branch.1.0:agent_middle", "agent_middle"),
            taskStep("root.branch.1.1:message_middle", "message_middle"),
          ],
        },
        {
          id: "root:conditional:when:2",
          steps: [
            loop("root.branch.2.0:loop", "agent_bottom", "message_bottom"),
            taskStep("root.branch.2.1:agent_before", "agent_before"),
            taskStep("root.branch.2.2:message_before", "message_before"),
            targetLoop,
            taskStep("root.branch.2.4:agent_after", "agent_after"),
            taskStep("root.branch.2.5:agent_after_2", "agent_after_2"),
            taskStep("root.branch.2.6:message_after", "message_after"),
          ],
        },
      ],
    };
    const agentNames = [
      "agent_root",
      "agent_top",
      "agent_middle",
      "agent_bottom",
      "agent_before",
      "agent_nested",
      "agent_after",
      "agent_after_2",
    ];
    const tasks: TestTaskDefinitions = {
      ...Object.fromEntries(
        agentNames.map((name) => [
          name,
          { action: "agent_action", settings: {} },
        ]),
      ),
      ...baseTasks([
        "message_top",
        "before_top",
        "message_middle",
        "message_bottom",
        "message_before",
        "message_after",
      ]),
    };
    const graph = await buildGraph({
      flow: [taskStep("0:agent_root", "agent_root"), conditional],
      tasks,
      actionCatalog: createActionCatalog({
        agent_action: ["tools", "mcp", "model", "memory"],
      }),
      bindingCatalog: createBindingCatalog([
        { kind: "tools", multiple: true },
        { kind: "mcp", multiple: true },
        { kind: "model", multiple: false },
        { kind: "memory", multiple: false },
      ]),
    });
    const operator = graph.nodes.find(
      (node) => node.id === createStepNodeId(targetLoop.id, "operator"),
    );
    const task = graph.nodes.find(
      (node) =>
        node.id ===
        createStepNodeId("root.branch.2.3:loop.loop.0:agent_nested", "task"),
    );
    const attachments = graph.nodes.filter(
      (node) => getNodeOwnerDefName(node) === "agent_nested",
    );
    const group = graph.nodes.find(
      (node) => node.id === createGroupId(targetLoop.id),
    );
    const outerGroup = graph.nodes.find(
      (node) => node.id === createGroupId(conditional.id),
    );
    const end = graph.nodes.find((node) => node.id === END_INDICATOR_ID);
    const middleAgent = graph.nodes.find(
      (node) =>
        node.id === createStepNodeId("root.branch.1.0:agent_middle", "task"),
    );
    const middleMessage = graph.nodes.find(
      (node) =>
        node.id === createStepNodeId("root.branch.1.1:message_middle", "task"),
    );
    const middlePlaceholder = graph.nodes.find(
      (node) =>
        node.id === createPlaceholderNodeId(conditional.id, "conditional", 1),
    );
    const middleAttachments = graph.nodes.filter(
      (node) => getNodeOwnerDefName(node) === "agent_middle",
    );
    const branchSpans = [0, 1, 2].map((branchIndex) => {
      const placeholderId = createPlaceholderNodeId(
        conditional.id,
        "conditional",
        branchIndex,
      );
      const spans = graph.nodes
        .filter(
          (node) =>
            node.id.includes(`root.branch.${branchIndex}`) ||
            node.id === placeholderId,
        )
        .map((node) => getNodeSpreadSpan(node, "horizontal"));

      return {
        leading: Math.min(...spans.map(({ leading }) => leading)),
        trailing: Math.max(...spans.map(({ trailing }) => trailing)),
      };
    });

    expect(operator).toBeDefined();
    expect(task).toBeDefined();
    expect(attachments).toHaveLength(4);
    expect(group).toBeDefined();
    expect(outerGroup).toBeDefined();
    expect(end).toBeDefined();

    const bundleSpans = [task!, ...attachments].map((node) =>
      getNodeSpreadSpan(node, "horizontal"),
    );
    const bundleCenter =
      (Math.min(...bundleSpans.map(({ leading }) => leading)) +
        Math.max(...bundleSpans.map(({ trailing }) => trailing))) /
      2;
    const operatorCenter = getNodeSpreadCenter(operator!, "horizontal");
    const groupSpan = getNodeSpreadSpan(group, "horizontal");
    const outerGroupSpan = getNodeSpreadSpan(outerGroup, "horizontal");
    const contentBottom = Math.max(
      ...graph.nodes
        .filter((node) => node.type !== ENodeType.GROUP)
        .map((node) => getNodeSpreadSpan(node, "horizontal").trailing),
    );

    expect(Math.abs(bundleCenter - operatorCenter)).toBeLessThan(1);
    expect(groupSpan.trailing - groupSpan.leading).toBeLessThan(500);
    expect(outerGroupSpan.trailing - contentBottom).toBeLessThanOrEqual(24);
    expect(getNodeSpreadCenter(end!, "horizontal")).toBe(
      getNodeSpreadCenter(outerGroup!, "horizontal"),
    );
    expect(getNodeSpreadCenter(middlePlaceholder!, "horizontal")).toBe(
      getNodeSpreadCenter(middleMessage!, "horizontal"),
    );
    expect(getNodeSpreadCenter(middleMessage!, "horizontal")).toBe(
      getNodeSpreadCenter(middleAgent!, "horizontal"),
    );
    const taskWidth = NODE_METRICS[ENodeType.TASK]?.dimensions.width ?? 0;
    const sourceTrailing = Math.max(
      getNodeRight(middleAgent!),
      ...middleAttachments.map(getNodeRight),
    );

    expect(sourceTrailing).toBeGreaterThan(getNodeRight(middleAgent!));
    expect(middleMessage!.position.x - sourceTrailing).toBe(FLOW_LAYER_GAP);
    expect(
      middlePlaceholder!.position.x - middleMessage!.position.x - taskWidth,
    ).toBe(FLOW_LAYER_GAP);
    expect(branchSpans[1].leading - branchSpans[0].trailing).toBe(
      BRANCH_SPREAD_GAP,
    );
    expect(branchSpans[2].leading - branchSpans[1].trailing).toBe(
      BRANCH_SPREAD_GAP,
    );
  });

  it("pulls each trailing branch placeholder to a uniform flow gap after its content", async () => {
    // Regression: ELK layers every branch's trailing "+" near the flow's
    // convergence point, so a short branch ended with a link stretching across
    // the whole span of its longest sibling instead of a uniform gap.
    const nestedConditional = nestedConditionalStep("0.root.2:nested");
    const rootConditional: CompiledConditionalStep = {
      id: "0:root",
      label: "conditional",
      type: StepType.Conditional,
      branches: [
        {
          id: "0:root:when:0",
          condition: { kind: "literal", value: "short" },
          steps: [taskStep("0.root.0:solo", "solo")],
        },
        {
          id: "0:root:when:1",
          condition: { kind: "literal", value: "long" },
          steps: [
            taskStep("0.root.1:one", "one"),
            taskStep("0.root.1:two", "two"),
            taskStep("0.root.1:three", "three"),
          ],
        },
        {
          id: "0:root:when:2",
          steps: [nestedConditional],
        },
      ],
    };
    const graph = await buildGraph({
      flow: [rootConditional],
      tasks: baseTasks(["solo", "one", "two", "three"]),
    });
    const nodeById = (nodeId: string) => {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);

      if (!node) {
        throw new Error(`Expected node ${nodeId} to be defined`);
      }

      return node;
    };
    const taskWidth = NODE_METRICS[ENodeType.TASK]?.dimensions.width ?? 0;
    const soloNode = nodeById(createStepNodeId("0.root.0:solo", "task"));
    const lastLongNode = nodeById(createStepNodeId("0.root.1:three", "task"));
    const nestedGroup = nodeById(createGroupId(nestedConditional.id));
    const nestedGroupRightEdge =
      nestedGroup.position.x +
      ((nestedGroup.style as { width?: number })?.width ?? 0);
    const placeholderX = (branchIndex: number) =>
      nodeById(createPlaceholderNodeId("0:root", "conditional", branchIndex))
        .position.x;
    const shortGap = placeholderX(0) - (soloNode.position.x + taskWidth);
    const longGap = placeholderX(1) - (lastLongNode.position.x + taskWidth);
    const groupGap = placeholderX(2) - nestedGroupRightEdge;

    expect(Math.abs(shortGap - FLOW_LAYER_GAP)).toBeLessThan(1);
    expect(Math.abs(longGap - FLOW_LAYER_GAP)).toBeLessThan(1);
    expect(Math.abs(groupGap - FLOW_LAYER_GAP)).toBeLessThan(1);
  });

  it("keeps a multi-input parallel join placeholder at the convergence point", async () => {
    const parallelStep: CompiledParallelStep = {
      id: "0:parallel",
      label: "parallel",
      type: StepType.Parallel,
      strategy: "wait_all",
      steps: [
        taskStep("0.parallel.0:short_branch", "short_branch"),
        taskStep("0.parallel.1:long_one", "long_one"),
      ],
    };
    const flow: CompiledStep[] = [parallelStep];
    const graph = await buildGraph({
      flow,
      tasks: baseTasks(["short_branch", "long_one"]),
    });
    const joinPlaceholder = graph.nodes.find(
      (candidate) =>
        candidate.id === createPlaceholderNodeId("0:parallel", "parallel", 2),
    );
    const branchEnds = ["0.parallel.0:short_branch", "0.parallel.1:long_one"]
      .map((stepId) =>
        graph.nodes.find(
          (candidate) => candidate.id === createStepNodeId(stepId, "task"),
        ),
      )
      .map(
        (node) =>
          (node?.position.x ?? 0) +
          (NODE_METRICS[ENodeType.TASK]?.dimensions.width ?? 0),
      );

    if (!joinPlaceholder) {
      throw new Error("Expected join placeholder to be defined");
    }

    // The join collects every branch exit, so it must stay past all of them
    // rather than being pulled next to any single branch's end.
    branchEnds.forEach((branchEnd) => {
      expect(joinPlaceholder.position.x).toBeGreaterThanOrEqual(branchEnd);
    });
  });
});

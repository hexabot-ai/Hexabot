/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  isTaskDefinition,
  type CompiledConditionalStep,
  type CompiledLoopStep,
  type CompiledParallelStep,
  type CompiledStep,
  type DefDefinitions,
} from "@hexabot-ai/agentic";

import {
  EIndicatorType,
  ELinkType,
  ENodeType,
  type BindingOutPort,
  type ConditionalOperatorOutPort,
  type EOperatorType,
  type INodeConfig,
  type WorkflowAction,
  type WorkflowBindingCatalog,
  type WorkflowBindingDefinition,
  type WorkflowNodePort,
} from "../../types/workflow-node.types";
import type { FlowStepPath } from "../../types/workflow-path.types";
import { getTaskAction, getTaskDescription } from "../workflow-task.utils";

import {
  END_INDICATOR_ID,
  START_INDICATOR_ID,
  createAttachmentNodeId,
  createBindingPlaceholderNodeId,
  createEdgeId,
  createGroupId,
  createPlaceholderNodeId,
  createStepNodeId,
} from "./id-factory";
import { GraphRegistry } from "./registry";
import type { GroupMeta } from "./types";

type WalkArgs = {
  steps?: CompiledStep[];
  level: number;
  incoming: string[];
  path: FlowStepPath;
  groupPath: string[];
  state: TraverseState;
  entryEdgeLabel?: string;
  entryEdgeSourceHandle?: string;
};

type WalkStepArgs = Omit<WalkArgs, "steps"> & {
  step: CompiledStep;
  index: number;
  pathIndex?: number;
  disableEntryInsertPath?: boolean;
};

type TraversalExit = {
  nodeId: string;
  nextInsertPath?: FlowStepPath;
};

type GraphBuilderContext = {
  config: INodeConfig;
  defs?: DefDefinitions;
  actionCatalog: ReadonlyMap<string, WorkflowAction>;
  bindingCatalog: WorkflowBindingCatalog;
};

type TraverseState = GraphBuilderContext & {
  registry: GraphRegistry;
  groups: Map<string, GroupMeta>;
};

const CONDITIONAL_ELSE_LABEL = "else";
const uniqueIds = (ids: string[]) => Array.from(new Set(ids));
const buildStepPath = (
  path: FlowStepPath,
  index: number,
  pathIndex?: number,
): FlowStepPath => [...path, pathIndex ?? index];
const getNextInsertPath = (
  stepPath: FlowStepPath,
): FlowStepPath | undefined => {
  const tail = stepPath[stepPath.length - 1];

  if (typeof tail !== "number") {
    return;
  }

  return [...stepPath.slice(0, -1), tail + 1];
};
const getGroupName = (groupPath: string[]) => groupPath[groupPath.length - 1];
const humanizeBindingKind = (kind: string): string => {
  return kind
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};
const getBindingPortLabel = (kind: string): string => {
  if (kind === "tools") {
    return "visual_editor.port_label.tools";
  }

  if (kind === "model") {
    return "visual_editor.port_label.model";
  }

  if (kind === "memory") {
    return "visual_editor.port_label.memory";
  }

  return humanizeBindingKind(kind);
};
const buildBindingOutPort = (
  bindingKind: string,
  index: number,
  total: number,
): BindingOutPort =>
  `${ELinkType.BINDING_OUT}-${index}-${total}-${encodeURIComponent(bindingKind)}`;
const buildBindingPorts = <
  TNodeType extends
    | ENodeType.TASK
    | ENodeType.BINDING_MULTI
    | ENodeType.BINDING_SINGLE,
>(
  bindingKinds: string[],
): WorkflowNodePort<TNodeType>[] => {
  return bindingKinds.map((bindingKind, index) => {
    return {
      id: buildBindingOutPort(bindingKind, index, bindingKinds.length),
      label: getBindingPortLabel(bindingKind),
    } as WorkflowNodePort<TNodeType>;
  });
};
const toBindingRefs = (
  value: unknown,
  bindingDefinition: WorkflowBindingDefinition | undefined,
): string[] => {
  const multiple = bindingDefinition?.multiple ?? true;

  if (multiple) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is string => typeof entry === "string")
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const normalized = value.trim();

    return normalized ? [normalized] : [];
  }

  // Be tolerant with invalid values and still recover displayable refs.
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .filter(Boolean);
};
const resolveCatalogBindingKinds = (
  candidateKinds: readonly string[],
  bindingCatalog: WorkflowBindingCatalog,
): string[] => {
  const availableKinds = new Set(bindingCatalog.keys());
  const resolvedKinds: string[] = [];

  candidateKinds.forEach((bindingKind) => {
    if (
      typeof bindingKind !== "string" ||
      !bindingKind ||
      !availableKinds.has(bindingKind) ||
      resolvedKinds.includes(bindingKind)
    ) {
      return;
    }

    resolvedKinds.push(bindingKind);
  });

  return resolvedKinds;
};
const resolveActionSupportedBindingKinds = (
  actionName: string,
  actionCatalog: ReadonlyMap<string, WorkflowAction>,
  bindingCatalog: WorkflowBindingCatalog,
): string[] => {
  if (!actionName) {
    return [];
  }

  const supportedKinds = actionCatalog.get(actionName)?.supportedBindings ?? [];

  return resolveCatalogBindingKinds(supportedKinds, bindingCatalog);
};
const resolveEffectiveBindingKindsForDef = (
  defDefinition: DefDefinitions[string],
  actionCatalog: ReadonlyMap<string, WorkflowAction>,
  bindingCatalog: WorkflowBindingCatalog,
): string[] => {
  if (isTaskDefinition(defDefinition)) {
    return resolveActionSupportedBindingKinds(
      defDefinition.action,
      actionCatalog,
      bindingCatalog,
    );
  }

  const bindingKindDefinition = bindingCatalog.get(defDefinition.kind);

  if (!bindingKindDefinition) {
    return [];
  }

  const actionPolicy = bindingKindDefinition.actionPolicy ?? "optional";

  if (actionPolicy === "required") {
    if (typeof defDefinition.action !== "string" || !defDefinition.action) {
      return [];
    }

    return resolveActionSupportedBindingKinds(
      defDefinition.action,
      actionCatalog,
      bindingCatalog,
    );
  }

  return resolveCatalogBindingKinds(
    bindingKindDefinition.supportedBindings ?? [],
    bindingCatalog,
  );
};
const buildConditionalOperatorOutPort = (
  branchIndex: number,
  branchesCount: number,
): ConditionalOperatorOutPort =>
  `${ELinkType.OPERATOR_OUT}-${branchIndex}-${branchesCount}`;
const getConditionalBranchLabel = (
  branch: CompiledConditionalStep["branches"][number],
): string => {
  if (!branch.condition) {
    return CONDITIONAL_ELSE_LABEL;
  }

  if (branch.condition.kind === "expression") {
    return branch.condition.source;
  }

  if (typeof branch.condition.value === "string") {
    return branch.condition.value;
  }

  try {
    return JSON.stringify(branch.condition.value);
  } catch {
    return String(branch.condition.value);
  }
};
const addSemanticNode = (
  state: TraverseState,
  {
    id,
    type,
    data,
    selectable,
    groupPath,
    level,
    stepId,
    stepPath,
    isPlaceholder,
    isAttachment,
  }: {
    id: string;
    type: ENodeType;
    data: Record<string, unknown>;
    selectable?: boolean;
    groupPath: string[];
    level: number;
    stepId?: string;
    stepPath?: FlowStepPath;
    isPlaceholder?: boolean;
    isAttachment?: boolean;
  },
) => {
  state.registry.upsertNode({
    id,
    type,
    data,
    selectable,
    meta: {
      groupPath,
      level,
      stepId,
      stepPath,
      isPlaceholder,
      isAttachment,
    },
  });

  groupPath.forEach((groupId) => {
    const group = state.groups.get(groupId);

    if (group) {
      group.memberNodeIds.add(id);
    }
  });
};
const addDirectEdge = (
  state: TraverseState,
  {
    source,
    target,
    sourceHandle,
    targetHandle,
    label,
    insertPath,
  }: {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
    insertPath?: FlowStepPath;
  },
) => {
  state.registry.upsertEdge({
    id: createEdgeId({
      source,
      target,
      sourceHandle,
      targetHandle,
      kind: "direct",
    }),
    source,
    target,
    sourceHandle,
    targetHandle,
    label,
    insertPath,
    kind: "direct",
  });
};
const ensureStartIndicator = (state: TraverseState, level: number) => {
  if (state.registry.getNode(START_INDICATOR_ID)) {
    return;
  }

  addSemanticNode(state, {
    id: START_INDICATOR_ID,
    type: ENodeType.INDICATOR,
    level,
    groupPath: [],
    data: {
      ...state.config.nodes[ENodeType.INDICATOR][EIndicatorType.WORKFLOW_START],
      indicator: EIndicatorType.WORKFLOW_START,
      level,
    },
  });
};
const ensureEndIndicator = (state: TraverseState) => {
  if (state.registry.getNode(END_INDICATOR_ID)) {
    return;
  }

  addSemanticNode(state, {
    id: END_INDICATOR_ID,
    type: ENodeType.INDICATOR,
    level: 0,
    groupPath: [],
    data: {
      ...state.config.nodes[ENodeType.INDICATOR][EIndicatorType.WORKFLOW_END],
      indicator: EIndicatorType.WORKFLOW_END,
    },
  });
};
const connectIncoming = (
  state: TraverseState,
  {
    incoming,
    target,
    level,
    insertPath,
    label,
    sourceHandle,
  }: {
    incoming: string[];
    target: string;
    level: number;
    insertPath?: FlowStepPath;
    label?: string;
    sourceHandle?: string;
  },
) => {
  if (!incoming.length) {
    ensureStartIndicator(state, level);
    addDirectEdge(state, {
      source: START_INDICATOR_ID,
      target,
      insertPath,
      label,
      sourceHandle,
    });

    return;
  }

  incoming.forEach((source, index) => {
    addDirectEdge(state, {
      source,
      target,
      insertPath,
      label: index === 0 ? label : undefined,
      sourceHandle: index === 0 ? sourceHandle : undefined,
    });
  });
};
const addPlaceholderNode = (
  state: TraverseState,
  {
    stepId,
    scope,
    branchIndex,
    level,
    groupPath,
    insertPath,
  }: {
    stepId: string;
    scope: "conditional" | "parallel" | "loop";
    branchIndex: number;
    level: number;
    groupPath: string[];
    insertPath: FlowStepPath;
  },
): string => {
  const placeholderNodeId = createPlaceholderNodeId(stepId, scope, branchIndex);

  addSemanticNode(state, {
    id: placeholderNodeId,
    type: ENodeType.BRANCH_PLACEHOLDER,
    level,
    groupPath,
    isPlaceholder: true,
    data: {
      ...state.config.nodes[ENodeType.BRANCH_PLACEHOLDER],
      level,
      groupName: getGroupName(groupPath),
      insertPath,
    },
  });

  return placeholderNodeId;
};
const resolveBindingNodeType = (
  multiple: boolean,
): ENodeType.BINDING_MULTI | ENodeType.BINDING_SINGLE =>
  multiple ? ENodeType.BINDING_MULTI : ENodeType.BINDING_SINGLE;
const getBindingNodeTheme = (
  bindingDefinition: WorkflowBindingDefinition | undefined,
) => ({
  ...(bindingDefinition?.color ? { borderColor: bindingDefinition.color } : {}),
  ...(bindingDefinition?.icon ? { icon: bindingDefinition.icon } : {}),
});
const getBindingNodeDescription = ({
  bindingName,
  defs,
}: {
  bindingName: string;
  defs: DefDefinitions | undefined;
}) => {
  const def = defs?.[bindingName] as { description?: unknown } | undefined;

  return typeof def?.description === "string"
    ? def.description.trim()
    : undefined;
};
const addDefAttachments = (
  state: TraverseState,
  {
    stepId,
    stepPath,
    ownerDefName,
    taskName,
    parentNodeId,
    level,
    visitedOwnerDefs,
  }: {
    stepId: string;
    stepPath: FlowStepPath;
    ownerDefName: string;
    taskName: string;
    parentNodeId: string;
    level: number;
    visitedOwnerDefs: Set<string>;
  },
) => {
  if (visitedOwnerDefs.has(ownerDefName)) {
    return;
  }

  const ownerDefinition = state.defs?.[ownerDefName];

  if (!ownerDefinition) {
    return;
  }

  const bindingKinds = resolveEffectiveBindingKindsForDef(
    ownerDefinition,
    state.actionCatalog,
    state.bindingCatalog,
  );
  const nextVisitedOwnerDefs = new Set(visitedOwnerDefs);

  nextVisitedOwnerDefs.add(ownerDefName);

  bindingKinds.forEach((bindingKind, bindingIndex) => {
    const bindingDefinition = state.bindingCatalog.get(bindingKind);

    if (!bindingDefinition) {
      return;
    }

    const isMultiple = bindingDefinition?.multiple ?? true;
    const bindingPlaceholderTheme = bindingDefinition?.color
      ? { borderColor: bindingDefinition.color }
      : {};
    const sourceHandle = buildBindingOutPort(
      bindingKind,
      bindingIndex,
      bindingKinds.length,
    );
    const mountedRefs = toBindingRefs(
      ownerDefinition.bindings?.[bindingKind],
      bindingDefinition,
    );
    const placeholderNodeId = createBindingPlaceholderNodeId(
      stepId,
      ownerDefName,
      bindingKind,
    );

    mountedRefs.forEach((bindingName, bindingRefIndex) => {
      const mountedDefinition = state.defs?.[bindingName];
      const mountedBindingKind =
        typeof mountedDefinition?.kind === "string"
          ? mountedDefinition.kind
          : bindingKind;
      const mountedBindingDefinition =
        state.bindingCatalog.get(mountedBindingKind) ?? bindingDefinition;
      const nestedBindingKinds = mountedDefinition
        ? resolveEffectiveBindingKindsForDef(
            mountedDefinition,
            state.actionCatalog,
            state.bindingCatalog,
          )
        : [];
      const bindingNodeType = resolveBindingNodeType(isMultiple);
      const bindingNodeId = createAttachmentNodeId(
        stepId,
        ownerDefName,
        bindingName,
        bindingRefIndex,
        bindingKind,
      );
      const bindingNodeBaseData = state.config.nodes[bindingNodeType];
      const ports = [
        ...bindingNodeBaseData.ports,
        ...buildBindingPorts<typeof bindingNodeType>(nestedBindingKinds),
      ] as typeof bindingNodeBaseData.ports;

      addSemanticNode(state, {
        id: bindingNodeId,
        type: bindingNodeType,
        level,
        stepPath,
        groupPath: [],
        isAttachment: true,
        data: {
          ...bindingNodeBaseData,
          title: bindingName,
          i18nTitle: undefined,
          description: getBindingNodeDescription({
            bindingName,
            defs: state.defs,
          }),
          stepId,
          stepPath,
          taskName,
          ownerDefName,
          ownerBindingKind: bindingKind,
          bindingKind: mountedBindingKind,
          bindingName,
          level,
          ports,
          theme: {
            ...bindingNodeBaseData.theme,
            ...getBindingNodeTheme(mountedBindingDefinition),
          },
        },
      });

      addDirectEdge(state, {
        source: parentNodeId,
        target: bindingNodeId,
        sourceHandle,
      });

      addDefAttachments(state, {
        stepId,
        stepPath,
        ownerDefName: bindingName,
        taskName,
        parentNodeId: bindingNodeId,
        level,
        visitedOwnerDefs: nextVisitedOwnerDefs,
      });
    });

    if (isMultiple || mountedRefs.length === 0) {
      const bindingPlaceholderBaseData =
        state.config.nodes[ENodeType.BINDING_PLACEHOLDER];

      addSemanticNode(state, {
        id: placeholderNodeId,
        type: ENodeType.BINDING_PLACEHOLDER,
        level,
        stepPath,
        groupPath: [],
        isAttachment: true,
        data: {
          ...bindingPlaceholderBaseData,
          title: bindingKind,
          i18nTitle: undefined,
          description: "",
          stepId,
          stepPath,
          taskName,
          ownerDefName,
          bindingKind,
          level,
          theme: {
            ...bindingPlaceholderBaseData.theme,
            ...bindingPlaceholderTheme,
          },
        },
      });

      addDirectEdge(state, {
        source: parentNodeId,
        target: placeholderNodeId,
        sourceHandle,
      });
    }
  });
};
const walkParallelSteps = (
  step: CompiledParallelStep,
  operatorNodeId: string,
  level: number,
  stepPath: FlowStepPath,
  operatorGroupPath: string[],
  state: TraverseState,
): TraversalExit[] => {
  const parallelStepsPath: FlowStepPath = [...stepPath, "parallel", "steps"];
  const parallelSteps = Array.isArray(step.steps) ? step.steps : [];
  const joinInsertPath: FlowStepPath = [
    ...parallelStepsPath,
    parallelSteps.length,
  ];
  const joinPlaceholderId = addPlaceholderNode(state, {
    stepId: step.id,
    scope: "parallel",
    branchIndex: parallelSteps.length,
    level: level + 1,
    groupPath: operatorGroupPath,
    insertPath: joinInsertPath,
  });

  if (!parallelSteps.length) {
    addDirectEdge(state, {
      source: operatorNodeId,
      target: joinPlaceholderId,
    });
  }

  parallelSteps.forEach((branchStep, branchIndex) => {
    const exits = walkStep({
      step: branchStep,
      index: 0,
      pathIndex: branchIndex,
      level: level + 1,
      incoming: [operatorNodeId],
      path: parallelStepsPath,
      groupPath: operatorGroupPath,
      state,
      disableEntryInsertPath: true,
    });

    uniqueIds(exits.map((exit) => exit.nodeId)).forEach((exitNodeId) => {
      addDirectEdge(state, {
        source: exitNodeId,
        target: joinPlaceholderId,
      });
    });
  });

  return [
    {
      nodeId: joinPlaceholderId,
      nextInsertPath: getNextInsertPath(stepPath),
    },
  ];
};
const walkConditionalBranches = (
  step: CompiledConditionalStep,
  operatorNodeId: string,
  level: number,
  stepPath: FlowStepPath,
  operatorGroupPath: string[],
  state: TraverseState,
): TraversalExit[] => {
  const branchesCount = step.branches.length;
  const conditionPortLabels = step.branches.map((branch, branchIndex) => ({
    handleId: buildConditionalOperatorOutPort(branchIndex, branchesCount),
    label: getConditionalBranchLabel(branch),
  }));

  return step.branches.map((branch, branchIndex) => {
    const branchSourceHandle = conditionPortLabels[branchIndex]?.handleId;
    const branchSteps = Array.isArray(branch.steps) ? branch.steps : [];
    const conditionalStepsPath: FlowStepPath = [
      ...stepPath,
      "conditional",
      "when",
      branchIndex,
      "steps",
    ];
    const insertPath: FlowStepPath = [
      ...conditionalStepsPath,
      branchSteps.length,
    ];
    const branchExits =
      branchSteps.length > 0
        ? walkSteps({
            steps: branchSteps,
            level: level + 1,
            incoming: [operatorNodeId],
            path: conditionalStepsPath,
            groupPath: operatorGroupPath,
            state,
            entryEdgeSourceHandle: branchSourceHandle,
          })
        : [{ nodeId: operatorNodeId }];
    const placeholderNodeId = addPlaceholderNode(state, {
      stepId: step.id,
      scope: "conditional",
      branchIndex,
      level: level + 1,
      groupPath: operatorGroupPath,
      insertPath,
    });

    uniqueIds(branchExits.map((exit) => exit.nodeId)).forEach(
      (branchExitNodeId, exitIndex) => {
        addDirectEdge(state, {
          source: branchExitNodeId,
          target: placeholderNodeId,
          sourceHandle:
            branchSteps.length === 0 && exitIndex === 0
              ? branchSourceHandle
              : undefined,
        });
      },
    );

    return {
      nodeId: placeholderNodeId,
      nextInsertPath: getNextInsertPath(stepPath),
    };
  });
};
const walkLoopSteps = (
  step: CompiledLoopStep,
  operatorNodeId: string,
  level: number,
  stepPath: FlowStepPath,
  operatorGroupPath: string[],
  state: TraverseState,
): TraversalExit[] => {
  const loopSteps = Array.isArray(step.steps) ? step.steps : [];
  const loopStepsPath: FlowStepPath = [...stepPath, "loop", "steps"];
  const insertPath: FlowStepPath = [...loopStepsPath, loopSteps.length];
  const loopExits =
    loopSteps.length > 0
      ? walkSteps({
          steps: loopSteps,
          level: level + 1,
          incoming: [operatorNodeId],
          path: loopStepsPath,
          groupPath: operatorGroupPath,
          state,
        })
      : [{ nodeId: operatorNodeId }];
  const placeholderNodeId = addPlaceholderNode(state, {
    stepId: step.id,
    scope: "loop",
    branchIndex: 0,
    level: level + 1,
    groupPath: operatorGroupPath,
    insertPath,
  });

  uniqueIds(loopExits.map((exit) => exit.nodeId)).forEach((loopExitNodeId) => {
    addDirectEdge(state, {
      source: loopExitNodeId,
      target: placeholderNodeId,
    });
  });

  return [
    {
      nodeId: placeholderNodeId,
      nextInsertPath: getNextInsertPath(stepPath),
    },
  ];
};
const walkStep = ({
  step,
  index,
  level,
  incoming,
  state,
  path,
  pathIndex,
  entryEdgeLabel,
  entryEdgeSourceHandle,
  groupPath,
  disableEntryInsertPath,
}: WalkStepArgs): TraversalExit[] => {
  const stepPath = buildStepPath(path, index, pathIndex);
  const entryInsertPath = disableEntryInsertPath ? undefined : stepPath;

  if (step.type === StepType.Task) {
    const taskDefinition = state.defs?.[step.taskName];
    const actionName =
      taskDefinition && isTaskDefinition(taskDefinition)
        ? taskDefinition.action
        : (getTaskAction(step.taskName, state.defs) ?? "");
    const bindingKinds =
      taskDefinition && isTaskDefinition(taskDefinition)
        ? resolveEffectiveBindingKindsForDef(
            taskDefinition,
            state.actionCatalog,
            state.bindingCatalog,
          )
        : [];
    const taskNodeId = createStepNodeId(step.id, "task");
    const groupName = getGroupName(groupPath);
    const taskBaseData = state.config.nodes[ENodeType.TASK];
    const ports: WorkflowNodePort<ENodeType.TASK>[] = [
      ...taskBaseData.ports,
      ...buildBindingPorts<ENodeType.TASK>(bindingKinds),
    ];

    addSemanticNode(state, {
      id: taskNodeId,
      type: ENodeType.TASK,
      selectable: true,
      level,
      stepId: step.id,
      stepPath,
      groupPath,
      data: {
        ...taskBaseData,
        title: step.taskName,
        description: getTaskDescription(step.taskName, state.defs),
        actionName,
        stepId: step.id,
        taskName: step.taskName,
        level,
        groupName,
        stepPath,
        ports,
      },
    });

    addDefAttachments(state, {
      stepId: step.id,
      stepPath,
      ownerDefName: step.taskName,
      taskName: step.taskName,
      parentNodeId: taskNodeId,
      level,
      visitedOwnerDefs: new Set(),
    });

    connectIncoming(state, {
      incoming,
      target: taskNodeId,
      level,
      insertPath: entryInsertPath,
      label: entryEdgeLabel,
      sourceHandle: entryEdgeSourceHandle,
    });

    return [
      {
        nodeId: taskNodeId,
        nextInsertPath: getNextInsertPath(stepPath),
      },
    ];
  }

  const operatorType = step.type as EOperatorType;
  const groupId = createGroupId(step.id);
  const operatorGroupPath = [...groupPath, groupId];
  const operatorNodeId = createStepNodeId(step.id, "operator");
  const operatorBaseData = state.config.nodes[ENodeType.OPERATOR][operatorType];

  state.groups.set(groupId, {
    id: groupId,
    operatorType,
    level,
    memberNodeIds: new Set(),
  });

  const ports: WorkflowNodePort<ENodeType.OPERATOR>[] =
    operatorType === StepType.Conditional
      ? (step as CompiledConditionalStep).branches.map(
          (branch, branchIndex, branches) => ({
            id: buildConditionalOperatorOutPort(branchIndex, branches.length),
            label: getConditionalBranchLabel(branch),
          }),
        )
      : operatorType === StepType.Parallel &&
          (step as CompiledParallelStep).strategy
        ? operatorBaseData.ports.map((portDef) => {
            if (portDef === ELinkType.OPERATOR_OUT) {
              return {
                id: ELinkType.OPERATOR_OUT,
                label: `visual_editor.parallel_drawer.form.strategy.${
                  (step as CompiledParallelStep).strategy
                }.label`,
              };
            }

            if (
              typeof portDef !== "string" &&
              portDef.id === ELinkType.OPERATOR_OUT
            ) {
              return {
                ...portDef,
                label: `visual_editor.parallel_drawer.form.strategy.${
                  (step as CompiledParallelStep).strategy
                }.label`,
              };
            }

            return portDef;
          })
        : operatorType === StepType.Loop
          ? operatorBaseData.ports.map((portDef) => {
              if (portDef === ELinkType.OPERATOR_OUT) {
                return {
                  id: ELinkType.OPERATOR_OUT,
                  label: `visual_editor.loop_drawer.form.type.${
                    (step as CompiledLoopStep).loopType
                  }.label`,
                };
              }

              if (
                typeof portDef !== "string" &&
                portDef.id === ELinkType.OPERATOR_OUT
              ) {
                return {
                  ...portDef,
                  label: `visual_editor.loop_drawer.form.type.${
                    (step as CompiledLoopStep).loopType
                  }.label`,
                };
              }

              return portDef;
            })
          : operatorBaseData.ports;
  const resolvedPorts: WorkflowNodePort<ENodeType.OPERATOR>[] =
    operatorType === StepType.Conditional
      ? [ELinkType.OPERATOR_IN, ...ports]
      : ports;

  addSemanticNode(state, {
    id: operatorNodeId,
    type: ENodeType.OPERATOR,
    selectable: true,
    level,
    stepId: step.id,
    stepPath,
    groupPath: operatorGroupPath,
    data: {
      ...operatorBaseData,
      stepId: step.id,
      level,
      groupName: groupId,
      stepPath,
      strategy:
        operatorType === StepType.Parallel
          ? (step as CompiledParallelStep).strategy
          : undefined,
      ports: resolvedPorts,
    },
  });

  connectIncoming(state, {
    incoming,
    target: operatorNodeId,
    level,
    insertPath: entryInsertPath,
    label: entryEdgeLabel,
    sourceHandle: entryEdgeSourceHandle,
  });

  if (operatorType === StepType.Parallel) {
    return walkParallelSteps(
      step as CompiledParallelStep,
      operatorNodeId,
      level,
      stepPath,
      operatorGroupPath,
      state,
    );
  }

  if (operatorType === StepType.Conditional) {
    return walkConditionalBranches(
      step as CompiledConditionalStep,
      operatorNodeId,
      level,
      stepPath,
      operatorGroupPath,
      state,
    );
  }

  return walkLoopSteps(
    step as CompiledLoopStep,
    operatorNodeId,
    level,
    stepPath,
    operatorGroupPath,
    state,
  );
};
const walkSteps = ({
  steps,
  level,
  incoming,
  state,
  path,
  groupPath,
  entryEdgeLabel,
  entryEdgeSourceHandle,
}: WalkArgs): TraversalExit[] => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return uniqueIds(incoming).map((nodeId) => ({ nodeId }));
  }

  let currentIncoming = uniqueIds(incoming);
  let currentExits: TraversalExit[] = [];

  steps.forEach((step, index) => {
    currentExits = walkStep({
      step,
      index,
      level,
      incoming: currentIncoming,
      state,
      path,
      groupPath,
      entryEdgeLabel: index === 0 ? entryEdgeLabel : undefined,
      entryEdgeSourceHandle: index === 0 ? entryEdgeSourceHandle : undefined,
    });
    currentIncoming = uniqueIds(currentExits.map((exit) => exit.nodeId));
  });

  return currentExits;
};

export const traverseWorkflow = ({
  flow,
  config,
  defs,
  actionCatalog,
  bindingCatalog,
}: {
  flow?: CompiledStep[];
} & GraphBuilderContext): {
  registry: GraphRegistry;
  groups: Map<string, GroupMeta>;
  exits: TraversalExit[];
} => {
  const registry = new GraphRegistry();
  const groups = new Map<string, GroupMeta>();
  const state: TraverseState = {
    config,
    defs,
    actionCatalog,
    bindingCatalog,
    registry,
    groups,
  };

  if (!flow?.length) {
    return { registry, groups, exits: [] };
  }

  const exits = walkSteps({
    steps: flow,
    level: 0,
    incoming: [],
    state,
    path: ["flow"],
    groupPath: [],
  });

  ensureEndIndicator(state);

  exits.forEach((exit) => {
    addDirectEdge(state, {
      source: exit.nodeId,
      target: END_INDICATOR_ID,
      insertPath: exit.nextInsertPath,
    });
  });

  return { registry, groups, exits };
};

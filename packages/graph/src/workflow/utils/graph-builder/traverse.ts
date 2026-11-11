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
  type EOperatorType,
  type INodeConfig,
  type WorkflowAction,
  type WorkflowBindingCatalog,
  type WorkflowBindingDefinition,
  type WorkflowNodePort,
} from "../../types/workflow-node.types";
import type { FlowStepPath } from "../../types/workflow-path.types";
import {
  buildBindingOutPort,
  buildConditionalOperatorOutPort,
} from "../port-rules";
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
const BINDING_PORT_LABELS: Record<string, string> = {
  tools: "visual_editor.port_label.tools",
  model: "visual_editor.port_label.model",
  memory: "visual_editor.port_label.memory",
};
const getBindingPortLabel = (kind: string): string =>
  BINDING_PORT_LABELS[kind] ?? humanizeBindingKind(kind);
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

  if (!multiple && typeof value === "string") {
    const normalized = value.trim();

    return normalized ? [normalized] : [];
  }

  // Be tolerant with invalid values and still recover displayable refs.
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is string => typeof entry === "string" && Boolean(entry),
  );
};
const resolveCatalogBindingKinds = (
  candidateKinds: readonly string[],
  bindingCatalog: WorkflowBindingCatalog,
): string[] => [
  ...new Set(
    candidateKinds.filter(
      (bindingKind) =>
        typeof bindingKind === "string" &&
        bindingKind &&
        bindingCatalog.has(bindingKind),
    ),
  ),
];
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
const relabelOperatorOutPorts = (
  ports: WorkflowNodePort<ENodeType.OPERATOR>[],
  label: string,
): WorkflowNodePort<ENodeType.OPERATOR>[] =>
  ports.map((portDef) => {
    if (portDef === ELinkType.OPERATOR_OUT) {
      return { id: ELinkType.OPERATOR_OUT, label };
    }

    if (typeof portDef !== "string" && portDef.id === ELinkType.OPERATOR_OUT) {
      return { ...portDef, label };
    }

    return portDef;
  });
const resolveOperatorPorts = (
  step: CompiledStep,
  operatorType: EOperatorType,
  basePorts: WorkflowNodePort<ENodeType.OPERATOR>[],
): WorkflowNodePort<ENodeType.OPERATOR>[] => {
  if (operatorType === StepType.Conditional) {
    const branches = (step as CompiledConditionalStep).branches;

    return [
      ELinkType.OPERATOR_IN,
      ...branches.map((branch, branchIndex) => ({
        id: buildConditionalOperatorOutPort(branchIndex, branches.length),
        label: getConditionalBranchLabel(branch),
      })),
    ];
  }

  if (
    operatorType === StepType.Parallel &&
    (step as CompiledParallelStep).strategy
  ) {
    return relabelOperatorOutPorts(
      basePorts,
      `visual_editor.parallel_drawer.form.strategy.${
        (step as CompiledParallelStep).strategy
      }.label`,
    );
  }

  if (operatorType === StepType.Loop) {
    return relabelOperatorOutPorts(
      basePorts,
      `visual_editor.loop_drawer.form.type.${
        (step as CompiledLoopStep).loopType
      }.label`,
    );
  }

  return basePorts;
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
const ensureIndicatorNode = (
  state: TraverseState,
  id: string,
  indicator: EIndicatorType,
  level: number,
  extraData?: Record<string, unknown>,
) => {
  if (state.registry.getNode(id)) {
    return;
  }

  addSemanticNode(state, {
    id,
    type: ENodeType.INDICATOR,
    level,
    groupPath: [],
    data: {
      ...state.config.nodes[ENodeType.INDICATOR][indicator],
      indicator,
      ...extraData,
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
    ensureIndicatorNode(
      state,
      START_INDICATOR_ID,
      EIndicatorType.WORKFLOW_START,
      level,
      { level },
    );
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

type AttachmentOwner = {
  stepId: string;
  stepPath: FlowStepPath;
  ownerDefName: string;
  taskName: string;
  parentNodeId: string;
  level: number;
};

/** One binding kind of an owner def, and the handle its attachments hang from. */
type BindingSlot = AttachmentOwner & {
  bindingKind: string;
  bindingDefinition: WorkflowBindingDefinition;
  isMultiple: boolean;
  sourceHandle: string;
};

// A def mounted in a binding slot, followed by the defs mounted in its own slots.
const addMountedBinding = (
  state: TraverseState,
  slot: BindingSlot,
  bindingName: string,
  bindingRefIndex: number,
  visitedOwnerDefs: Set<string>,
) => {
  const {
    stepId,
    stepPath,
    ownerDefName,
    taskName,
    parentNodeId,
    level,
    bindingKind,
    bindingDefinition,
    isMultiple,
    sourceHandle,
  } = slot;
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
    visitedOwnerDefs,
  });
};
// The "+" of a binding slot that can still take a def.
const addBindingPlaceholder = (state: TraverseState, slot: BindingSlot) => {
  const {
    stepId,
    stepPath,
    ownerDefName,
    taskName,
    parentNodeId,
    level,
    bindingKind,
    bindingDefinition,
    sourceHandle,
  } = slot;
  const placeholderNodeId = createBindingPlaceholderNodeId(
    stepId,
    ownerDefName,
    bindingKind,
  );
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
        ...(bindingDefinition.color
          ? { borderColor: bindingDefinition.color }
          : {}),
      },
    },
  });

  addDirectEdge(state, {
    source: parentNodeId,
    target: placeholderNodeId,
    sourceHandle,
  });
};
// Attach the defs mounted in each binding slot of `ownerDefName`, recursively;
// `visitedOwnerDefs` stops a def that mounts itself, directly or not.
const addDefAttachments = (
  state: TraverseState,
  {
    visitedOwnerDefs,
    ...owner
  }: AttachmentOwner & { visitedOwnerDefs: Set<string> },
) => {
  if (visitedOwnerDefs.has(owner.ownerDefName)) {
    return;
  }

  const ownerDefinition = state.defs?.[owner.ownerDefName];

  if (!ownerDefinition) {
    return;
  }

  const bindingKinds = resolveEffectiveBindingKindsForDef(
    ownerDefinition,
    state.actionCatalog,
    state.bindingCatalog,
  );
  const nextVisitedOwnerDefs = new Set(visitedOwnerDefs).add(
    owner.ownerDefName,
  );

  bindingKinds.forEach((bindingKind, bindingIndex) => {
    const bindingDefinition = state.bindingCatalog.get(bindingKind);

    if (!bindingDefinition) {
      return;
    }

    const slot: BindingSlot = {
      ...owner,
      bindingKind,
      bindingDefinition,
      isMultiple: bindingDefinition.multiple ?? true,
      sourceHandle: buildBindingOutPort(
        bindingKind,
        bindingIndex,
        bindingKinds.length,
      ),
    };
    const mountedRefs = toBindingRefs(
      ownerDefinition.bindings?.[bindingKind],
      bindingDefinition,
    );

    mountedRefs.forEach((bindingName, bindingRefIndex) => {
      addMountedBinding(
        state,
        slot,
        bindingName,
        bindingRefIndex,
        nextVisitedOwnerDefs,
      );
    });

    // A single-def slot loses its "+" once a def is mounted in it.
    if (slot.isMultiple || mountedRefs.length === 0) {
      addBindingPlaceholder(state, slot);
    }
  });
};
const connectExitsToPlaceholder = (
  state: TraverseState,
  exits: TraversalExit[],
  placeholderNodeId: string,
  firstSourceHandle?: string,
) => {
  uniqueIds(exits.map((exit) => exit.nodeId)).forEach((exitNodeId, index) => {
    addDirectEdge(state, {
      source: exitNodeId,
      target: placeholderNodeId,
      sourceHandle: index === 0 ? firstSourceHandle : undefined,
    });
  });
};
// Walk one operator branch (a conditional branch or a loop body) into its
// trailing placeholder; empty branches connect the operator straight to it.
const walkBranchToPlaceholder = ({
  state,
  operatorNodeId,
  stepId,
  scope,
  branchIndex,
  level,
  steps,
  stepsPath,
  groupPath,
  entryEdgeSourceHandle,
}: {
  state: TraverseState;
  operatorNodeId: string;
  stepId: string;
  scope: "conditional" | "loop";
  branchIndex: number;
  level: number;
  steps: CompiledStep[] | undefined;
  stepsPath: FlowStepPath;
  groupPath: string[];
  entryEdgeSourceHandle?: string;
}): string => {
  const branchSteps = Array.isArray(steps) ? steps : [];
  const branchExits =
    branchSteps.length > 0
      ? walkSteps({
          steps: branchSteps,
          level: level + 1,
          incoming: [operatorNodeId],
          path: stepsPath,
          groupPath,
          state,
          entryEdgeSourceHandle,
        })
      : [{ nodeId: operatorNodeId }];
  const placeholderNodeId = addPlaceholderNode(state, {
    stepId,
    scope,
    branchIndex,
    level: level + 1,
    groupPath,
    insertPath: [...stepsPath, branchSteps.length],
  });

  connectExitsToPlaceholder(
    state,
    branchExits,
    placeholderNodeId,
    branchSteps.length === 0 ? entryEdgeSourceHandle : undefined,
  );

  return placeholderNodeId;
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
  const joinPlaceholderId = addPlaceholderNode(state, {
    stepId: step.id,
    scope: "parallel",
    branchIndex: parallelSteps.length,
    level: level + 1,
    groupPath: operatorGroupPath,
    insertPath: [...parallelStepsPath, parallelSteps.length],
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

    connectExitsToPlaceholder(state, exits, joinPlaceholderId);
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
): TraversalExit[] =>
  step.branches.map((branch, branchIndex) => ({
    nodeId: walkBranchToPlaceholder({
      state,
      operatorNodeId,
      stepId: step.id,
      scope: "conditional",
      branchIndex,
      level,
      steps: branch.steps,
      stepsPath: [...stepPath, "conditional", "when", branchIndex, "steps"],
      groupPath: operatorGroupPath,
      entryEdgeSourceHandle: buildConditionalOperatorOutPort(
        branchIndex,
        step.branches.length,
      ),
    }),
    nextInsertPath: getNextInsertPath(stepPath),
  }));
const walkLoopSteps = (
  step: CompiledLoopStep,
  operatorNodeId: string,
  level: number,
  stepPath: FlowStepPath,
  operatorGroupPath: string[],
  state: TraverseState,
): TraversalExit[] => [
  {
    nodeId: walkBranchToPlaceholder({
      state,
      operatorNodeId,
      stepId: step.id,
      scope: "loop",
      branchIndex: 0,
      level,
      steps: step.steps,
      stepsPath: [...stepPath, "loop", "steps"],
      groupPath: operatorGroupPath,
    }),
    nextInsertPath: getNextInsertPath(stepPath),
  },
];

type TaskStep = Extract<CompiledStep, { type: StepType.Task }>;
type OperatorStep = Exclude<CompiledStep, TaskStep>;
/** A step's position in the walk once its own path is known. */
type StepWalk = Omit<WalkArgs, "steps"> & {
  stepPath: FlowStepPath;
  entryInsertPath?: FlowStepPath;
};

const walkTaskStep = (
  step: TaskStep,
  {
    level,
    incoming,
    state,
    groupPath,
    stepPath,
    entryInsertPath,
    entryEdgeLabel,
    entryEdgeSourceHandle,
  }: StepWalk,
): TraversalExit[] => {
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
};
// An operator opens a group holding the operator and every node of its branches.
const walkOperatorStep = (
  step: OperatorStep,
  {
    level,
    incoming,
    state,
    groupPath,
    stepPath,
    entryInsertPath,
    entryEdgeLabel,
    entryEdgeSourceHandle,
  }: StepWalk,
): TraversalExit[] => {
  const operatorType: EOperatorType = step.type;
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

  const resolvedPorts = resolveOperatorPorts(
    step,
    operatorType,
    operatorBaseData.ports,
  );

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
      strategy: step.type === StepType.Parallel ? step.strategy : undefined,
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

  switch (step.type) {
    case StepType.Parallel:
      return walkParallelSteps(
        step,
        operatorNodeId,
        level,
        stepPath,
        operatorGroupPath,
        state,
      );
    case StepType.Conditional:
      return walkConditionalBranches(
        step,
        operatorNodeId,
        level,
        stepPath,
        operatorGroupPath,
        state,
      );
    default:
      return walkLoopSteps(
        step,
        operatorNodeId,
        level,
        stepPath,
        operatorGroupPath,
        state,
      );
  }
};
const walkStep = ({
  step,
  index,
  pathIndex,
  disableEntryInsertPath,
  ...walk
}: WalkStepArgs): TraversalExit[] => {
  const stepPath = buildStepPath(walk.path, index, pathIndex);
  const stepWalk: StepWalk = {
    ...walk,
    stepPath,
    entryInsertPath: disableEntryInsertPath ? undefined : stepPath,
  };

  return step.type === StepType.Task
    ? walkTaskStep(step, stepWalk)
    : walkOperatorStep(step, stepWalk);
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

  ensureIndicatorNode(state, END_INDICATOR_ID, EIndicatorType.WORKFLOW_END, 0);

  exits.forEach((exit) => {
    addDirectEdge(state, {
      source: exit.nodeId,
      target: END_INDICATOR_ID,
      insertPath: exit.nextInsertPath,
    });
  });

  return { registry, groups, exits };
};

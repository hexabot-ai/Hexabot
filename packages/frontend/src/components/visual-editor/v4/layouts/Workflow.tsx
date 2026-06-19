/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  Workflow as WorkflowHelper,
  type JsonValue,
  type Settings,
} from "@hexabot-ai/agentic";
import {
  ENodeType,
  WorkflowGraph,
  type EdgeInsertType,
  type FlowStepPath,
  type WorkflowBindingAddPayload,
  type WorkflowBindingRemovePayload,
  type WorkflowGraphColorMode,
  type WorkflowGraphHandle,
  type WorkflowSelectionSnapshot,
} from "@hexabot-ai/graph";
import type { Workflow as WorkflowEntity } from "@hexabot-ai/types";
import { Box, Button, Stack, styled } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import type { Node, NodeMouseHandler } from "@xyflow/react";
import { CloudOff, CloudUpload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { ConfirmDialogBody } from "@/app-components/dialogs";
import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useWorkflowBindingsCatalog } from "@/contexts/workflow-bindings.context";
import { useDelete } from "@/hooks/crud/useDelete";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useAuth } from "@/hooks/useAuth";
import { useDialogs } from "@/hooks/useDialogs";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import type { IAction } from "@/types/action.types";

import { WorkflowFormDialog } from "../components/forms/WorkflowFormDialog";
import {
  ActionFormDrawer,
  type ActionFormDrawerCreateTarget,
} from "../components/main/ActionDrawer/ActionFormDrawer/ActionFormDrawer";
import { ActionListDrawer } from "../components/main/ActionDrawer/ActionListDrawer";
import { BindingSelectionDrawer } from "../components/main/BindingDrawer/BindingSelectionDrawer";
import { ConditionalFormDrawer } from "../components/main/ConditionalDrawer/ConditionalFormDrawer";
import { FlowsDrawer } from "../components/main/FlowsDrawer";
import { LoopFormDrawer } from "../components/main/LoopDrawer/LoopFormDrawer";
import { ParallelFormDrawer } from "../components/main/ParallelDrawer/ParallelFormDrawer";
import {
  ToolFormDrawer,
  type ToolFormDrawerTarget,
} from "../components/main/ToolDrawer/ToolFormDrawer";
import { WorkflowBottomDrawer } from "../components/main/WorkflowBottomDrawer";
import { WorkflowMenu } from "../components/main/WorkflowMenu";
import { WorkflowTitleBar } from "../components/main/WorkflowTitleBar";
import { WorkflowSettingsDialog } from "../components/main/WorkflowTitleBar/WorkflowSettingsDialog";
import { useWorkflow } from "../hooks/useWorkflow";
import { useWorkflowExecutionState } from "../hooks/useWorkflowExecutionState";
import { humanizeBindingKind } from "../utils/binding-kind.utils";
import {
  createUniqueBindingName,
  normalizeBindingName,
} from "../utils/binding-name.utils";
import { getSchemaDefaults } from "../utils/schema-defaults.utils";
import {
  mountDefBindingRef,
  setDefBindingRefs,
  toBindingRefs,
  unmountDefBindingRef,
} from "../utils/task-bindings.utils";
import { TOOL_BINDING_KIND } from "../utils/tool-bindings.utils";
import {
  getDisabledBindingRefs,
  isNonToolBindingKind,
} from "../utils/workflow-binding-routing.utils";
import {
  createBaseDefinition,
  createTaskName,
} from "../utils/workflow-definition.utils";
import "./workflow-layout.css";

const StyledBox = styled(Box)(() => ({
  position: "relative",
  height: "100%",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
}));
const WorkflowTitleOverlay = styled(Box)(() => ({
  position: "absolute",
  top: 12,
  left: 12,
  zIndex: 2,
  maxWidth: "calc(100% - 24px)",
}));
const WorkflowPublishOverlay = styled(Box)(() => ({
  position: "absolute",
  top: 12,
  right: 12,
  zIndex: 2,
}));

type EditingBindingTarget = {
  bindingKind: string;
  bindingName: string;
};

export const Workflow = () => {
  const { t } = useTranslate();
  const { mode } = useColorScheme();
  const { query } = useAppRouter();
  const { nodeIds } = query;
  const {
    workflow,
    workflows,
    selectedFlowId,
    direction,
    selectedNodeIds,
    debouncedWorkflowUpdate,
    updateWorkflow,
    updateWorkflowURL,
    definition,
    taskDefinitions,
    flow,
    isDefinitionDirty,
    isSaving: isDefinitionSaving,
    isExportingWorkflow,
    exportWorkflow,
    removeStepAtPath,
    setGraphSelection,
    updateDefinitionState,
    persistDefinition,
    publishVersion,
    unpublishVersion,
    addConditionalStep,
    addLoopStep,
    addParallelStep,
    yaml,
  } = useWorkflow();
  const { actions, actionsByName } = useWorkflowActionsCatalog();
  const { bindingsByName } = useWorkflowBindingsCatalog();
  const dialogs = useDialogs();
  const { refetchUser } = useAuth();
  const { mutate: deleteWorkflow } = useDelete(EntityType.WORKFLOW);
  const isEmptyWorkflow = !definition?.flow?.length;
  const [actionsDrawerOpen, setActionsDrawerOpen] = useState(false);
  const [pendingInsertPath, setPendingInsertPath] =
    useState<FlowStepPath | null>(null);
  const [pendingActionCreateTarget, setPendingActionCreateTarget] =
    useState<ActionFormDrawerCreateTarget | null>(null);
  const [pendingToolBindingAdd, setPendingToolBindingAdd] =
    useState<WorkflowBindingAddPayload | null>(null);
  const [pendingBindingAdd, setPendingBindingAdd] =
    useState<WorkflowBindingAddPayload | null>(null);
  const [editingBindingTarget, setEditingBindingTarget] =
    useState<EditingBindingTarget | null>(null);
  const [toolDrawerTarget, setToolDrawerTarget] =
    useState<ToolFormDrawerTarget | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [menuFlowId, setMenuFlowId] = useState<string | null>(null);
  const actionsDrawerId = "workflow-actions-drawer";
  const publishLabel = t("button.publish");
  const unpublishLabel = t("button.unpublish");
  const exportLabel = t("visual_editor.flows_drawer.export_workflow");
  const graphColorMode: WorkflowGraphColorMode =
    mode === "light" || mode === "dark" ? mode : "system";
  const workflowGraphRef = useRef<WorkflowGraphHandle | null>(null);
  const [activeCodeDef, setActiveCodeDef] = useState<string>();
  const setActive = useCallback((defName?: string | null) => {
    setActiveCodeDef((prev) =>
      !defName ? undefined : prev === defName ? undefined : defName,
    );
  }, []);
  const activeCodeDefRef = useRef(activeCodeDef);

  activeCodeDefRef.current = activeCodeDef;
  const executionStates = useWorkflowExecutionState(selectedFlowId);

  // Clear YAML highlight whenever the YAML content changes.
  // activeCodeDef is read via ref to avoid re-firing when the highlight is first set.
  useEffect(() => {
    if (activeCodeDefRef.current) setActiveCodeDef(undefined);
  }, [yaml]);
  const focusNodeIds = useMemo(
    () =>
      typeof nodeIds === "string"
        ? nodeIds.split(",").filter(Boolean)
        : undefined,
    [nodeIds],
  );
  const isCurrentVersionPublished =
    Boolean(workflow?.currentVersion) &&
    workflow?.currentVersion === workflow?.publishedVersion;
  const hasPublishedVersion = Boolean(workflow?.publishedVersion);
  const isPublishDisabled =
    !definition ||
    !workflow?.currentVersion ||
    isDefinitionDirty ||
    isDefinitionSaving ||
    isCurrentVersionPublished;
  const isUnpublishDisabled = !hasPublishedVersion || isDefinitionSaving;
  const activeBindingKind =
    editingBindingTarget?.bindingKind ?? pendingBindingAdd?.bindingKind;
  const activeBindingLabel = useMemo(
    () => humanizeBindingKind(activeBindingKind ?? ""),
    [activeBindingKind],
  );
  const availableBindingDefs = useMemo(() => {
    if (!activeBindingKind) {
      return [];
    }

    return Object.entries(definition?.defs ?? {})
      .filter(([, defDefinition]) => defDefinition.kind === activeBindingKind)
      .map(([defName]) => defName)
      .sort();
  }, [activeBindingKind, definition?.defs]);
  const activeBindingSchema = activeBindingKind
    ? bindingsByName.get(activeBindingKind)?.schema
    : undefined;
  const disabledBindingDefs = useMemo(() => {
    if (!pendingBindingAdd || !definition) {
      return [];
    }

    return getDisabledBindingRefs({
      definition,
      ownerDefName: pendingBindingAdd.ownerDefName,
      bindingKind: pendingBindingAdd.bindingKind,
      bindingsByName,
    });
  }, [bindingsByName, definition, pendingBindingAdd]);
  const isBindingDrawerOpen = Boolean(
    activeBindingKind && (pendingBindingAdd || editingBindingTarget),
  );
  const handleInsert = useCallback(
    (insertType: EdgeInsertType = "step", insertPath?: FlowStepPath | null) => {
      setPendingBindingAdd(null);
      setEditingBindingTarget(null);
      setPendingActionCreateTarget(null);

      if (insertType === StepType.Conditional) {
        setPendingInsertPath(null);
        addConditionalStep(insertPath);

        return;
      }
      if (insertType === StepType.Loop) {
        setPendingInsertPath(null);
        addLoopStep(insertPath);

        return;
      }
      if (insertType === StepType.Parallel) {
        setPendingInsertPath(null);
        addParallelStep(insertPath);

        return;
      }
      if (insertType !== "step") {
        return;
      }

      setPendingToolBindingAdd(null);
      setPendingInsertPath(insertPath ?? null);
      setActionsDrawerOpen(true);
    },
    [addConditionalStep, addLoopStep, addParallelStep],
  );
  const handleRootInsert = useCallback(
    (insertType: EdgeInsertType = "step") => {
      workflowGraphRef.current?.requestCenterAfterFirstInsert();
      handleInsert(insertType, null);
    },
    [handleInsert],
  );
  const handleActionSelect = useCallback(
    (action: IAction) => {
      if (pendingToolBindingAdd) {
        if (!definition) {
          return;
        }

        const nextToolName = createUniqueBindingName(
          normalizeBindingName(action.name) || "tool",
          definition.defs,
        );
        const toolSettingsDefaults = (getSchemaDefaults<
          Record<string, JsonValue>
        >(action.settingSchema) ?? {}) as Record<string, unknown>;

        setToolDrawerTarget({
          mode: "create",
          ownerDefName: pendingToolBindingAdd.ownerDefName,
          bindingKind: TOOL_BINDING_KIND,
          actionName: action.name,
          initialBindingName: nextToolName,
          initialDescription: action.description?.trim() || undefined,
          initialSettings: toolSettingsDefaults,
        });
        setActionsDrawerOpen(false);
        setPendingInsertPath(null);
        setPendingToolBindingAdd(null);
        setPendingActionCreateTarget(null);
        setEditingBindingTarget(null);

        return;
      }

      const baseDefinition = definition ?? createBaseDefinition();
      const nextTaskName = createTaskName(
        action.name,
        baseDefinition.defs ?? {},
        taskDefinitions,
      );

      setPendingActionCreateTarget({
        action,
        insertPath: pendingInsertPath ?? null,
        initialTaskName: nextTaskName,
        initialTaskDescription: action.description?.trim() || "",
      });
      setGraphSelection({
        nodeIds: [],
        nodes: [],
      });
      setActionsDrawerOpen(false);
      setPendingInsertPath(null);
      setPendingToolBindingAdd(null);
      setPendingBindingAdd(null);
      setEditingBindingTarget(null);
    },
    [
      definition,
      pendingInsertPath,
      pendingToolBindingAdd,
      setGraphSelection,
      taskDefinitions,
    ],
  );

  useEffect(() => {
    if (!isEmptyWorkflow) {
      setActionsDrawerOpen(false);
    }
  }, [isEmptyWorkflow]);
  const handleSelectionChange = useCallback(
    (selection: WorkflowSelectionSnapshot) => {
      setGraphSelection(selection);
    },
    [setGraphSelection],
  );
  const handleRotate = useCallback(
    async (nextDirection: "horizontal" | "vertical") => {
      if (!selectedFlowId) {
        return false;
      }

      return new Promise<boolean>((resolve) => {
        updateWorkflow(
          {
            id: selectedFlowId,
            params: {
              direction: nextDirection,
            },
          },
          {
            onSuccess: () => {
              resolve(true);
            },
            onError: () => {
              resolve(false);
            },
          },
        );
      });
    },
    [selectedFlowId, updateWorkflow],
  );
  const translateGraph = useCallback(
    (key: string, options?: Record<string, unknown>) => {
      return t(
        key as Parameters<typeof t>[0],
        options as Parameters<typeof t>[1],
      );
    },
    [t],
  );
  const handleNewWorkflow = () => {
    const baseDefinition = createBaseDefinition();
    const baseYaml = WorkflowHelper.stringifyDefinition(baseDefinition);

    dialogs.open(
      WorkflowFormDialog,
      {
        defaultValues: null,
        presetValues: {
          definition: baseDefinition,
          definitionYaml: baseYaml,
          onCreated: (createdWorkflow) => {
            updateWorkflowURL(createdWorkflow.id);
            void refetchUser();
          },
        },
      },
      { maxWidth: "lg" },
    );
  };
  const handleEditWorkflow = (workflowToEdit: WorkflowEntity) => {
    dialogs.open(
      WorkflowFormDialog,
      {
        defaultValues: workflowToEdit,
      },
      { maxWidth: "lg" },
    );
  };
  const handleOpenMenu = (
    event: ReactMouseEvent<HTMLElement>,
    flowId: string,
  ) => {
    setMenuAnchorEl(event.currentTarget);
    setMenuFlowId(flowId);
  };
  const handleCloseMenu = () => {
    setMenuAnchorEl(null);
    setMenuFlowId(null);
  };
  const selectedMenuWorkflow = menuFlowId
    ? (workflows?.find((flow) => flow.id === menuFlowId) ??
      (workflow?.id === menuFlowId ? workflow : undefined))
    : workflow;
  const exportDisabled =
    !selectedMenuWorkflow ||
    isExportingWorkflow ||
    isDefinitionSaving ||
    (selectedMenuWorkflow.id === selectedFlowId && isDefinitionDirty);
  const handleExport = () => {
    if (!selectedMenuWorkflow || exportDisabled) {
      handleCloseMenu();

      return;
    }

    exportWorkflow(selectedMenuWorkflow.id);
    handleCloseMenu();
  };
  const handleDelete = async () => {
    if (!selectedMenuWorkflow) {
      handleCloseMenu();

      return;
    }

    const flowId = selectedMenuWorkflow.id;
    const fallbackFlowId = workflows?.find((flow) => flow.id !== flowId)?.id;

    handleCloseMenu();
    const isConfirmed = await dialogs.confirm(ConfirmDialogBody);

    if (!isConfirmed) {
      return;
    }

    deleteWorkflow(flowId, {
      onSuccess: () => {
        void refetchUser();
        if (selectedFlowId === flowId && fallbackFlowId) {
          updateWorkflowURL(fallbackFlowId);
        }
      },
    });
  };
  const handleSaveWorkflowSettings = useCallback(
    (settings: Settings) => {
      if (!definition) {
        return;
      }

      updateDefinitionState({
        ...definition,
        defaults: {
          ...(definition.defaults ?? {}),
          settings,
        },
      });
    },
    [definition, updateDefinitionState],
  );
  const handleOpenSettingsDialog = useCallback(() => {
    if (!definition) {
      return;
    }

    dialogs.open(
      WorkflowSettingsDialog,
      {
        defaultValues: definition.defaults?.settings,
        presetValues: {
          onSave: handleSaveWorkflowSettings,
          saveDisabled: isDefinitionSaving,
        },
      },
      { maxWidth: "sm" },
    );
  }, [definition, dialogs, handleSaveWorkflowSettings, isDefinitionSaving]);
  const handleAddBinding = useCallback(
    ({ ownerDefName, bindingKind, ...payload }: WorkflowBindingAddPayload) => {
      if (!definition || !definition.defs[ownerDefName]) {
        return;
      }

      if (bindingKind === TOOL_BINDING_KIND) {
        setPendingInsertPath(null);
        setPendingBindingAdd(null);
        setEditingBindingTarget(null);
        setPendingToolBindingAdd({
          ...payload,
          ownerDefName,
          bindingKind,
        });
        setActionsDrawerOpen(true);

        return;
      }

      const bindingDefinition = bindingsByName.get(bindingKind);

      if (!bindingDefinition) {
        return;
      }

      if (!isNonToolBindingKind(bindingKind, bindingsByName)) {
        return;
      }

      setPendingInsertPath(null);
      setPendingToolBindingAdd(null);
      setEditingBindingTarget(null);
      setPendingBindingAdd({
        ...payload,
        ownerDefName,
        bindingKind,
      });
    },
    [bindingsByName, definition],
  );
  const handleSelectBinding = useCallback(
    (bindingName: string) => {
      if (!pendingBindingAdd || !definition) {
        return;
      }

      const { ownerDefName, bindingKind } = pendingBindingAdd;
      const ownerDefinition = definition.defs[ownerDefName];

      if (!ownerDefinition) {
        return;
      }

      const bindingDefinition = bindingsByName.get(bindingKind);

      if (!bindingDefinition) {
        return;
      }

      const multiple = bindingDefinition.multiple ?? true;
      const nextOwnerDefinition = mountDefBindingRef(
        ownerDefinition,
        bindingKind,
        bindingName,
        multiple,
      );

      if (nextOwnerDefinition === ownerDefinition) {
        setPendingBindingAdd(null);

        return;
      }

      const nextDefinition = {
        ...definition,
        defs: {
          ...definition.defs,
          [ownerDefName]: nextOwnerDefinition,
        },
      };

      updateDefinitionState(nextDefinition);
      setPendingBindingAdd(null);
      setEditingBindingTarget(null);
    },
    [bindingsByName, definition, pendingBindingAdd, updateDefinitionState],
  );
  const handleCreateBindingDefinition = useCallback(
    (
      bindingName: string,
      bindingDefinitionPayload: Record<string, unknown>,
      description?: string,
    ) => {
      if (!pendingBindingAdd || !definition) {
        return;
      }

      if (
        Object.prototype.hasOwnProperty.call(definition.defs ?? {}, bindingName)
      ) {
        return;
      }

      const { ownerDefName, bindingKind } = pendingBindingAdd;
      const ownerDefinition = definition.defs[ownerDefName];

      if (!ownerDefinition) {
        return;
      }

      const bindingDefinition = bindingsByName.get(bindingKind);

      if (!bindingDefinition) {
        return;
      }

      const multiple = bindingDefinition.multiple ?? true;
      const nextOwnerDefinition = mountDefBindingRef(
        ownerDefinition,
        bindingKind,
        bindingName,
        multiple,
      );

      if (nextOwnerDefinition === ownerDefinition) {
        setPendingBindingAdd(null);

        return;
      }
      const normalizedDescription = description?.trim() ?? "";
      const nextDefinition = {
        ...definition,
        defs: {
          ...(definition.defs ?? {}),
          [ownerDefName]: nextOwnerDefinition,
          [bindingName]: {
            kind: bindingKind,
            settings: bindingDefinitionPayload,
            ...(normalizedDescription
              ? { description: normalizedDescription }
              : {}),
          },
        },
      };

      updateDefinitionState(nextDefinition);
      setPendingBindingAdd(null);
      setEditingBindingTarget(null);
    },
    [bindingsByName, definition, pendingBindingAdd, updateDefinitionState],
  );
  const handleUpdateBindingDefinition = useCallback(
    (
      currentBindingName: string,
      nextBindingName: string,
      bindingDefinitionPayload: Record<string, unknown>,
      description?: string,
    ) => {
      if (!definition || !editingBindingTarget) {
        return;
      }

      const { bindingKind } = editingBindingTarget;
      const currentDefs = definition.defs ?? {};
      const currentDef = currentDefs[currentBindingName];

      if (!currentDef || currentDef.kind !== bindingKind) {
        return;
      }

      if (
        currentBindingName !== nextBindingName &&
        Object.prototype.hasOwnProperty.call(currentDefs, nextBindingName)
      ) {
        return;
      }

      const normalizedDescription = description?.trim() ?? "";
      const nextDefs = { ...currentDefs };

      if (currentBindingName !== nextBindingName) {
        delete nextDefs[currentBindingName];
      }

      const updatedDefinition = {
        ...currentDef,
        kind: bindingKind,
        settings: bindingDefinitionPayload,
        ...(normalizedDescription
          ? { description: normalizedDescription }
          : {}),
      };

      if (!normalizedDescription) {
        delete updatedDefinition.description;
      }

      nextDefs[nextBindingName] = updatedDefinition;

      const bindingDefinition = bindingsByName.get(bindingKind);
      const multiple = bindingDefinition?.multiple ?? true;
      const nextDefsWithRenamedRefs =
        currentBindingName !== nextBindingName
          ? (Object.fromEntries(
              Object.entries(nextDefs).map(([defName, defDefinition]) => {
                const refs = toBindingRefs(
                  defDefinition.bindings?.[bindingKind],
                  multiple,
                );

                if (!refs.includes(currentBindingName)) {
                  return [defName, defDefinition];
                }

                const replacedRefs = refs.map((refName) =>
                  refName === currentBindingName ? nextBindingName : refName,
                );
                const dedupedRefs = Array.from(new Set(replacedRefs));

                return [
                  defName,
                  setDefBindingRefs(
                    defDefinition,
                    bindingKind,
                    dedupedRefs,
                    multiple,
                  ),
                ];
              }),
            ) as typeof definition.defs)
          : nextDefs;

      updateDefinitionState({
        ...definition,
        defs: nextDefsWithRenamedRefs,
      });
      setEditingBindingTarget(null);
      setPendingBindingAdd(null);
    },
    [bindingsByName, definition, editingBindingTarget, updateDefinitionState],
  );
  const handleCloseBindingDrawer = useCallback(() => {
    setPendingBindingAdd(null);
    setEditingBindingTarget(null);
  }, []);
  const handleGraphNodeClick = useCallback<NodeMouseHandler<Node>>(
    (_event, node) => {
      if (
        node.type !== ENodeType.BINDING_MULTI &&
        node.type !== ENodeType.BINDING_SINGLE
      ) {
        return;
      }

      const nodeData =
        node.data && typeof node.data === "object"
          ? (node.data as Record<string, unknown>)
          : undefined;
      const bindingKind = nodeData?.bindingKind;
      const bindingName = nodeData?.bindingName;
      const ownerDefName = nodeData?.ownerDefName;

      if (node.type === ENodeType.BINDING_MULTI) {
        if (bindingKind === TOOL_BINDING_KIND) {
          if (
            typeof bindingName !== "string" ||
            typeof ownerDefName !== "string"
          ) {
            return;
          }

          setToolDrawerTarget({
            mode: "edit",
            ownerDefName,
            bindingKind: TOOL_BINDING_KIND,
            bindingName,
          });
          setEditingBindingTarget(null);

          return;
        }
      }

      if (typeof bindingKind !== "string" || typeof bindingName !== "string") {
        return;
      }

      const resolvedBindingKind =
        definition?.defs?.[bindingName]?.kind ?? bindingKind;

      if (!isNonToolBindingKind(resolvedBindingKind, bindingsByName)) {
        return;
      }

      setPendingBindingAdd(null);
      setPendingToolBindingAdd(null);
      setToolDrawerTarget(null);
      setEditingBindingTarget({
        bindingKind: resolvedBindingKind,
        bindingName,
      });
    },
    [bindingsByName, definition?.defs],
  );
  const handleRemoveBinding = useCallback(
    ({
      ownerDefName,
      bindingKind,
      bindingName,
    }: WorkflowBindingRemovePayload) => {
      if (!definition || !definition.defs[ownerDefName]) {
        return;
      }

      const ownerDefinition = definition.defs[ownerDefName];
      const bindingDefinition = bindingsByName.get(bindingKind);

      if (!bindingDefinition) {
        return;
      }

      const multiple = bindingDefinition.multiple ?? true;
      const currentRefs = toBindingRefs(
        ownerDefinition.bindings?.[bindingKind],
        multiple,
      );

      if (!currentRefs.includes(bindingName)) {
        return;
      }

      const nextOwnerDefinition = unmountDefBindingRef(
        ownerDefinition,
        bindingKind,
        bindingName,
        multiple,
      );
      const nextDefinition = {
        ...definition,
        defs: {
          ...definition.defs,
          [ownerDefName]: nextOwnerDefinition,
        },
      };

      updateDefinitionState(nextDefinition);
    },
    [bindingsByName, definition, updateDefinitionState],
  );
  const workflowGraphModel = useMemo(
    () => ({
      definition,
      compiledFlow: flow,
      actionCatalog: actionsByName,
      bindingCatalog: bindingsByName,
      executionStates,
      layoutDirection: direction,
      activeCodeDefName: activeCodeDef,
    }),
    [
      actionsByName,
      bindingsByName,
      definition,
      direction,
      executionStates,
      flow,
      activeCodeDef,
    ],
  );
  const workflowGraphSelection = useMemo(
    () => ({
      selectedNodeIds,
      focusNodeIds,
      onChange: handleSelectionChange,
    }),
    [focusNodeIds, handleSelectionChange, selectedNodeIds],
  );
  const workflowGraphInsertion = useMemo(
    () => ({
      onInsertAtPath: handleInsert,
      onInsertAtRoot: handleRootInsert,
    }),
    [handleInsert, handleRootInsert],
  );
  const workflowGraphViewportValue = useMemo(
    () => ({
      id: workflow?.id,
      x: workflow?.x,
      y: workflow?.y,
      zoom: workflow?.zoom,
    }),
    [workflow?.id, workflow?.x, workflow?.y, workflow?.zoom],
  );
  const workflowGraphViewport = useMemo(
    () => ({
      value: workflowGraphViewportValue,
      onChange: debouncedWorkflowUpdate,
    }),
    [debouncedWorkflowUpdate, workflowGraphViewportValue],
  );
  const workflowGraphCallbacks = useMemo(
    () => ({
      onRemoveStep: removeStepAtPath,
      onAddBinding: handleAddBinding,
      onRemoveBinding: handleRemoveBinding,
      onNodeClick: handleGraphNodeClick,
      onRotate: handleRotate,
      onViewNodeCode: setActive,
    }),
    [
      handleAddBinding,
      handleGraphNodeClick,
      handleRemoveBinding,
      handleRotate,
      removeStepAtPath,
      setActive,
    ],
  );

  return (
    <div className="visual-editor-v4">
      <FlowsDrawer
        onNew={handleNewWorkflow}
        onEdit={handleEditWorkflow}
        activeCodeDef={activeCodeDef}
        onActiveDefChange={setActive}
      />
      <StyledBox>
        <WorkflowGraph
          ref={workflowGraphRef}
          colorMode={graphColorMode}
          t={translateGraph}
          model={workflowGraphModel}
          selection={workflowGraphSelection}
          insertion={workflowGraphInsertion}
          viewport={workflowGraphViewport}
          callbacks={workflowGraphCallbacks}
        />
        {workflow && (
          <WorkflowTitleOverlay>
            <WorkflowTitleBar
              workflow={workflow}
              onEdit={handleEditWorkflow}
              onOpenMenu={handleOpenMenu}
              onSave={persistDefinition}
              saveDisabled={!definition || !isDefinitionDirty}
              saveLoading={isDefinitionSaving}
              saveLabel={t("button.save")}
              onOpenSettings={handleOpenSettingsDialog}
              settingsLabel={t(
                "visual_editor.workflow_title_bar.settings.open",
              )}
              settingsDisabled={!definition || isDefinitionSaving}
              renameLabel={t("button.rename")}
              moreLabel={t("button.more")}
            />
          </WorkflowTitleOverlay>
        )}
        {workflow && (
          <WorkflowPublishOverlay>
            <Stack direction="row" spacing={1}>
              {hasPublishedVersion && (
                <Button
                  variant="outlined"
                  size="large"
                  color="warning"
                  aria-label={unpublishLabel}
                  startIcon={<CloudOff />}
                  onClick={unpublishVersion}
                  disabled={isUnpublishDisabled}
                >
                  {unpublishLabel}
                </Button>
              )}
              <Button
                variant="contained"
                size="large"
                color="primary"
                aria-label={publishLabel}
                startIcon={<CloudUpload />}
                onClick={() => {
                  publishVersion();
                }}
                disabled={isPublishDisabled}
              >
                {publishLabel}
              </Button>
            </Stack>
          </WorkflowPublishOverlay>
        )}
        <ActionListDrawer
          actions={actions}
          drawerId={actionsDrawerId}
          open={actionsDrawerOpen}
          onActionSelect={handleActionSelect}
          onClose={() => {
            setActionsDrawerOpen(false);
            setPendingInsertPath(null);
            setPendingToolBindingAdd(null);
            setPendingBindingAdd(null);
            setEditingBindingTarget(null);
            workflowGraphRef.current?.clearCenterAfterFirstInsert();
          }}
        />
        <WorkflowBottomDrawer />
      </StyledBox>
      <BindingSelectionDrawer
        drawerId="workflow-single-bindings-drawer"
        open={isBindingDrawerOpen}
        availableBindings={availableBindingDefs}
        disabledBindings={disabledBindingDefs}
        bindingKind={activeBindingKind ?? ""}
        bindingLabel={activeBindingLabel}
        defs={definition?.defs}
        bindingSchema={activeBindingSchema}
        editingBindingName={editingBindingTarget?.bindingName}
        isSaving={isDefinitionSaving}
        onSelectBinding={handleSelectBinding}
        onCreateBindingDefinition={handleCreateBindingDefinition}
        onUpdateBindingDefinition={handleUpdateBindingDefinition}
        onClose={handleCloseBindingDrawer}
      />
      <ToolFormDrawer
        target={toolDrawerTarget}
        onClose={() => {
          setToolDrawerTarget(null);
        }}
      />
      <ActionFormDrawer
        target={pendingActionCreateTarget}
        onClose={(reason) => {
          const isCreateFlow = Boolean(pendingActionCreateTarget);

          setPendingActionCreateTarget(null);
          if (reason === "cancel" && isCreateFlow) {
            workflowGraphRef.current?.clearCenterAfterFirstInsert();
          }
        }}
      />
      <ConditionalFormDrawer />
      <LoopFormDrawer />
      <ParallelFormDrawer />
      <WorkflowMenu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleCloseMenu}
        deleteDisabled={Boolean(workflow?.builtin)}
        onDelete={handleDelete}
        deleteLabel={t("button.delete")}
        onExport={handleExport}
        exportDisabled={exportDisabled}
        exportLabel={exportLabel}
      />
    </div>
  );
};

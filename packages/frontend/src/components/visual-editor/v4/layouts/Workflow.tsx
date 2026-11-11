/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  Workflow as WorkflowHelper,
  type CompiledStep,
  type JsonValue,
  type Settings,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";
import {
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSchemaDefaults } from "@/app-components/inputs/JsonSchemaForm";
import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useWorkflowBindingsCatalog } from "@/contexts/workflow-bindings.context";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useAuth } from "@/hooks/useAuth";
import { useDialogs } from "@/hooks/useDialogs";
import { useTranslate } from "@/hooks/useTranslate";
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
import { useWorkflowMenu } from "../hooks/useWorkflowMenu";
import {
  unmountBindingMutation,
  updateBindingDefinitionMutation,
} from "../utils/binding-definitions.utils";
import { humanizeBindingKind } from "../utils/binding-kind.utils";
import {
  createUniqueDefinitionName,
  isDefinitionNameAvailable,
} from "../utils/definition-name.utils";
import { mountDefBindingRef } from "../utils/task-bindings.utils";
import { TOOL_BINDING_KIND } from "../utils/tool-bindings.utils";
import {
  getBindingNodeTarget,
  getDisabledBindingRefs,
  isNonToolBindingKind,
} from "../utils/workflow-binding-routing.utils";
import {
  createBaseDefinition,
  extractDefinitionNamesByKind,
} from "../utils/workflow-definition.utils";
import { uniqueIssueLocations } from "../utils/workflow-issue-locations";
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
    flow,
    definitionStatus,
    definitionIssues,
    isDefinitionDirty,
    isSaving: isDefinitionSaving,
    removeStepAtPath,
    setGraphSelection,
    updateDefinitionState,
    persistDefinition,
    undo,
    redo,
    canUndo,
    canRedo,
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
  // Bumped whenever the graph asks the drawer to open the YAML editor (error
  // panel CTA or a per-error line link). `nonce` changes every request so
  // repeat clicks re-fire; `line` (when set) is revealed in the editor.
  const [yamlOpenRequest, setYamlOpenRequest] = useState<{
    nonce: number;
    line?: number;
  }>({ nonce: 0 });
  const handleOpenYamlEditor = useCallback((line?: number) => {
    setYamlOpenRequest((prev) => ({ nonce: prev.nonce + 1, line }));
  }, []);
  const actionsDrawerId = "workflow-actions-drawer";
  const publishLabel = t("button.publish");
  const unpublishLabel = t("button.unpublish");
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

    return extractDefinitionNamesByKind(
      definition?.defs ?? {},
      activeBindingKind,
    ).sort();
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

        const nextToolName = createUniqueDefinitionName(
          action.name,
          definition.defs,
          "tool",
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
      const nextTaskName = createUniqueDefinitionName(
        action.name,
        baseDefinition.defs ?? {},
        "new_task",
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
    [definition, pendingInsertPath, pendingToolBindingAdd, setGraphSelection],
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
  const { openMenu, menuProps } = useWorkflowMenu((menuFlowId) =>
    menuFlowId
      ? (workflows?.find((flow) => flow.id === menuFlowId) ??
        (workflow?.id === menuFlowId ? workflow : undefined))
      : workflow,
  );
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
  // Mounts `bindingName` on the owner of the pending binding add; `undefined`
  // when the owner definition or the binding kind cannot be resolved.
  const mountPendingBinding = useCallback(
    (bindingName: string) => {
      if (!pendingBindingAdd || !definition) {
        return undefined;
      }

      const { ownerDefName, bindingKind } = pendingBindingAdd;
      const ownerDefinition = definition.defs[ownerDefName];

      if (!ownerDefinition) {
        return undefined;
      }

      const bindingDefinition = bindingsByName.get(bindingKind);

      if (!bindingDefinition) {
        return undefined;
      }

      const multiple = bindingDefinition.multiple ?? true;

      return {
        ownerDefName,
        bindingKind,
        ownerDefinition,
        nextOwnerDefinition: mountDefBindingRef(
          ownerDefinition,
          bindingKind,
          bindingName,
          multiple,
        ),
      };
    },
    [bindingsByName, definition, pendingBindingAdd],
  );
  const handleSelectBinding = useCallback(
    (bindingName: string) => {
      const mounted = mountPendingBinding(bindingName);

      if (!definition || !mounted) {
        return;
      }

      const { ownerDefName, ownerDefinition, nextOwnerDefinition } = mounted;

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
    [definition, mountPendingBinding, updateDefinitionState],
  );
  const handleCreateBindingDefinition = useCallback(
    (
      bindingName: string,
      bindingDefinitionPayload: Record<string, unknown>,
      description?: string,
    ) => {
      if (
        !definition ||
        !isDefinitionNameAvailable(bindingName, definition.defs)
      ) {
        return;
      }

      const mounted = mountPendingBinding(bindingName);

      if (!mounted) {
        return;
      }

      const {
        ownerDefName,
        bindingKind,
        ownerDefinition,
        nextOwnerDefinition,
      } = mounted;

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
    [definition, mountPendingBinding, updateDefinitionState],
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
      const nextDefinition = updateBindingDefinitionMutation(definition, {
        bindingKind,
        currentBindingName,
        nextBindingName,
        settings: bindingDefinitionPayload,
        description,
        multiple: bindingsByName.get(bindingKind)?.multiple ?? true,
      });

      if (nextDefinition === definition) {
        return;
      }

      updateDefinitionState(nextDefinition);
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
      const target = getBindingNodeTarget(
        node,
        definition?.defs,
        bindingsByName,
      );

      if (target?.drawer === "tool") {
        setToolDrawerTarget({
          mode: "edit",
          ownerDefName: target.ownerDefName,
          bindingKind: TOOL_BINDING_KIND,
          bindingName: target.bindingName,
        });
        setEditingBindingTarget(null);
      } else if (target?.drawer === "binding") {
        setPendingBindingAdd(null);
        setPendingToolBindingAdd(null);
        setToolDrawerTarget(null);
        setEditingBindingTarget({
          bindingKind: target.bindingKind,
          bindingName: target.bindingName,
        });
      }
    },
    [bindingsByName, definition?.defs],
  );
  const handleRemoveBinding = useCallback(
    ({
      ownerDefName,
      bindingKind,
      bindingName,
    }: WorkflowBindingRemovePayload) => {
      const bindingDefinition = bindingsByName.get(bindingKind);

      if (!definition || !bindingDefinition) {
        return;
      }

      const nextDefinition = unmountBindingMutation(definition, {
        ownerDefName,
        bindingKind,
        bindingName,
        multiple: bindingDefinition.multiple ?? true,
      });

      if (nextDefinition !== definition) {
        updateDefinitionState(nextDefinition);
      }
    },
    [bindingsByName, definition, updateDefinitionState],
  );
  // Reasons the workflow cannot be rendered as a graph, shown in place of the
  // loading spinner. Undefined while loading so a slow catalog fetch keeps
  // the spinner instead of flashing spurious errors.
  const graphIssues = useMemo(
    () =>
      definitionStatus === "invalid"
        ? uniqueIssueLocations(yaml, definitionIssues)
        : undefined,
    [definitionIssues, definitionStatus, yaml],
  );
  // While the YAML is temporarily invalid (e.g. mid-edit), keep the last
  // successfully compiled graph rendered behind the error panel instead of
  // blanking the canvas. Keyed by workflow id so a workflow switch never
  // shows another workflow's graph.
  const lastGoodGraphRef = useRef<{
    workflowId?: string;
    definition?: WorkflowDefinition;
    flow?: CompiledStep[];
  }>({});

  useEffect(() => {
    if (definitionStatus === "ready") {
      lastGoodGraphRef.current = { workflowId: workflow?.id, definition, flow };
    } else if (definitionStatus === "empty") {
      lastGoodGraphRef.current = {};
    }
  }, [definition, definitionStatus, flow, workflow?.id]);

  const lastGoodGraph =
    definitionStatus === "invalid" &&
    lastGoodGraphRef.current.workflowId === workflow?.id
      ? lastGoodGraphRef.current
      : undefined;
  const graphDefinition = lastGoodGraph ? lastGoodGraph.definition : definition;
  const graphFlow = lastGoodGraph ? lastGoodGraph.flow : flow;
  const workflowGraphModel = useMemo(
    () => ({
      definition: graphDefinition,
      compiledFlow: graphFlow,
      actionCatalog: actionsByName,
      bindingCatalog: bindingsByName,
      executionStates,
      layoutDirection: direction,
      activeCodeDefName: activeCodeDef,
      issues: graphIssues,
    }),
    [
      actionsByName,
      bindingsByName,
      graphDefinition,
      direction,
      executionStates,
      graphFlow,
      activeCodeDef,
      graphIssues,
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
      onOpenYamlEditor: handleOpenYamlEditor,
    }),
    [
      handleAddBinding,
      handleGraphNodeClick,
      handleOpenYamlEditor,
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
        openYamlRequest={yamlOpenRequest}
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
              onOpenMenu={openMenu}
              onUndo={undo}
              onRedo={redo}
              undoDisabled={!canUndo}
              redoDisabled={!canRedo}
              undoLabel={t("button.undo")}
              redoLabel={t("button.redo")}
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
        onBack={
          pendingActionCreateTarget
            ? () => {
                const insertPath = pendingActionCreateTarget.insertPath;

                setPendingActionCreateTarget(null);
                setPendingInsertPath(insertPath);
                setActionsDrawerOpen(true);
              }
            : undefined
        }
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
      <WorkflowMenu {...menuProps} />
    </div>
  );
};

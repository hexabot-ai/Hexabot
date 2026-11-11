/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
} from "react";

import {
  EMPTY_WORKFLOW_VIEWPORT_KEY,
  WORKFLOW_VIEWPORT_MAX_ZOOM,
  WORKFLOW_VIEWPORT_MIN_ZOOM,
} from "../constants/workflow.constants";
import {
  WorkflowGraphHostContext,
  type WorkflowGraphHostContextValue,
} from "../contexts/workflow-graph-host.context";
import {
  WorkflowInsertMenuContext,
  type WorkflowInsertMenuContextValue,
} from "../contexts/workflow-insert-menu.context";
import { useFocusNode } from "../hooks/useFocusNode";
import { useInsertMenuBindings } from "../hooks/useInsertMenuBindings";
import { useResolvedColorMode } from "../hooks/useResolvedColorMode";
import { useWorkflowGraphLayout } from "../hooks/useWorkflowGraphLayout";
import { useWorkflowGraphMotion } from "../hooks/useWorkflowGraphMotion";
import { useWorkflowSelectionController } from "../hooks/useWorkflowSelectionController";
import { useWorkflowViewport } from "../hooks/useWorkflowViewport";
import "../styles/index.css";
import {
  isLargeWorkflowGraph,
  shouldShowWorkflowEdgeInsertControls,
} from "../utils/workflow-rendering.utils";
import { applyWorkflowExecutionStatesToNodes } from "../utils/workflow-runtime-node.utils";

import {
  areWorkflowGraphPropsEqual,
  type WorkflowGraphHandle,
  type WorkflowGraphIssue,
  type WorkflowGraphProps,
} from "./workflow-graph.props";
import { EDGE_TYPES, NODE_TYPES } from "./workflow-graph.registry";
import { WorkflowControls } from "./WorkflowControls";
import { WorkflowEmptyState } from "./WorkflowEmptyState";
import { WorkflowErrorState } from "./WorkflowErrorState";
import { WorkflowInsertContextMenu } from "./WorkflowInsertContextMenu";
import { WorkflowLoadingState } from "./WorkflowLoadingState";

// Compile issues block the canvas; otherwise a spinner shows until laid out.
const WorkflowGraphStatus = ({
  issues,
  isLoading,
}: {
  issues?: WorkflowGraphIssue[];
  isLoading: boolean;
}) => {
  if (issues?.length) {
    return <WorkflowErrorState issues={issues} />;
  }

  return isLoading ? <WorkflowLoadingState /> : null;
};
const WorkflowGraphCanvas = forwardRef<WorkflowGraphHandle, WorkflowGraphProps>(
  (
    {
      t,
      model,
      selection,
      insertion,
      viewport,
      callbacks,
      colorMode = "system",
      children,
    },
    ref,
  ) => {
    const resolvedColorMode = useResolvedColorMode(colorMode);
    const { graphData, isEmptyWorkflow, isLoading } = useWorkflowGraphLayout({
      compiledFlow: model.compiledFlow,
      defs: model.definition?.defs,
      layoutDirection: model.layoutDirection,
      actionCatalog: model.actionCatalog,
      bindingCatalog: model.bindingCatalog,
    });
    const runtimeNodes = useMemo(
      () =>
        applyWorkflowExecutionStatesToNodes(
          graphData.nodes,
          model.executionStates,
        ),
      [graphData.nodes, model.executionStates],
    );
    const {
      insertMenuAnchorEl,
      isInsertMenuOpen,
      openInsertMenu,
      closeInsertMenu,
      insertFromMenu,
    } = useInsertMenuBindings({
      onInsertAtPath: insertion?.onInsertAtPath,
    });
    const isLargeGraph = isLargeWorkflowGraph({
      nodeCount: graphData.nodes.length,
      edgeCount: graphData.edges.length,
    });
    const { onNodesChange, emitSelection } = useWorkflowSelectionController({
      isEmptyWorkflow,
      nodes: graphData.nodes,
      selectedNodeIds: selection.selectedNodeIds,
      onChange: selection.onChange,
    });
    const handleFocusedSelectionResolved = useCallback(
      (nodeIds: string[]) => {
        emitSelection(nodeIds);
      },
      [emitSelection],
    );
    const { animateFocus } = useFocusNode({
      focusNodeIds: selection.focusNodeIds,
      selectedNodeIds: selection.selectedNodeIds,
      onFocusNodeIdsResolved: handleFocusedSelectionResolved,
      onFocused: selection.onFocusComplete,
    });
    const {
      initialViewport,
      requestCenterAfterFirstInsert,
      clearCenterAfterFirstInsert,
    } = useWorkflowViewport({
      viewport: viewport.value,
      isEmptyWorkflow,
      graphNodes: graphData.nodes,
    });
    const motion = useWorkflowGraphMotion({
      initialViewport,
      onViewportChange: viewport.onChange,
    });
    const showEdgeInsertControls = shouldShowWorkflowEdgeInsertControls({
      isLargeGraph,
      isMoving: motion.isMoving,
      zoom: motion.zoom,
    });
    const hostContextValue = useMemo<WorkflowGraphHostContextValue>(
      () => ({
        translate: t,
        colorMode: resolvedColorMode,
        direction: model.layoutDirection,
        actionCatalog: model.actionCatalog,
        onRemoveStep: callbacks.onRemoveStep,
        onAddBinding: callbacks.onAddBinding,
        onRemoveBinding: callbacks.onRemoveBinding,
        onViewNodeCode: callbacks.onViewNodeCode,
        onOpenYamlEditor: callbacks.onOpenYamlEditor,
        activeCodeDefName: model.activeCodeDefName,
      }),
      [
        callbacks.onAddBinding,
        callbacks.onOpenYamlEditor,
        callbacks.onRemoveBinding,
        callbacks.onRemoveStep,
        callbacks.onViewNodeCode,
        model.activeCodeDefName,
        model.actionCatalog,
        model.layoutDirection,
        resolvedColorMode,
        t,
      ],
    );
    const insertMenuContextValue = useMemo<WorkflowInsertMenuContextValue>(
      () => ({
        onOpenInsertMenu: openInsertMenu,
        showEdgeInsertControls,
      }),
      [openInsertMenu, showEdgeInsertControls],
    );

    useImperativeHandle(
      ref,
      () => ({
        animateFocus,
        requestCenterAfterFirstInsert,
        clearCenterAfterFirstInsert,
      }),
      [
        animateFocus,
        clearCenterAfterFirstInsert,
        requestCenterAfterFirstInsert,
      ],
    );

    const graphClassName = `workflow-graph${
      isLargeGraph ? " workflow-graph--large" : ""
    }`;

    return (
      <WorkflowGraphHostContext.Provider value={hostContextValue}>
        <WorkflowInsertMenuContext.Provider value={insertMenuContextValue}>
          <ReactFlow
            className={graphClassName}
            edges={graphData.edges}
            nodes={runtimeNodes}
            defaultViewport={initialViewport}
            maxZoom={WORKFLOW_VIEWPORT_MAX_ZOOM}
            minZoom={WORKFLOW_VIEWPORT_MIN_ZOOM}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onMove={motion.onMove}
            onMoveStart={motion.onMoveStart}
            onMoveEnd={motion.onMoveEnd}
            onNodeClick={callbacks.onNodeClick}
            onlyRenderVisibleElements={isLargeGraph}
            colorMode={resolvedColorMode}
          >
            <WorkflowControls
              direction={model.layoutDirection}
              onFitView={() => {
                void animateFocus();
              }}
              onRotate={callbacks.onRotate}
            />
            <Background size={2} />

            {isEmptyWorkflow && insertion?.onInsertAtRoot ? (
              <WorkflowEmptyState onInsert={insertion.onInsertAtRoot} />
            ) : null}
            <WorkflowGraphStatus issues={model.issues} isLoading={isLoading} />
            {children}
            <WorkflowInsertContextMenu
              id="workflow-insert-menu"
              open={isInsertMenuOpen}
              anchorEl={insertMenuAnchorEl}
              onClose={closeInsertMenu}
              onInsert={insertFromMenu}
            />
          </ReactFlow>
        </WorkflowInsertMenuContext.Provider>
      </WorkflowGraphHostContext.Provider>
    );
  },
);

WorkflowGraphCanvas.displayName = "WorkflowGraphCanvas";

const WorkflowGraphRoot = forwardRef<WorkflowGraphHandle, WorkflowGraphProps>(
  (props, ref) => {
    const flowKey = props.viewport.value?.id ?? EMPTY_WORKFLOW_VIEWPORT_KEY;

    return (
      <ReactFlowProvider key={flowKey}>
        <WorkflowGraphCanvas {...props} ref={ref} />
      </ReactFlowProvider>
    );
  },
);

WorkflowGraphRoot.displayName = "WorkflowGraphRoot";

export const WorkflowGraph = memo(
  WorkflowGraphRoot,
  areWorkflowGraphPropsEqual,
);

WorkflowGraph.displayName = "WorkflowGraph";

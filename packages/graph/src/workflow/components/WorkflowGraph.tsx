/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Background,
  type OnMove,
  ReactFlow,
  ReactFlowProvider,
  type Viewport,
} from "@xyflow/react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
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
import { useWorkflowGraphLayout } from "../hooks/useWorkflowGraphLayout";
import { useWorkflowSelectionController } from "../hooks/useWorkflowSelectionController";
import { useWorkflowViewport } from "../hooks/useWorkflowViewport";
import "../styles/index.css";
import { isSameViewport } from "../utils/workflow-graph.utils";
import {
  isLargeWorkflowGraph,
  shouldShowWorkflowEdgeInsertControls,
} from "../utils/workflow-rendering.utils";
import { applyWorkflowExecutionStatesToNodes } from "../utils/workflow-runtime-node.utils";

import {
  areWorkflowGraphPropsEqual,
  type WorkflowGraphColorMode,
  type WorkflowGraphHandle,
  type WorkflowGraphProps,
} from "./workflow-graph.props";
import { EDGE_TYPES, NODE_TYPES } from "./workflow-graph.registry";
import { WorkflowControls } from "./WorkflowControls";
import { WorkflowEmptyState } from "./WorkflowEmptyState";
import { WorkflowErrorState } from "./WorkflowErrorState";
import { WorkflowInsertContextMenu } from "./WorkflowInsertContextMenu";
import { WorkflowLoadingState } from "./WorkflowLoadingState";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
const resolveSystemColorMode = (): "light" | "dark" => {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }

  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
};
const resolveColorMode = (mode: WorkflowGraphColorMode): "light" | "dark" => {
  if (mode === "system") {
    return resolveSystemColorMode();
  }

  return mode;
};
// Resolves "system" against the OS preference and tracks its changes.
const useResolvedColorMode = (
  mode: WorkflowGraphColorMode,
): "light" | "dark" => {
  const [resolved, setResolved] = useState(() => resolveColorMode(mode));

  useEffect(() => {
    if (
      mode !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      setResolved(resolveColorMode(mode));

      return;
    }

    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const handleChange = () => {
      setResolved(media.matches ? "dark" : "light");
    };

    handleChange();
    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, [mode]);

  return resolved;
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
    const [isGraphMoving, setIsGraphMoving] = useState(false);
    const [currentZoom, setCurrentZoom] = useState(1);
    const lastViewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
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
    const showEdgeInsertControls = shouldShowWorkflowEdgeInsertControls({
      isLargeGraph,
      isMoving: isGraphMoving,
      zoom: currentZoom,
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

    useEffect(() => {
      lastViewportRef.current = initialViewport;
      setCurrentZoom(initialViewport.zoom);
    }, [initialViewport.x, initialViewport.y, initialViewport.zoom]);

    const handleMoveStart = useCallback<OnMove>((_event, nextViewport) => {
      setIsGraphMoving(true);
      setCurrentZoom(nextViewport.zoom);
    }, []);
    const handleMove = useCallback<OnMove>((_event, nextViewport) => {
      setCurrentZoom((zoom) =>
        Math.abs(zoom - nextViewport.zoom) <= 0.01 ? zoom : nextViewport.zoom,
      );
    }, []);
    const handleMoveEnd = useCallback(
      (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
        setIsGraphMoving(false);
        setCurrentZoom(nextViewport.zoom);

        if (isSameViewport(lastViewportRef.current, nextViewport)) {
          return;
        }

        lastViewportRef.current = nextViewport;
        viewport.onChange(nextViewport);
      },
      [viewport],
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
            onMove={handleMove}
            onMoveStart={handleMoveStart}
            onMoveEnd={handleMoveEnd}
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
            {model.issues?.length ? (
              <WorkflowErrorState issues={model.issues} />
            ) : isLoading ? (
              <WorkflowLoadingState />
            ) : null}
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
    const flowKey = props.viewport.value?.id ?? "__workflow-empty__";

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

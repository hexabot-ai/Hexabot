/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { CompiledStep, WorkflowDefinition } from "@hexabot-ai/agentic";
import {
  Background,
  type Node,
  type NodeMouseHandler,
  type OnMove,
  ReactFlow,
  ReactFlowProvider,
  type Viewport,
} from "@xyflow/react";
import type { ResizeControlDirection } from "@xyflow/system";
import {
  forwardRef,
  memo,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import "@xyflow/react/dist/style.css";

import {
  WORKFLOW_VIEWPORT_MAX_ZOOM,
  WORKFLOW_VIEWPORT_MIN_ZOOM,
} from "../constants/workflow.constants";
import type {
  WorkflowGraphHostContextValue,
  WorkflowGraphTranslate,
} from "../contexts/workflow-graph-host.context";
import { WorkflowGraphHostContext } from "../contexts/workflow-graph-host.context";
import {
  WorkflowInsertMenuContext,
  type WorkflowInsertMenuContextValue,
} from "../contexts/workflow-insert-menu.context";
import { useFocusNode } from "../hooks/useFocusNode";
import { useInsertMenuBindings } from "../hooks/useInsertMenuBindings";
import { useWorkflowGraphLayout } from "../hooks/useWorkflowGraphLayout";
import { useWorkflowSelectionController } from "../hooks/useWorkflowSelectionController";
import {
  useWorkflowViewport,
  type ViewportState,
} from "../hooks/useWorkflowViewport";
import "../styles/index.css";
import {
  EDGE_TYPES,
  NODE_TYPES,
  type WorkflowAction,
  type WorkflowBindingAddPayload,
  type WorkflowBindingCatalog,
  type WorkflowBindingRemovePayload,
  type WorkflowExecutionStateMap,
} from "../types/workflow-node.types";
import type {
  EdgeInsertType,
  FlowStepPath,
} from "../types/workflow-path.types";
import type { WorkflowSelectionSnapshot } from "../types/workflow-selection.types";
import { isSameViewport } from "../utils/workflow-graph.utils";
import {
  isLargeWorkflowGraph,
  shouldShowWorkflowEdgeInsertControls,
} from "../utils/workflow-rendering.utils";
import { applyWorkflowExecutionStatesToNodes } from "../utils/workflow-runtime-node.utils";

import { WorkflowControls } from "./WorkflowControls";
import { WorkflowEmptyState } from "./WorkflowEmptyState";
import { WorkflowInsertContextMenu } from "./WorkflowInsertContextMenu";

export type WorkflowGraphModel = {
  definition?: WorkflowDefinition;
  compiledFlow?: CompiledStep[];
  actionCatalog: ReadonlyMap<string, WorkflowAction>;
  bindingCatalog: WorkflowBindingCatalog;
  executionStates: WorkflowExecutionStateMap;
  layoutDirection?: ResizeControlDirection;
};

export type WorkflowGraphSelection = {
  selectedNodeIds: string[];
  focusNodeIds?: string[];
  onChange?: (selection: WorkflowSelectionSnapshot) => void;
  onFocusComplete?: () => void;
};

export type WorkflowGraphInsertion = {
  onInsertAtPath?: (insertType: EdgeInsertType, path: FlowStepPath) => void;
  onInsertAtRoot?: (insertType: EdgeInsertType) => void;
};

export type WorkflowGraphViewport = {
  value?: ViewportState | null;
  onChange: ({ zoom, x, y }: Viewport) => void;
};

export type WorkflowGraphCallbacks = {
  onNodeClick?: NodeMouseHandler<Node>;
  onRemoveStep: (stepPath: FlowStepPath, nodeId?: string) => void;
  onAddBinding?: (payload: WorkflowBindingAddPayload) => void;
  onRemoveBinding?: (payload: WorkflowBindingRemovePayload) => void;
  onRotate: (nextDirection: "horizontal" | "vertical") => Promise<boolean>;
  onViewNodeCode?: (defName: string) => void;
  activeCodeDefName?: string;
};

export type WorkflowGraphColorMode = "light" | "dark" | "system";

export type WorkflowGraphProps = PropsWithChildren<{
  t: WorkflowGraphTranslate;
  model: WorkflowGraphModel;
  selection: WorkflowGraphSelection;
  insertion?: WorkflowGraphInsertion;
  viewport: WorkflowGraphViewport;
  callbacks: WorkflowGraphCallbacks;
  colorMode?: WorkflowGraphColorMode;
}>;

export type WorkflowGraphHandle = {
  animateFocus: (nodeIds?: string[]) => Promise<void>;
  requestCenterAfterFirstInsert: () => void;
  clearCenterAfterFirstInsert: () => void;
};

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
const areStringArraysEqual = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};
const isSameViewportState = (
  left: ViewportState | null | undefined,
  right: ViewportState | null | undefined,
): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.id === right.id &&
    left.x === right.x &&
    left.y === right.y &&
    left.zoom === right.zoom
  );
};
const areWorkflowGraphPropsEqual = (
  previous: WorkflowGraphProps,
  next: WorkflowGraphProps,
): boolean =>
  previous.children === next.children &&
  previous.colorMode === next.colorMode &&
  previous.t === next.t &&
  previous.model.definition?.defs === next.model.definition?.defs &&
  previous.model.compiledFlow === next.model.compiledFlow &&
  previous.model.actionCatalog === next.model.actionCatalog &&
  previous.model.bindingCatalog === next.model.bindingCatalog &&
  previous.model.executionStates === next.model.executionStates &&
  previous.model.layoutDirection === next.model.layoutDirection &&
  areStringArraysEqual(
    previous.selection.selectedNodeIds,
    next.selection.selectedNodeIds,
  ) &&
  areStringArraysEqual(
    previous.selection.focusNodeIds,
    next.selection.focusNodeIds,
  ) &&
  previous.selection.onChange === next.selection.onChange &&
  previous.selection.onFocusComplete === next.selection.onFocusComplete &&
  previous.insertion?.onInsertAtPath === next.insertion?.onInsertAtPath &&
  previous.insertion?.onInsertAtRoot === next.insertion?.onInsertAtRoot &&
  isSameViewportState(previous.viewport.value, next.viewport.value) &&
  previous.viewport.onChange === next.viewport.onChange &&
  previous.callbacks.onNodeClick === next.callbacks.onNodeClick &&
  previous.callbacks.onRemoveStep === next.callbacks.onRemoveStep &&
  previous.callbacks.onAddBinding === next.callbacks.onAddBinding &&
  previous.callbacks.onRemoveBinding === next.callbacks.onRemoveBinding &&
  previous.callbacks.onRotate === next.callbacks.onRotate &&
  previous.callbacks.onViewNodeCode === next.callbacks.onViewNodeCode &&
  previous.callbacks.activeCodeDefName === next.callbacks.activeCodeDefName;
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
    const [resolvedColorMode, setResolvedColorMode] = useState<
      "light" | "dark"
    >(() => resolveColorMode(colorMode));
    const [isGraphMoving, setIsGraphMoving] = useState(false);
    const [currentZoom, setCurrentZoom] = useState(1);
    const lastViewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
    const { graphData, isEmptyWorkflow } = useWorkflowGraphLayout({
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
        activeCodeDefName: callbacks.activeCodeDefName,
      }),
      [
        callbacks.onAddBinding,
        callbacks.onRemoveBinding,
        callbacks.onRemoveStep,
        callbacks.onViewNodeCode,
        callbacks.activeCodeDefName,
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

    useEffect(() => {
      if (colorMode !== "system") {
        setResolvedColorMode(colorMode);

        return;
      }

      if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
      ) {
        setResolvedColorMode("light");

        return;
      }

      const media = window.matchMedia(SYSTEM_DARK_QUERY);
      const handleChange = () => {
        setResolvedColorMode(media.matches ? "dark" : "light");
      };

      handleChange();
      media.addEventListener("change", handleChange);

      return () => {
        media.removeEventListener("change", handleChange);
      };
    }, [colorMode]);

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

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  useStore,
  type Node,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  DEFAULT_WORKFLOW_VIEWPORT,
  WORKFLOW_VIEWPORT_FIT_PADDING,
  WORKFLOW_VIEWPORT_FOCUS_DURATION,
  WORKFLOW_VIEWPORT_MIN_ZOOM,
} from "../constants/workflow.constants";
import { ENodeType } from "../types/workflow-node.types";
import {
  isMeaningfulWorkflowViewport,
  normalizeWorkflowViewportZoom,
} from "../utils/workflow-graph.utils";

const EMPTY_WORKFLOW_SYNC_KEY = "__workflow-empty__";
/** IDs of semantic workflow step nodes (TASK / OPERATOR) in graph order. */
const getStepNodeIds = (nodes: Node[]): string[] =>
  nodes
    .filter((n) => n.type === ENodeType.TASK || n.type === ENodeType.OPERATOR)
    .map((n) => n.id);
const parseViewportNumber = (
  value: number | string | null | undefined,
): number =>
  value === null || value === undefined || value === ""
    ? Number.NaN
    : Number(value);

export type ViewportState = {
  id?: string | null;
  x?: number | string | null;
  y?: number | string | null;
  zoom?: number | string | null;
};

type UseWorkflowViewportProps<TNode extends Node = Node> = {
  viewport?: ViewportState | null;
  isEmptyWorkflow: boolean;
  graphNodes: TNode[];
};

export const useWorkflowViewport = <TNode extends Node = Node>({
  viewport,
  isEmptyWorkflow,
  graphNodes,
}: UseWorkflowViewportProps<TNode>) => {
  const { setViewport, getViewport } = useReactFlow();
  const workflowWidth = useStore(
    (state) => state.width ?? state.domNode?.clientWidth ?? 0,
  );
  const workflowHeight = useStore(
    (state) => state.height ?? state.domNode?.clientHeight ?? 0,
  );
  const viewportSyncKey = viewport?.id ?? EMPTY_WORKFLOW_SYNC_KEY;
  // Per-flow bookkeeping, keyed by viewportSyncKey so switching workflows
  // implicitly resets it — no dedicated reset effects needed.
  const viewportInitializedForFlowRef = useRef<string | null>(null);
  const prevStepNodeIdsRef = useRef<{ key: string; ids: string[] } | null>(
    null,
  );
  const centerAfterFirstInsertRef = useRef(false);
  const graphNodesRef = useRef(graphNodes);

  graphNodesRef.current = graphNodes;

  // Changes only when step nodes are added or removed, so the viewport effect
  // never fires for structural-only updates (attachments, placeholders,
  // indicators, groups).
  const stepNodeSignature = useMemo(
    () => getStepNodeIds(graphNodes).join("|"),
    [graphNodes],
  );
  const { defaultViewport, hasPersistedViewport } = useMemo(() => {
    const parsedViewport = {
      x: parseViewportNumber(viewport?.x),
      y: parseViewportNumber(viewport?.y),
      zoom: parseViewportNumber(viewport?.zoom),
    };

    // Meaningful ⇔ finite, zoom within bounds, not the {0,0,1} default
    return isMeaningfulWorkflowViewport(parsedViewport)
      ? { defaultViewport: parsedViewport, hasPersistedViewport: true }
      : {
          defaultViewport: {
            x: Number.isFinite(parsedViewport.x)
              ? parsedViewport.x
              : DEFAULT_WORKFLOW_VIEWPORT.x,
            y: Number.isFinite(parsedViewport.y)
              ? parsedViewport.y
              : DEFAULT_WORKFLOW_VIEWPORT.y,
            zoom: normalizeWorkflowViewportZoom(parsedViewport.zoom),
          },
          hasPersistedViewport: false,
        };
  }, [viewport?.x, viewport?.y, viewport?.zoom]);
  const initialViewport = useMemo(
    () =>
      isEmptyWorkflow && !hasPersistedViewport
        ? { x: workflowWidth / 2, y: workflowHeight / 2, zoom: 1 }
        : defaultViewport,
    [
      defaultViewport,
      hasPersistedViewport,
      isEmptyWorkflow,
      workflowHeight,
      workflowWidth,
    ],
  );
  const syncViewportForFlow = useCallback(
    (nextViewport: Viewport, options?: { duration?: number }) => {
      setViewport(nextViewport, options);
      viewportInitializedForFlowRef.current = viewportSyncKey;
    },
    [setViewport, viewportSyncKey],
  );
  /**
   * Center the given nodes without exceeding `maxZoom` (the current zoom by
   * default). When the nodes do not fit at that zoom — the view would be
   * cropped — the zoom is lowered just enough to bring them fully into view.
   */
  const focusNodes = useCallback(
    (nodes: Node[], options?: { duration?: number; maxZoom?: number }) => {
      if (nodes.length === 0 || workflowWidth <= 0 || workflowHeight <= 0) {
        return;
      }

      const focusedViewport = getViewportForBounds(
        getNodesBounds(nodes),
        workflowWidth,
        workflowHeight,
        WORKFLOW_VIEWPORT_MIN_ZOOM,
        options?.maxZoom ?? normalizeWorkflowViewportZoom(getViewport().zoom),
        WORKFLOW_VIEWPORT_FIT_PADDING,
      );

      syncViewportForFlow(
        focusedViewport,
        options?.duration !== undefined
          ? { duration: options.duration }
          : undefined,
      );
    },
    [getViewport, syncViewportForFlow, workflowHeight, workflowWidth],
  );

  useEffect(() => {
    if (workflowWidth <= 0 || workflowHeight <= 0) {
      return;
    }

    // Apply the initial viewport once per workflow
    if (viewportInitializedForFlowRef.current !== viewportSyncKey) {
      syncViewportForFlow(initialViewport);
    }

    const nodes = graphNodesRef.current;
    const prevEntry = prevStepNodeIdsRef.current;
    // null → first run for this workflow (persisted viewport is respected)
    const prevStepIds =
      prevEntry?.key === viewportSyncKey ? prevEntry.ids : null;
    const stepIds = getStepNodeIds(nodes);

    // While the workflow is empty, keep treating the next run as a first run
    // so inserts are handled by the center-after-first-insert flow only.
    prevStepNodeIdsRef.current = isEmptyWorkflow
      ? null
      : { key: viewportSyncKey, ids: stepIds };

    // First insert into an empty workflow → center the whole graph
    if (centerAfterFirstInsertRef.current) {
      if (nodes.length > 0) {
        centerAfterFirstInsertRef.current = false;
        focusNodes(nodes, { duration: WORKFLOW_VIEWPORT_FOCUS_DURATION });
      }

      return;
    }

    // First run for this workflow, or step nodes materializing after the
    // async layout (load / workflow switch) → respect the persisted viewport.
    // Real inserts from zero steps go through the first-insert flag above.
    if (prevStepIds === null || prevStepIds.length === 0) {
      return;
    }

    // All nodes removed → reset viewport to canvas center
    if (nodes.length === 0) {
      syncViewportForFlow({
        x: workflowWidth / 2,
        y: workflowHeight / 2,
        zoom: getViewport().zoom,
      });

      return;
    }

    const prevStepIdSet = new Set(prevStepIds);
    const stepIdSet = new Set(stepIds);
    // Use count change to distinguish insertion from deletion — step IDs are
    // index-based, so a deletion shifts subsequent IDs and makes them look new.
    const isInsertion = stepIds.length > prevStepIds.length;
    const addedStepId = isInsertion
      ? stepIds.find((id) => !prevStepIdSet.has(id))
      : undefined;
    const lastRemovedIndex = prevStepIds.reduce(
      (last, id, index) => (stepIdSet.has(id) ? last : index),
      -1,
    );
    const targetStepId =
      addedStepId ??
      (lastRemovedIndex === -1
        ? undefined
        : (prevStepIds
            .slice(0, lastRemovedIndex)
            .reverse()
            .find((id) => stepIdSet.has(id)) ?? stepIds[0]));
    const targetNode = nodes.find((n) => n.id === targetStepId);

    if (targetNode) {
      focusNodes([targetNode], { duration: WORKFLOW_VIEWPORT_FOCUS_DURATION });
    }
  }, [
    focusNodes,
    getViewport,
    initialViewport,
    isEmptyWorkflow,
    stepNodeSignature,
    syncViewportForFlow,
    viewportSyncKey,
    workflowHeight,
    workflowWidth,
  ]);

  const requestCenterAfterFirstInsert = useCallback(() => {
    if (isEmptyWorkflow) {
      centerAfterFirstInsertRef.current = true;
    }
  }, [isEmptyWorkflow]);
  const clearCenterAfterFirstInsert = useCallback(() => {
    centerAfterFirstInsertRef.current = false;
  }, []);

  return {
    initialViewport,
    requestCenterAfterFirstInsert,
    clearCenterAfterFirstInsert,
  };
};

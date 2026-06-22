/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { CompiledStep, DefDefinitions } from "@hexabot-ai/agentic";
import type { ResizeControlDirection } from "@xyflow/system";
import { useEffect, useRef, useState } from "react";

import { EMPTY_WORKFLOW_GRAPH } from "../constants/workflow.constants";
import type {
  WorkflowAction,
  WorkflowBindingCatalog,
  WorkflowGraphData,
} from "../types/workflow-node.types";
import {
  buildNodesAndEdges,
  getWorkflowDefaultConfig,
} from "../utils/workflow-node.utils";

type UseWorkflowGraphLayoutProps = {
  compiledFlow?: CompiledStep[];
  defs?: DefDefinitions;
  layoutDirection?: ResizeControlDirection;
  actionCatalog: ReadonlyMap<string, WorkflowAction>;
  bindingCatalog: WorkflowBindingCatalog;
};

export const useWorkflowGraphLayout = ({
  compiledFlow,
  defs,
  layoutDirection,
  actionCatalog,
  bindingCatalog,
}: UseWorkflowGraphLayoutProps) => {
  const [graphData, setGraphData] =
    useState<WorkflowGraphData>(EMPTY_WORKFLOW_GRAPH);
  const requestTokenRef = useRef(0);
  const isEmptyWorkflow =
    Array.isArray(compiledFlow) && compiledFlow.length === 0;
  const isLoading = compiledFlow === undefined;

  useEffect(() => {
    const requestToken = requestTokenRef.current + 1;

    requestTokenRef.current = requestToken;
    let cancelled = false;

    const layoutGraph = async () => {
      if (!compiledFlow?.length) {
        if (!cancelled && requestTokenRef.current === requestToken) {
          setGraphData(EMPTY_WORKFLOW_GRAPH);
        }

        return;
      }

      try {
        const config = getWorkflowDefaultConfig(layoutDirection);
        const layoutedGraph = await buildNodesAndEdges({
          config,
          flow: compiledFlow,
          defs,
          actionCatalog,
          bindingCatalog,
        });

        if (!cancelled && requestTokenRef.current === requestToken) {
          setGraphData(layoutedGraph ?? EMPTY_WORKFLOW_GRAPH);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to layout workflow graph:", error);

        if (!cancelled && requestTokenRef.current === requestToken) {
          setGraphData(EMPTY_WORKFLOW_GRAPH);
        }
      }
    };

    void layoutGraph();

    return () => {
      cancelled = true;
    };
  }, [actionCatalog, bindingCatalog, compiledFlow, defs, layoutDirection]);

  return {
    graphData,
    isEmptyWorkflow,
    isLoading,
  };
};

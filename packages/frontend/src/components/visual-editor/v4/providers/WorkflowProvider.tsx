/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  WorkflowDefinition,
  Workflow as WorkflowHelper,
  extractTaskDefinitions,
  type FlowStep,
  type TaskDefinition,
} from "@hexabot-ai/agentic";
import {
  isSameWorkflowSelection,
  type FlowStepPath,
  type WorkflowSelectionSnapshot,
} from "@hexabot-ai/graph";
import type { WorkflowImportResult } from "@hexabot-ai/types";
import debounce from "@mui/utils/debounce";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useFind } from "@/hooks/crud/useFind";
import { useGetFromCache } from "@/hooks/crud/useGet";
import {
  useTanstackMutation,
  useTanstackQueryClient,
} from "@/hooks/crud/useTanstack";
import { useApiClient } from "@/hooks/useApiClient";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useAuth } from "@/hooks/useAuth";
import { useQueryState } from "@/hooks/useQueryState";
import { useSafeCallback } from "@/hooks/useSafeCallback";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import type { WorkflowExportFile } from "@/services/api.class";
import { EntityType, Format, QueryType, RouterType } from "@/services/types";
import type { IAction } from "@/types/action.types";
import type { EntityAttributes } from "@/types/base.types";

import { WorkflowContext } from "../contexts/workflow.context";
import { useWorkflowDefinitionState } from "../hooks/useWorkflowDefinitionState";
import type { WorkflowContextProps } from "../types/workflow.types";
import { getSchemaDefaults } from "../utils/schema-defaults.utils";
import {
  createBaseDefinition,
  createTaskName,
  extractTaskIdsFromYaml,
} from "../utils/workflow-definition.utils";

type TaskInputs = NonNullable<TaskDefinition["inputs"]>;
type TaskSettings = NonNullable<TaskDefinition["settings"]>;
type WorkflowAttributes = EntityAttributes<EntityType.WORKFLOW>;
const EMPTY_GRAPH_SELECTION: WorkflowSelectionSnapshot = {
  nodeIds: [],
  nodes: [],
};
const TRANSFER_CACHE_ENTITIES = new Set<string>([
  EntityType.WORKFLOW,
  EntityType.WORKFLOW_VERSION,
  EntityType.MEMORY_DEFINITION,
  EntityType.MCP_SERVER,
  EntityType.CREDENTIAL,
]);

export const WorkflowProvider: React.FC<WorkflowContextProps> = ({
  children,
  workflow,
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const { apiClient } = useApiClient();
  const { refetchUser } = useAuth();
  const queryClient = useTanstackQueryClient();
  const [flowId] = useQueryState("flowId");
  const { data: workflows, isSuccess: isWorkflowsSuccess } = useFind(
    {
      entity: EntityType.WORKFLOW,
      format: Format.FULL,
    },
    {
      hasCount: false,
      initialSortState: [{ field: "createdAt", sort: "asc" }],
    },
  );
  const router = useAppRouter();
  const directionMemo = useMemo(() => {
    return workflow?.direction;
  }, [flowId, workflow?.direction]);
  const getWorkflowFromCache = useGetFromCache(EntityType.WORKFLOW);
  const [graphSelection, setGraphSelectionState] =
    useState<WorkflowSelectionSnapshot>(EMPTY_GRAPH_SELECTION);
  const selectedNodeIds = graphSelection.nodeIds;
  const [openSearchPanel, setOpenSearchPanel] = useState(false);
  const {
    yaml,
    definition,
    flow,
    definitionErrors,
    updateDefinitionState,
    persistDefinition,
    publishVersion,
    unpublishVersion,
    restoreVersion,
    updateVersionMessage,
    isDefinitionDirty,
    updateWorkflow,
    isSaving,
  } = useWorkflowDefinitionState({
    workflow,
  });
  const taskDefinitions = useMemo(
    () => extractTaskDefinitions(definition?.defs ?? {}),
    [definition?.defs],
  );
  const taskIds = useMemo(() => extractTaskIdsFromYaml(yaml), [yaml]);
  const addActionStep = useCallback(
    (action: IAction, insertPath?: FlowStepPath | null) => {
      const baseDefinition = definition ?? createBaseDefinition();
      const nextTaskName = createTaskName(
        action.name,
        baseDefinition.defs ?? {},
        taskDefinitions,
      );
      const taskDescription = action.description?.trim();
      const inputDefaults = getSchemaDefaults<TaskInputs>(action.inputSchema);
      const settingDefaults = getSchemaDefaults<TaskSettings>(
        action.settingSchema,
      )!;
      const nextTaskDefinition: TaskDefinition = {
        kind: "task",
        action: action.name,
        ...(taskDescription ? { description: taskDescription } : {}),
        ...(inputDefaults !== undefined ? { inputs: inputDefaults } : {}),
        ...(settingDefaults !== undefined ? { settings: settingDefaults } : {}),
      };
      const nextDefs = {
        ...baseDefinition.defs,
        [nextTaskName]: nextTaskDefinition,
      };
      const nextOutputs =
        baseDefinition.outputs && Object.keys(baseDefinition.outputs).length > 0
          ? baseDefinition.outputs
          : { result: `=$output.${nextTaskName}` };
      const nextStep: FlowStep = { do: nextTaskName };
      const definitionWithTask: WorkflowDefinition = {
        ...baseDefinition,
        defs: nextDefs,
        outputs: nextOutputs,
      };
      const insertedDefinition = insertPath
        ? WorkflowHelper.insertStepAtPath(
            definitionWithTask,
            insertPath,
            nextStep,
          )
        : null;
      const nextDefinition: WorkflowDefinition = insertedDefinition ?? {
        ...definitionWithTask,
        flow: [...(baseDefinition.flow ?? []), nextStep],
      };

      updateDefinitionState(nextDefinition);
    },
    [definition, taskDefinitions, updateDefinitionState],
  );
  const addConditionalStep = useCallback(
    (insertPath?: FlowStepPath | null) => {
      const baseDefinition = definition ?? createBaseDefinition();
      const conditionalStep: FlowStep = {
        conditional: {
          when: [
            { condition: "=false", steps: [] },
            { else: true, steps: [] },
          ],
        },
      };
      const insertedDefinition = insertPath
        ? WorkflowHelper.insertStepAtPath(
            baseDefinition,
            insertPath,
            conditionalStep,
          )
        : null;
      const nextDefinition: WorkflowDefinition = insertedDefinition ?? {
        ...baseDefinition,
        flow: [...(baseDefinition.flow ?? []), conditionalStep],
      };

      updateDefinitionState(nextDefinition);
    },
    [definition, updateDefinitionState],
  );
  const addLoopStep = useCallback(
    (insertPath?: FlowStepPath | null) => {
      const baseDefinition = definition ?? createBaseDefinition();
      const loopStep: FlowStep = {
        loop: {
          type: "for_each",
          for_each: {
            item: "item",
            in: "=[]",
          },
          steps: [],
        },
      };
      const insertedDefinition = insertPath
        ? WorkflowHelper.insertStepAtPath(baseDefinition, insertPath, loopStep)
        : null;
      const nextDefinition: WorkflowDefinition = insertedDefinition ?? {
        ...baseDefinition,
        flow: [...(baseDefinition.flow ?? []), loopStep],
      };

      updateDefinitionState(nextDefinition);
    },
    [definition, updateDefinitionState],
  );
  const addParallelStep = useCallback(
    (insertPath?: FlowStepPath | null) => {
      const baseDefinition = definition ?? createBaseDefinition();
      const parallelStep: FlowStep = {
        parallel: {
          strategy: "wait_all",
          steps: [],
        },
      };
      const insertedDefinition = insertPath
        ? WorkflowHelper.insertStepAtPath(
            baseDefinition,
            insertPath,
            parallelStep,
          )
        : null;
      const nextDefinition: WorkflowDefinition = insertedDefinition ?? {
        ...baseDefinition,
        flow: [...(baseDefinition.flow ?? []), parallelStep],
      };

      updateDefinitionState(nextDefinition);
    },
    [definition, updateDefinitionState],
  );
  const getQuery = (key: string): string =>
    typeof router.query[key] === "string" ? router.query[key] : "";
  const updateWorkflowURL = useCallback(
    async (flowId: string, nodeIds: string[] = []) => {
      const nodeParams =
        Array.isArray(nodeIds) && nodeIds.length ? `/${nodeIds.join(",")}` : "";

      if (router.pathname.startsWith(`/${RouterType.WORKFLOW_EDITOR}`)) {
        await router.push(
          `/${RouterType.WORKFLOW_EDITOR}/${flowId}${nodeParams}`,
        );
      }
    },
    [router.pathname, router.push],
  );
  const removeWorkflowParams = useCallback(async () => {
    if (flowId) {
      await router.replace(`/${RouterType.WORKFLOW_EDITOR}/${flowId}`);
    }
  }, [flowId, router.replace]);
  const setGraphSelection = useCallback(
    (nextSelection: WorkflowSelectionSnapshot) => {
      if (isSameWorkflowSelection(graphSelection, nextSelection)) {
        return;
      }

      setGraphSelectionState(nextSelection);

      const hasSameNodeIds =
        graphSelection.nodeIds.length === nextSelection.nodeIds.length &&
        graphSelection.nodeIds.every(
          (nodeId, index) => nodeId === nextSelection.nodeIds[index],
        );

      if (flowId && !hasSameNodeIds) {
        void updateWorkflowURL(flowId, nextSelection.nodeIds);
      }
    },
    [flowId, graphSelection, updateWorkflowURL],
  );
  const removeStepAtPath = useCallback(
    (stepPath: FlowStepPath, nodeId?: string) => {
      if (!definition) {
        return;
      }

      const nextDefinition = WorkflowHelper.removeStepAtPath(
        definition,
        stepPath,
      );

      if (!nextDefinition) {
        return;
      }

      updateDefinitionState(nextDefinition);

      if (!nodeId || !selectedNodeIds.includes(nodeId)) {
        return;
      }

      const nextSelection = selectedNodeIds.filter(
        (selectedNodeId) => selectedNodeId !== nodeId,
      );

      setGraphSelection({
        nodeIds: nextSelection,
        nodes: graphSelection.nodes.filter(
          (selectedNode) => selectedNode.id !== nodeId,
        ),
      });
    },
    [
      definition,
      graphSelection.nodes,
      selectedNodeIds,
      setGraphSelection,
      updateDefinitionState,
    ],
  );
  const debouncedWorkflowUpdate = useSafeCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    debounce((props: Partial<WorkflowAttributes>) => {
      if (flowId) {
        updateWorkflow({
          id: flowId,
          params: props,
        });
      }
    }, 400),
    [flowId],
    (memoizedFn) => {
      memoizedFn.clear();
    },
  );
  const invalidateWorkflowTransferQueries = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: ({ queryKey }) => {
        const [queryType, queryEntity] = queryKey;

        if (
          queryType !== QueryType.item &&
          queryType !== QueryType.collection &&
          queryType !== QueryType.count
        ) {
          return false;
        }

        if (typeof queryEntity !== "string") {
          return false;
        }

        return TRANSFER_CACHE_ENTITIES.has(queryEntity.split("/")[0]);
      },
    });
  }, [queryClient]);
  const downloadWorkflowFile = useCallback((file: WorkflowExportFile) => {
    if (typeof window === "undefined") {
      return;
    }

    const url = window.URL.createObjectURL(file.blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = file.filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, []);
  const { mutate: exportWorkflowMutation, isPending: isExportingWorkflow } =
    useTanstackMutation<WorkflowExportFile, Error, string>({
      mutationFn: (workflowId) => apiClient.exportWorkflow(workflowId),
      onSuccess: downloadWorkflowFile,
      onError: (error) => {
        toast.error(error);
      },
    });
  const { mutate: importWorkflowMutation, isPending: isImportingWorkflow } =
    useTanstackMutation<WorkflowImportResult, Error, File>({
      mutationFn: (file) => apiClient.importWorkflowBundle(file),
      onSuccess: (result) => {
        queryClient.setQueryData(
          [QueryType.item, EntityType.WORKFLOW, result.workflow.id],
          result.workflow,
        );
        void invalidateWorkflowTransferQueries();
        void updateWorkflowURL(result.workflow.id);
        void refetchUser();
        toast.success(t("message.workflow_import_success"));

        if (result.warnings.length > 0) {
          toast.warning(
            t("message.workflow_import_warnings", {
              0: result.warnings.length,
            }),
          );
        }
      },
      onError: (error) => {
        toast.error(error);
      },
    });
  const exportWorkflow = useCallback(
    (workflowId: string) => {
      if (workflowId === flowId && isDefinitionDirty) {
        toast.warning(t("message.workflow_export_save_before"));

        return;
      }

      exportWorkflowMutation(workflowId);
    },
    [exportWorkflowMutation, flowId, isDefinitionDirty, t, toast],
  );
  const importWorkflowBundle = useCallback(
    (file: File) => {
      importWorkflowMutation(file);
    },
    [importWorkflowMutation],
  );

  useEffect(() => {
    if (!isWorkflowsSuccess) return;

    if (!flowId && workflows.length) {
      updateWorkflowURL(workflows.at(-1)?.id || workflows[0].id);
    } else if (flowId && !workflows.some((w) => w.id === flowId)) {
      void router.replace(`/${RouterType.WORKFLOW_EDITOR}/${workflows[0].id}`);
    }
  }, [flowId, workflows, isWorkflowsSuccess, updateWorkflowURL, router]);

  return (
    <WorkflowContext.Provider
      value={{
        getQuery,
        graphSelection,
        openSearchPanel,
        selectedNodeIds,
        getWorkflowFromCache,
        setOpenSearchPanel,
        setGraphSelection,
        selectedFlowId: flowId,
        direction: directionMemo,
        updateWorkflowURL,
        removeWorkflowParams,
        yaml,
        updateDefinitionState,
        workflow,
        workflows,
        updateWorkflow,
        debouncedWorkflowUpdate,
        persistDefinition,
        publishVersion,
        unpublishVersion,
        restoreVersion,
        updateVersionMessage,
        isDefinitionDirty,
        isSaving,
        isExportingWorkflow,
        isImportingWorkflow,
        exportWorkflow,
        importWorkflowBundle,
        addActionStep,
        addConditionalStep,
        addLoopStep,
        addParallelStep,
        removeStepAtPath,
        definition,
        flow,
        definitionErrors,
        taskDefinitions,
        taskIds,
      }}
    >
      {children}
    </WorkflowContext.Provider>
  );
};

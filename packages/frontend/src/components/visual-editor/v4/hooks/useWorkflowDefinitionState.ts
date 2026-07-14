/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  compileWorkflow,
  type CompiledStep,
  validateWorkflow,
  type WorkflowCompileOptions,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";
import type { Workflow } from "@hexabot-ai/types";
import { WorkflowVersionAction } from "@hexabot-ai/types";
import debounce from "@mui/utils/debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useWorkflowBindingsCatalog } from "@/contexts/workflow-bindings.context";
import { useCreate } from "@/hooks/crud/useCreate";
import { useGet } from "@/hooks/crud/useGet";
import {
  useTanstackMutation,
  useTanstackQueryClient,
} from "@/hooks/crud/useTanstack";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useApiClient } from "@/hooks/useApiClient";
import { useSafeCallback } from "@/hooks/useSafeCallback";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, QueryType } from "@/services/types";

import type {
  RawWorkflowIssue,
  WorkflowDefinitionStatus,
} from "../types/workflow.types";
import {
  applyWorkflowDefinitionStateUpdate,
  commitWorkflowDefinitionUpdate,
  stringifyWorkflowDefinitionUpdate,
  type UpdateWorkflowDefinitionStateOptions,
} from "../utils/workflow-definition-state.utils";
import { localizeWorkflowIssues } from "../utils/workflow-issue-localization";
import { createWorkflowValidationActions } from "../utils/workflow-validation.utils";

import { useWorkflowVersionNavigation } from "./useWorkflowVersionNavigation";

type UseWorkflowDefinitionStateArgs = {
  workflow?: Workflow;
};

type WorkflowDefinitionComputedState = {
  status: WorkflowDefinitionStatus;
  definition?: WorkflowDefinition;
  flow?: CompiledStep[];
  issues: RawWorkflowIssue[];
};

export const useWorkflowDefinitionState = ({
  workflow,
}: UseWorkflowDefinitionStateArgs) => {
  const { t } = useTranslate();
  const {
    actionsByName,
    isSuccess: areActionsReady,
    isError: hasActionsError,
  } = useWorkflowActionsCatalog();
  const {
    bindingKinds,
    isSuccess: areBindingsReady,
    isError: hasBindingsError,
  } = useWorkflowBindingsCatalog();
  const queryClient = useTanstackQueryClient();
  const { apiClient } = useApiClient();
  const { mutate: updateWorkflow } = useUpdate(EntityType.WORKFLOW);
  const { mutate: updateWorkflowVersion, isPending: isUpdatingVersionMessage } =
    useUpdate(EntityType.WORKFLOW_VERSION, {
      routeParams: workflow ? { id: workflow.id } : undefined,
    });
  const updateWorkflowCache = useCallback(
    (updates: Partial<Workflow>) => {
      queryClient.setQueryData(
        [QueryType.item, EntityType.WORKFLOW, workflow?.id],
        (cached?: Workflow) => {
          if (!cached) {
            return workflow ? { ...workflow, ...updates } : cached;
          }

          return {
            ...cached,
            ...updates,
          };
        },
      );
    },
    [queryClient, workflow],
  );
  const { mutate: commitVersion, isPending: isCommitting } = useCreate(
    EntityType.WORKFLOW_VERSION,
    {
      routeParams: { id: workflow?.id },
      onSuccess(data) {
        updateWorkflowCache({
          currentVersion: data.id,
        });
      },
    },
  );
  const { mutate: publish, isPending: isPublishing } = useTanstackMutation<
    Workflow,
    Error,
    void
  >({
    mutationFn: async () => {
      if (!workflow?.id) {
        throw new Error("Workflow ID is required to publish");
      }

      return await apiClient.publishWorkflow(workflow.id);
    },
    onSuccess: (updatedWorkflow) => {
      updateWorkflowCache({
        currentVersion: updatedWorkflow.currentVersion,
        publishedVersion: updatedWorkflow.publishedVersion,
      });
    },
  });
  const { mutate: publishByVersionId, isPending: isPublishingVersion } =
    useTanstackMutation<Workflow, Error, string>({
      mutationFn: async (versionId) => {
        if (!workflow?.id) {
          throw new Error("Workflow ID is required to publish");
        }

        return await apiClient.publishWorkflowVersion(workflow.id, versionId);
      },
      onSuccess: (updatedWorkflow) => {
        updateWorkflowCache({
          currentVersion: updatedWorkflow.currentVersion,
          publishedVersion: updatedWorkflow.publishedVersion,
        });
      },
    });
  const { mutate: unpublish, isPending: isUnpublishing } = useTanstackMutation<
    Workflow,
    Error,
    void
  >({
    mutationFn: async () => {
      if (!workflow?.id) {
        throw new Error("Workflow ID is required to unpublish");
      }

      return await apiClient.unpublishWorkflow(workflow.id);
    },
    onSuccess: (updatedWorkflow) => {
      updateWorkflowCache({
        currentVersion: updatedWorkflow.currentVersion,
        publishedVersion: updatedWorkflow.publishedVersion,
      });
    },
  });
  // Reactive version read: served from the cache, fetched when missing.
  const { data: currentVersionData } = useGet(
    workflow?.currentVersion ?? "",
    { entity: EntityType.WORKFLOW_VERSION },
    {
      enabled: !!workflow?.id && !!workflow?.currentVersion,
      routeParams: { id: workflow?.id },
    },
  );
  const currentVersion = workflow?.currentVersion ? currentVersionData : null;
  const isDefinitionLoading =
    !!workflow?.currentVersion && currentVersion === undefined;
  const [yaml, setYaml] = useState(
    currentVersion ? currentVersion.definitionYml : "",
  );
  const compileActionsByName = useMemo(
    () =>
      Array.from(actionsByName.entries()).reduce(
        (acc, [name, action]) => {
          acc[name] =
            action as unknown as WorkflowCompileOptions["actions"][string];

          return acc;
        },
        {} as WorkflowCompileOptions["actions"],
      ),
    [actionsByName],
  );
  const actionValidationMetadata = useMemo(
    () => createWorkflowValidationActions(actionsByName),
    [actionsByName],
  );
  const definitionSignatureRef = useRef("");
  // Single source of truth for the definition lifecycle: validated once, then
  // compiled only when valid. `status` distinguishes "still loading" from
  // "broken" so the graph can show a spinner vs. an error panel.
  const definitionState = useMemo<WorkflowDefinitionComputedState>(() => {
    if (hasActionsError || hasBindingsError) {
      return {
        status: "invalid",
        issues: [
          {
            code: "catalog_error",
            message: "Failed to load the workflow catalogs from the server.",
          },
        ],
      };
    }
    if (!areActionsReady || !areBindingsReady || isDefinitionLoading) {
      // Catalogs or version yaml not fetched yet — undefined flow keeps the
      // graph loading instead of flashing spurious errors.
      return { status: "loading", issues: [] };
    }
    if (!yaml) {
      // Catalogs ready but yaml is empty → workflow has no steps yet
      return { status: "empty", flow: [] as CompiledStep[], issues: [] };
    }

    const validation = validateWorkflow(yaml, {
      bindingKinds,
      actions: actionValidationMetadata,
    });

    if (!validation.success) {
      return { status: "invalid", issues: validation.issues };
    }

    try {
      const { flow, definition } = compileWorkflow(validation.data, {
        actions: compileActionsByName,
        bindingKinds,
      });

      return { status: "ready", definition, flow, issues: [] };
    } catch (error) {
      // Defensive: validation passed but compilation still threw.
      return {
        status: "invalid",
        issues: [
          {
            code: "compile_error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }, [
    actionValidationMetadata,
    areActionsReady,
    areBindingsReady,
    bindingKinds,
    compileActionsByName,
    hasActionsError,
    hasBindingsError,
    isDefinitionLoading,
    yaml,
    workflow?.id,
  ]);
  const { status: definitionStatus, definition, flow } = definitionState;
  const definitionIssues = useMemo(
    () => localizeWorkflowIssues(definitionState.issues, t),
    [definitionState.issues, t],
  );
  // New definition version not yet saved ?
  const isDefinitionDirty = useMemo(() => {
    if (workflow?.currentVersion && !currentVersion) {
      return false;
    }

    const baseline = currentVersion?.definitionYml ?? "";

    return baseline !== yaml;
  }, [currentVersion?.definitionYml, workflow?.currentVersion, yaml]);
  const commitDefinitionUpdate = useCallback(
    (nextDefinitionYml: string) =>
      commitWorkflowDefinitionUpdate({
        actions: actionValidationMetadata,
        bindingKinds,
        commitVersion,
        definitionYml: nextDefinitionYml,
        workflowId: workflow?.id,
      }),
    [actionValidationMetadata, bindingKinds, commitVersion, workflow?.id],
  );
  const debouncedDefinitionUpdate = useSafeCallback(
    debounce((nextDefinitionYml: string) => {
      commitDefinitionUpdate(nextDefinitionYml);
    }, 4000),
    [commitDefinitionUpdate],
    (memoizedFn) => {
      memoizedFn.clear();
    },
  );
  const updateDefinitionState = useCallback(
    (
      nextDefinition: string | WorkflowDefinition,
      options?: UpdateWorkflowDefinitionStateOptions,
    ) => {
      applyWorkflowDefinitionStateUpdate({
        clearDebouncedCommit: debouncedDefinitionUpdate.clear,
        commitImmediately: commitDefinitionUpdate,
        currentSignature: definitionSignatureRef.current,
        nextDefinition,
        options,
        savedDefinitionYml: currentVersion?.definitionYml ?? "",
        scheduleDebouncedCommit: debouncedDefinitionUpdate,
        setSignature: (nextDefinitionYml) => {
          definitionSignatureRef.current = nextDefinitionYml;
        },
        setYaml,
      });
    },
    [
      commitDefinitionUpdate,
      currentVersion?.definitionYml,
      debouncedDefinitionUpdate,
    ],
  );
  // Immediate commit of the definition version
  const persistDefinition = useCallback(() => {
    if (
      !workflow?.id ||
      definitionStatus !== "ready" ||
      !definition ||
      !isDefinitionDirty
    ) {
      return;
    }

    definitionSignatureRef.current =
      stringifyWorkflowDefinitionUpdate(definition);
    debouncedDefinitionUpdate.clear();
    commitDefinitionUpdate(definitionSignatureRef.current);
  }, [
    commitDefinitionUpdate,
    debouncedDefinitionUpdate,
    definition,
    definitionStatus,
    workflow?.id,
    isDefinitionDirty,
  ]);
  const publishVersion = useCallback(
    (versionId?: string) => {
      if (!workflow?.id) {
        return;
      }

      if (
        versionId &&
        versionId !== workflow.currentVersion &&
        versionId !== workflow.publishedVersion
      ) {
        publishByVersionId(versionId);

        return;
      }

      if (
        !workflow.currentVersion ||
        workflow.currentVersion === workflow.publishedVersion
      ) {
        return;
      }

      publish();
    },
    [
      publish,
      publishByVersionId,
      workflow?.id,
      workflow?.currentVersion,
      workflow?.publishedVersion,
    ],
  );
  const unpublishVersion = useCallback(() => {
    if (!workflow?.id || !workflow.publishedVersion) {
      return;
    }

    unpublish();
  }, [unpublish, workflow?.id, workflow?.publishedVersion]);
  const restoreVersion = useCallback(
    (parentVersion: string, definitionYml: string) => {
      if (!workflow?.id || !parentVersion || !definitionYml) {
        return;
      }

      debouncedDefinitionUpdate.clear();
      commitVersion({
        action: WorkflowVersionAction.restore,
        definitionYml,
        parentVersion,
      });
    },
    [debouncedDefinitionUpdate, workflow?.id, commitVersion],
  );
  const updateVersionMessage = useCallback(
    (versionId: string, message: string) => {
      if (!workflow?.id || !versionId) {
        return;
      }

      updateWorkflowVersion({
        id: versionId,
        params: {
          message,
        },
      });
    },
    [updateWorkflowVersion, workflow?.id],
  );
  const revertLocalEdits = useCallback(() => {
    updateDefinitionState(currentVersion?.definitionYml ?? "");
  }, [currentVersion?.definitionYml, updateDefinitionState]);
  const isSaving =
    isCommitting ||
    isPublishing ||
    isPublishingVersion ||
    isUnpublishing ||
    isUpdatingVersionMessage;
  const { undo, redo, canUndo, canRedo } = useWorkflowVersionNavigation({
    workflow,
    currentVersion,
    isDefinitionDirty,
    isSaving,
    revertLocalEdits,
  });

  useEffect(() => {
    // currentVersion is `null` when workflow genuinely has no version.
    // It is `undefined` when the version entity reference exists but hasn't been
    // written into the TanStack Query cache yet (transient during normalization).
    // Skipping the `undefined` case prevents a spurious yaml → "" reset that
    // would briefly clear the compiled flow and flash the empty-workflow overlay.
    if (currentVersion === undefined) return;

    const nextYaml = currentVersion?.definitionYml ?? "";

    definitionSignatureRef.current = nextYaml;
    setYaml(nextYaml);
  }, [currentVersion, workflow?.id]);

  return {
    yaml,
    definition,
    flow,
    definitionStatus,
    definitionIssues,
    updateDefinitionState,
    persistDefinition,
    publishVersion,
    unpublishVersion,
    restoreVersion,
    updateVersionMessage,
    isDefinitionDirty,
    updateWorkflow,
    undo,
    redo,
    canUndo,
    canRedo,
    isSaving,
  };
};

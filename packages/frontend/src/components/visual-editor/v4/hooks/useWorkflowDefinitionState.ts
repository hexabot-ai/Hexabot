/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
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
import { EntityType, QueryType } from "@/services/types";

import {
  applyWorkflowDefinitionStateUpdate,
  commitWorkflowDefinitionUpdate,
  stringifyWorkflowDefinitionUpdate,
  type UpdateWorkflowDefinitionStateOptions,
} from "../utils/workflow-definition-state.utils";
import { getDefinition } from "../utils/workflow-definition.utils";

type UseWorkflowDefinitionStateArgs = {
  workflow?: Workflow;
};

export const useWorkflowDefinitionState = ({
  workflow,
}: UseWorkflowDefinitionStateArgs) => {
  const { actionsByName } = useWorkflowActionsCatalog();
  const { bindingKinds } = useWorkflowBindingsCatalog();
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
    () =>
      Object.fromEntries(
        Object.entries(compileActionsByName).map(
          ([actionName, actionDefinition]) => [
            actionName,
            {
              supportedBindings: actionDefinition.supportedBindings ?? [],
            },
          ],
        ),
      ),
    [compileActionsByName],
  );
  const definitionErrors = useMemo(() => {
    if (!yaml) {
      return [];
    }

    const validation = validateWorkflow(yaml, {
      bindingKinds,
      actions: actionValidationMetadata,
    });

    if (validation.success) {
      return [];
    }

    return validation.errors;
  }, [actionValidationMetadata, bindingKinds, yaml]);
  const hasDefinitionErrors = definitionErrors.length > 0;
  const definitionSignatureRef = useRef("");
  const {
    definition,
    flow,
    error: definitionError,
  } = useMemo(() => {
    if (actionsByName.size === 0) {
      // Actions not yet loaded — remain in loading limbo, not an empty workflow
      return { definition: undefined, error: null };
    }
    if (isDefinitionLoading) {
      // Version yaml not fetched yet — undefined flow keeps the graph loading
      return { definition: undefined, error: null };
    }
    if (!yaml) {
      // Actions ready but yaml is empty → workflow has no steps yet
      return { definition: undefined, error: null, flow: [] as CompiledStep[] };
    }

    try {
      const { flow, definition } = getDefinition(yaml, {
        actions: compileActionsByName,
        bindingKinds,
      });

      return {
        definition,
        flow,
        error: null,
      };
    } catch (error) {
      return { definition: undefined, flow: undefined, error: error as Error };
    }
  }, [
    actionsByName,
    compileActionsByName,
    bindingKinds,
    isDefinitionLoading,
    yaml,
    workflow?.id,
  ]);
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
      !definition ||
      definitionError ||
      hasDefinitionErrors ||
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
    definitionError,
    workflow?.id,
    isDefinitionDirty,
    hasDefinitionErrors,
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
    definitionErrors,
    updateDefinitionState,
    persistDefinition,
    publishVersion,
    unpublishVersion,
    restoreVersion,
    updateVersionMessage,
    isDefinitionDirty,
    updateWorkflow,
    isSaving:
      isCommitting ||
      isPublishing ||
      isPublishingVersion ||
      isUnpublishing ||
      isUpdatingVersionMessage,
  };
};

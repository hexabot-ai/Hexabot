/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  compileWorkflow,
  type CompiledStep,
  Workflow as WorkflowHelper,
  type ValidateWorkflowOptions,
  type WorkflowCompileOptions,
  type WorkflowDefinition,
  validateWorkflow,
} from "@hexabot-ai/agentic";
import { WorkflowVersionAction } from "@hexabot-ai/types";

import type {
  RawWorkflowIssue,
  WorkflowDefinitionStatus,
} from "../types/workflow.types";

type WorkflowDefinitionPersistMode = "debounced" | "immediate";

export type UpdateWorkflowDefinitionStateOptions = {
  persist?: WorkflowDefinitionPersistMode;
};

type CommitWorkflowDefinitionVersion = (payload: {
  action: WorkflowVersionAction;
  definitionYml: string;
}) => void;

type CommitWorkflowDefinitionUpdateArgs = ValidateWorkflowOptions & {
  commitVersion: CommitWorkflowDefinitionVersion;
  definitionYml: string;
  workflowId?: string;
};

type ApplyWorkflowDefinitionStateUpdateArgs = {
  clearDebouncedCommit: () => void;
  commitImmediately: (definitionYml: string) => void;
  currentSignature: string;
  nextDefinition: string | WorkflowDefinition;
  options?: UpdateWorkflowDefinitionStateOptions;
  savedDefinitionYml: string;
  scheduleDebouncedCommit: (definitionYml: string) => void;
  setSignature: (definitionYml: string) => void;
  setYaml: (definitionYml: string) => void;
};

export const stringifyWorkflowDefinitionUpdate = (
  nextDefinition: string | WorkflowDefinition,
) =>
  typeof nextDefinition === "string"
    ? nextDefinition
    : WorkflowHelper.stringifyDefinition(nextDefinition);

export const commitWorkflowDefinitionUpdate = ({
  actions,
  bindingKinds,
  commitVersion,
  definitionYml,
  workflowId,
}: CommitWorkflowDefinitionUpdateArgs) => {
  if (!workflowId) {
    return false;
  }

  const validation = validateWorkflow(definitionYml, {
    actions,
    bindingKinds,
  });

  if (!validation.success) {
    return false;
  }

  commitVersion({
    action: WorkflowVersionAction.update,
    definitionYml,
  });

  return true;
};

export const applyWorkflowDefinitionStateUpdate = ({
  clearDebouncedCommit,
  commitImmediately,
  currentSignature,
  nextDefinition,
  options,
  savedDefinitionYml,
  scheduleDebouncedCommit,
  setSignature,
  setYaml,
}: ApplyWorkflowDefinitionStateUpdateArgs) => {
  const nextSignature = stringifyWorkflowDefinitionUpdate(nextDefinition);
  const persistMode = options?.persist ?? "immediate";
  const hasChanged = currentSignature !== nextSignature;

  if (hasChanged) {
    setSignature(nextSignature);
    setYaml(nextSignature);
  }

  if (persistMode === "debounced") {
    if (hasChanged) {
      scheduleDebouncedCommit(nextSignature);
    }

    return;
  }

  clearDebouncedCommit();

  if (savedDefinitionYml !== nextSignature) {
    commitImmediately(nextSignature);
  }
};

export type WorkflowDefinitionComputedState = {
  status: WorkflowDefinitionStatus;
  definition?: WorkflowDefinition;
  flow?: CompiledStep[];
  issues: RawWorkflowIssue[];
};

type GetWorkflowDefinitionStateArgs = ValidateWorkflowOptions & {
  yaml: string;
  /** The action or binding catalog failed to load. */
  hasCatalogError: boolean;
  /** The catalogs or the version YAML are still loading. */
  isLoading: boolean;
  compileActions: WorkflowCompileOptions["actions"];
};

/**
 * Validate the workflow YAML, then compile it when it is valid. `status`
 * tells "still loading" from "broken", so the graph shows a spinner rather
 * than spurious errors while the catalogs load.
 */
export const getWorkflowDefinitionState = ({
  yaml,
  hasCatalogError,
  isLoading,
  actions,
  bindingKinds,
  compileActions,
}: GetWorkflowDefinitionStateArgs): WorkflowDefinitionComputedState => {
  if (hasCatalogError) {
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
  if (isLoading) {
    return { status: "loading", issues: [] };
  }
  if (!yaml) {
    // The catalogs are ready but the workflow has no steps yet.
    return { status: "empty", flow: [] as CompiledStep[], issues: [] };
  }

  const validation = validateWorkflow(yaml, { bindingKinds, actions });

  if (!validation.success) {
    return { status: "invalid", issues: validation.issues };
  }

  try {
    const { flow, definition } = compileWorkflow(validation.data, {
      actions: compileActions,
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
};

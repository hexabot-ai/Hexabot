/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  extractTaskDefinitions,
  issueMessages,
  validateWorkflow,
  WorkflowDefinition,
} from '@hexabot-ai/agentic';
import { WorkflowType } from '@hexabot-ai/types';

import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';

export const parseWorkflowDefinition = (
  definitionYaml: string,
): WorkflowDefinition => {
  // Actions are checked against the workflow type by
  // `assertTaskActionsSupported`, where the workflow is known.
  const validation = validateWorkflow(definitionYaml, {
    bindingKinds: RuntimeBindingsService.getRegistry(),
  });

  if (!validation.success) {
    throw new Error(
      `Invalid workflow YAML: ${issueMessages(validation.issues).join('; ')}`,
    );
  }

  return validation.data;
};

/**
 * Refuse a definition with a task whose action workflows of the given type
 * cannot run (`BaseAction.workflowTypes`). An action without workflow types
 * runs in any workflow, and one that is not registered is left to the
 * definition's own validation.
 *
 * @param definition The workflow definition.
 * @param workflowType The type of the workflow the definition belongs to.
 * @param actions The registered actions, by name.
 * @throws Listing each offending task as `<task> (<action>)`.
 */
export const assertTaskActionsSupported = (
  definition: WorkflowDefinition,
  workflowType: WorkflowType,
  actions: Record<string, { workflowTypes?: readonly WorkflowType[] }>,
): void => {
  const unsupported = Object.entries(extractTaskDefinitions(definition.defs))
    .filter(([, task]) => {
      const workflowTypes = actions[task.action]?.workflowTypes;

      return (
        workflowTypes !== undefined && !workflowTypes.includes(workflowType)
      );
    })
    .map(([taskId, task]) => `${taskId} (${task.action})`);

  if (unsupported.length > 0) {
    throw new Error(
      `Actions not available in ${workflowType} workflows: ${unsupported.join(', ')}`,
    );
  }
};

/**
 * Refuse a definition that declares `inputs` for a workflow whose input is
 * fixed by its trigger. Only a manual workflow declares its input: a
 * conversational one is run with the inbound message and a scheduled one
 * with its schedule (`resolveWorkflowInputSchema`), and a schema of their own
 * would be checked against that input on every run.
 *
 * @param definition The workflow definition.
 * @param workflowType The type of the workflow the definition belongs to.
 * @throws When a conversational or scheduled definition declares `inputs`.
 */
export const assertInputsDeclarable = (
  definition: WorkflowDefinition,
  workflowType: WorkflowType,
): void => {
  if (workflowType !== WorkflowType.manual && definition.inputs !== undefined) {
    throw new Error(
      `A ${workflowType} workflow cannot declare "inputs": its input is ` +
        'fixed by its trigger. Remove "inputs" from the definition.',
    );
  }
};

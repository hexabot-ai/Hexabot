/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  issueMessages,
  validateWorkflow,
  WorkflowDefinition,
} from '@hexabot-ai/agentic';

import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';

export const parseWorkflowDefinition = (
  definitionYaml: string,
): WorkflowDefinition => {
  // @todo: we should rather use compile in order to check if
  // actions provided in the yml matches the workflow type (workflowTypes)
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

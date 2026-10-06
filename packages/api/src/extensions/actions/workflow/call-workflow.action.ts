/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JsonValueSchema } from '@hexabot-ai/agentic';
import { z } from 'zod';

import { createAction } from '@/actions/create-action';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import { workflowResourceRef } from '@/workflow/resource-refs';
import {
  AWAITING_CHILD_WORKFLOW_REASON,
  CallWorkflowFailedResult,
  CallWorkflowFinishedResult,
} from '@/workflow/types';

const callWorkflowInputSchema = z.object({
  workflow_id: z.uuid().meta({
    title: 'Workflow',
    description: 'Workflow to call and wait for before continuing.',
    'ui:widget': 'AutoCompleteWidget',
    'ui:options': {
      entity: 'Workflow',
      valueKey: 'id',
      labelKey: 'name',
    },
    ...workflowResourceRef('workflow'),
  }),
  input: z.record(z.string(), JsonValueSchema).optional().meta({
    title: 'Input',
    description:
      'Optional input payload for the called workflow. When omitted, the current trigger input is reused.',
  }),
});
const callWorkflowFinishedSchema = z.object({
  status: z.literal('finished'),
  workflow_id: z.uuid(),
  workflow_run_id: z.uuid(),
  output: z.record(z.string(), z.any()),
});
// The parent is only resumed once the child run has ended.
const callWorkflowResumeSchema = z.union([
  callWorkflowFinishedSchema,
  z.object({
    status: z.literal('failed'),
    workflow_id: z.uuid(),
    workflow_run_id: z.uuid(),
    error: z.string(),
  }),
]);

type CallWorkflowInput = z.infer<typeof callWorkflowInputSchema>;
type CallWorkflowOutput = z.infer<typeof callWorkflowFinishedSchema>;

const assertFinishedResult = (
  result: CallWorkflowFinishedResult | CallWorkflowFailedResult,
) => {
  if (result.status === 'failed') {
    throw new Error(result.error);
  }

  return result;
};

export const CallWorkflowAction = createAction<
  CallWorkflowInput,
  CallWorkflowOutput,
  WorkflowRuntimeContext
>({
  name: 'call_workflow',
  description: 'Calls another workflow and waits for its output.',
  group: 'workflow',
  icon: 'Workflow',
  color: '#64748B',
  inputSchema: callWorkflowInputSchema,
  outputSchema: callWorkflowFinishedSchema,
  async execute({ input, context }) {
    let data: { workflow_id: string; workflow_run_id: string } | undefined;
    // On resume this body runs again from the top. The child was already
    // spawned by the first run, so skip the spawn and let suspend() resolve
    // with the recorded child payload immediately.
    if (!context.workflow.hasRecordedResult()) {
      // AgenticService owns workflow resolution and run creation because the
      // target workflow is an API-persisted entity, not an agentic DSL
      // primitive.
      const result = await context.services.agentic.callWorkflow({
        workflowId: input.workflow_id,
        input: input.input,
        parentContext: context,
      });

      if (result.status !== 'suspended') {
        return assertFinishedResult(result);
      }

      data = {
        workflow_id: result.workflow_id,
        workflow_run_id: result.workflow_run_id,
      };
    }

    // If the child suspends, this action suspends the parent at the call site.
    // A future event resumes the child leaf first; AgenticService then resumes
    // this parent action with the final child payload.
    const resumeData = await context.workflow.suspend({
      reason: AWAITING_CHILD_WORKFLOW_REASON,
      data,
      accepts: callWorkflowResumeSchema,
    });

    return assertFinishedResult(resumeData);
  },
});

export default CallWorkflowAction;

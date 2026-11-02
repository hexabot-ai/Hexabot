/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  AWAITING_APPROVAL_REASON,
  WorkflowApprovalWaitData,
} from '@hexabot-ai/types';
import { z } from 'zod';

import { createAction } from '@/actions/create-action';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import {
  approvalDecisionSchema,
  jsonObjectSchema,
} from '@/workflow/schemas/operator-wait-schemas';

const awaitApprovalInputSchema = z.object({
  message: z.string().min(1).meta({
    title: 'Message',
    description: 'What the admin is asked to approve.',
  }),
  details: jsonObjectSchema.optional().meta({
    title: 'Details',
    description: 'Optional data shown to the admin to support the decision.',
  }),
});
const awaitApprovalSettingsSchema = z.strictObject({
  on_reject: z.enum(['continue', 'fail']).default('continue').meta({
    title: 'On reject',
    description:
      'Continue the workflow with approved set to false, or fail the run when the request is rejected.',
  }),
});
const awaitApprovalOutputSchema = approvalDecisionSchema.extend({
  approved: z.boolean().meta({
    title: 'Approved',
    description: 'Whether the request was approved.',
  }),
});

type AwaitApprovalInput = z.infer<typeof awaitApprovalInputSchema>;
type AwaitApprovalSettings = z.infer<typeof awaitApprovalSettingsSchema>;
type AwaitApprovalOutput = z.infer<typeof awaitApprovalOutputSchema>;

export const AwaitApprovalAction = createAction<
  AwaitApprovalInput,
  AwaitApprovalOutput,
  WorkflowRuntimeContext,
  AwaitApprovalSettings
>({
  name: 'await_approval',
  description:
    'Suspends the run until an admin approves or rejects the request.',
  group: 'workflow',
  icon: 'ShieldCheck',
  color: '#B7791F',
  inputSchema: awaitApprovalInputSchema,
  outputSchema: awaitApprovalOutputSchema,
  settingsSchema: awaitApprovalSettingsSchema,
  async execute({ input, context, settings }) {
    const data: WorkflowApprovalWaitData = {
      message: input.message,
      details: input.details ?? null,
    };
    const decision = await context.workflow.suspend({
      reason: AWAITING_APPROVAL_REASON,
      data,
      accepts: approvalDecisionSchema,
    });
    if (decision.decision === 'rejected' && settings.on_reject === 'fail') {
      throw new Error(
        `Rejected by ${decision.decided_by.name}${decision.comment ? `: ${decision.comment}` : ''}`,
      );
    }

    return { approved: decision.decision === 'approved', ...decision };
  },
});

export default AwaitApprovalAction;

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  AWAITING_RESUME_REASON,
  WorkflowResumeWaitData,
} from '@hexabot-ai/types';
import { z, ZodType } from 'zod';

import { createAction } from '@/actions/create-action';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import {
  buildResumePayloadSchema,
  jsonObjectSchema,
  operatorActorSchema,
} from '@/workflow/schemas/operator-wait-schemas';

const suspendWorkflowInputSchema = z.object({
  message: z.string().optional().meta({
    title: 'Message',
    description: 'What the admin is asked to do before resuming the run.',
  }),
  details: jsonObjectSchema.optional().meta({
    title: 'Details',
    description: 'Optional data shown to the admin.',
  }),
});
const suspendWorkflowSettingsSchema = z.strictObject({
  payload_schema: jsonObjectSchema.optional().meta({
    title: 'Payload schema',
    description:
      'Optional JSON Schema the data sent by the admin must satisfy. Any JSON object is accepted when omitted.',
    'ui:field': 'JsonSchemaObjectField',
  }),
});
const suspendWorkflowOutputSchema = z.object({
  data: z.any().meta({
    title: 'Data',
    description: 'Data sent by the admin who resumed the run.',
  }),
  resumed_by: operatorActorSchema.meta({
    title: 'Resumed by',
    description: 'Admin user who resumed the run.',
  }),
  resumed_at: z.iso.datetime().meta({
    title: 'Resumed at',
    description: 'ISO timestamp of the resume.',
  }),
});

type SuspendWorkflowInput = z.infer<typeof suspendWorkflowInputSchema>;
type SuspendWorkflowSettings = z.infer<typeof suspendWorkflowSettingsSchema>;
type SuspendWorkflowOutput = z.infer<typeof suspendWorkflowOutputSchema>;

/**
 * Build the schema of the data an admin must send to resume the run.
 *
 * @throws When `payloadSchema` is not a JSON Schema zod can read, so the step
 * fails before it suspends rather than opening a wait no payload satisfies.
 */
const buildDataSchema = (
  payloadSchema: Record<string, unknown> | undefined,
): ZodType => {
  if (!payloadSchema) {
    return jsonObjectSchema;
  }

  try {
    return z.fromJSONSchema(
      payloadSchema as Parameters<typeof z.fromJSONSchema>[0],
    );
  } catch (error) {
    throw new Error(
      `suspend_workflow: payload_schema is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const SuspendWorkflowAction = createAction<
  SuspendWorkflowInput,
  SuspendWorkflowOutput,
  WorkflowRuntimeContext,
  SuspendWorkflowSettings
>({
  name: 'suspend_workflow',
  description:
    'Suspends the run until an admin resumes it, optionally with data.',
  group: 'workflow',
  icon: 'Pause',
  color: '#64748B',
  inputSchema: suspendWorkflowInputSchema,
  outputSchema: suspendWorkflowOutputSchema,
  settingsSchema: suspendWorkflowSettingsSchema,
  async execute({ input, context, settings }) {
    const accepts = buildResumePayloadSchema(
      buildDataSchema(settings.payload_schema),
    );
    const data: WorkflowResumeWaitData = {
      message: input.message ?? null,
      details: input.details ?? null,
      payload_schema: settings.payload_schema ?? null,
    };

    return await context.workflow.suspend({
      reason: AWAITING_RESUME_REASON,
      data,
      accepts,
    });
  },
});

export default SuspendWorkflowAction;

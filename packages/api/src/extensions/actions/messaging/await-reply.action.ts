/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Settings } from '@hexabot-ai/agentic';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ExecArgs } from '@/actions';
import { ActionService } from '@/actions/actions.service';
import { BaseAction } from '@/actions/base-action';
import { ConversationalWorkflowContext } from '@/workflow/contexts/conversational-workflow.context';
import { conversationalWorkflowInputZodSchema } from '@/workflow/schemas/workflow-input-schemas';
import { WorkflowType } from '@/workflow/types';

export const awaitReplyResumeSchema =
  conversationalWorkflowInputZodSchema.clone();

type AwaitReplyOutput = z.infer<typeof awaitReplyResumeSchema>;
type AwaitReplySettings = Settings;

@Injectable()
export class AwaitReplyAction extends BaseAction<
  void,
  AwaitReplyOutput,
  ConversationalWorkflowContext,
  AwaitReplySettings
> {
  constructor(actionService: ActionService) {
    super(
      {
        name: 'await_reply',
        description:
          'Suspends the workflow until a subscriber reply is received, returning the incoming message on resume.',
        workflowTypes: [WorkflowType.conversational],
        outputSchema: awaitReplyResumeSchema,
        icon: 'Hourglass',
        color: '#5C6B6B',
        group: 'messaging',
      },
      actionService,
    );
  }

  async execute({
    context,
  }: ExecArgs<void, ConversationalWorkflowContext, AwaitReplySettings>) {
    // A reply that does not match the conversational input is refused: the
    // run keeps waiting on this wait instead of failing.
    return await context.workflow.suspend({
      reason: 'awaiting_user_response',
      data: null,
      accepts: awaitReplyResumeSchema,
    });
  }
}

export default AwaitReplyAction;

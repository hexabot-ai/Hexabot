/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  attachmentPayloadSchema,
  stdQuickReplySchema,
} from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ExecArgs } from '@/actions';
import { ActionService } from '@/actions/actions.service';
import { ConversationalWorkflowContext } from '@/workflow/contexts/conversational-workflow.context';

import {
  MessageAction,
  messageActionOutputSchema,
  MessageActionSettings,
  messageActionSettingsSchema,
} from '../messaging/message-action.base';

const attachmentInputSchema = z.object({
  attachment: attachmentPayloadSchema
    .extend({
      payload: z.object({ id: z.string().min(1) }),
    })
    .meta({
      title: 'Attachment',
      description: 'File attachment submitted via an Attachment action',
      'ui:field': 'ActionAttachmentField',
    }),
  quick_replies: z
    .array(stdQuickReplySchema)
    .optional()
    .default([
      { payload: 'yes', title: 'Yes' },
      { payload: 'no', title: 'No' },
    ])
    .meta({
      title: 'Options',
      description: 'Quick replies options.',
    }),
});

type AttachmentInput = z.infer<typeof attachmentInputSchema>;
type AttachmentSettings = MessageActionSettings;

const attachmentSettingsSchema = messageActionSettingsSchema;

@Injectable()
export class SendAttachmentAction extends MessageAction<
  AttachmentInput,
  AttachmentSettings
> {
  constructor(actionService: ActionService) {
    super(
      {
        name: 'send_attachment',
        description: 'Sends an attachment message to the subscriber.',
        inputSchema: attachmentInputSchema,
        outputSchema: messageActionOutputSchema,
        settingsSchema: attachmentSettingsSchema,
      },
      actionService,
    );
  }

  async execute({
    input,
    context,
    settings,
  }: ExecArgs<
    AttachmentInput,
    ConversationalWorkflowContext,
    AttachmentSettings
  >) {
    const prepared = await this.prepare(context);
    const envelope = prepared.envelopeFactory.buildAttachmentEnvelope(
      input.attachment,
      input.quick_replies ?? [],
    );

    return this.sendPreparedMessage(context, prepared, envelope, settings);
  }
}

export default SendAttachmentAction;

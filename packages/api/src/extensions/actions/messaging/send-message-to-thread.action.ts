/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  stdOutgoingAttachmentMessageSchema,
  stdOutgoingButtonsMessageSchema,
  stdOutgoingCarouselMessageSchema,
  stdOutgoingListMessageSchema,
  stdOutgoingQuickRepliesMessageSchema,
  stdOutgoingTextMessageSchema,
} from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAction, ExecArgs } from '@/actions';
import { ActionService } from '@/actions/actions.service';
import { StatsType } from '@/analytics/entities/stats.entity';
import { OutboundMessageService } from '@/channel/services/outbound-message.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { sentMessageSchema } from './message-action.base';

// The same envelopes as `stdOutgoingMessageSchema`, titled so the form of the
// workflow editor can name each format.
const messageSchema = z.discriminatedUnion('type', [
  stdOutgoingTextMessageSchema.meta({ title: 'Text' }),
  stdOutgoingQuickRepliesMessageSchema.meta({ title: 'Quick replies' }),
  stdOutgoingButtonsMessageSchema.meta({ title: 'Buttons' }),
  stdOutgoingListMessageSchema.meta({ title: 'List' }),
  stdOutgoingCarouselMessageSchema.meta({ title: 'Carousel' }),
  stdOutgoingAttachmentMessageSchema.meta({ title: 'Attachment' }),
]);
const sendMessageToThreadInputSchema = z
  .object({
    thread_id: z.uuid().optional().meta({
      title: 'Thread ID',
      description:
        'Thread to send the message on. Give either a thread or a subscriber.',
    }),
    subscriber_id: z.uuid().optional().meta({
      title: 'Subscriber ID',
      description:
        'Subscriber to send the message to, on their latest open thread or on a new one.',
    }),
    message: messageSchema.meta({
      title: 'Message',
      description: 'The message to send, as an envelope `{ type, data }`.',
    }),
  })
  .superRefine((input, ctx) => {
    if (!input.thread_id === !input.subscriber_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'Give either `thread_id` or `subscriber_id`',
        path: [input.thread_id ? 'subscriber_id' : 'thread_id'],
      });
    }
  });
const sendMessageToThreadOutputSchema = z.object({
  sent: sentMessageSchema,
  thread_id: z.uuid(),
  subscriber_id: z.uuid(),
});

type SendMessageToThreadInput = z.infer<typeof sendMessageToThreadInputSchema>;
type SendMessageToThreadOutput = z.infer<
  typeof sendMessageToThreadOutputSchema
>;

/**
 * Sends a message to a subscriber who did not start the run: the outcome of
 * an approval, a reminder from a scheduled workflow, a notice to someone else
 * than the subscriber a conversation is with.
 *
 * The other messaging actions answer the event that started the run, so they
 * only run in conversational workflows.
 */
@Injectable()
export class SendMessageToThreadAction extends BaseAction<
  SendMessageToThreadInput,
  SendMessageToThreadOutput,
  WorkflowRuntimeContext
> {
  constructor(
    actionService: ActionService,
    private readonly outboundMessageService: OutboundMessageService,
  ) {
    super(
      {
        name: 'send_message_to_thread',
        description:
          'Sends a message on a thread, or to a subscriber on their latest open thread, whoever started the workflow.',
        group: 'messaging',
        icon: 'Send',
        color: '#e47800',
        inputSchema: sendMessageToThreadInputSchema,
        outputSchema: sendMessageToThreadOutputSchema,
      },
      actionService,
    );
  }

  async execute({
    input,
    context,
  }: ExecArgs<SendMessageToThreadInput, WorkflowRuntimeContext>) {
    const options = { origin: 'workflow' };
    const { mid, channel, thread, recipient } = input.thread_id
      ? await this.outboundMessageService.sendToThread(
          input.thread_id,
          input.message,
          options,
        )
      : await this.outboundMessageService.sendToSubscriber(
          // The input schema requires one of the two ids.
          input.subscriber_id as string,
          input.message,
          options,
        );

    context.eventEmitter.emit(
      'hook:stats:entry',
      StatsType.outgoing,
      'Outgoing',
    );
    context.eventEmitter.emit(
      'hook:stats:entry',
      StatsType.all_messages,
      'All Messages',
    );

    return {
      sent: {
        mid,
        channel,
        type: input.message.type,
        envelope: input.message,
      },
      thread_id: thread.id,
      subscriber_id: recipient.id,
    };
  }
}

export default SendMessageToThreadAction;

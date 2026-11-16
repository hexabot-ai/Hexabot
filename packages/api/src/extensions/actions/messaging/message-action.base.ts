/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Subscriber,
  StdIncomingMessage,
  stdIncomingMessageSchema,
  StdOutgoingMessage,
  StdOutgoingMessageEnvelope,
  stdOutgoingMessageSchema,
} from '@hexabot-ai/types';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { BaseAction } from '@/actions/base-action';
import { ActionMetadata } from '@/actions/types';
import { StatsType } from '@/analytics/entities/stats.entity';
import { MessageInboundEvent } from '@/channel/lib/inbound-events';
import { MessageCreateDto } from '@/chat/dto/message.dto';
import { EnvelopeFactory } from '@/chat/helpers/envelope-factory';
import { ConversationalWorkflowContext } from '@/workflow/contexts/conversational-workflow.context';
import { WorkflowType } from '@/workflow/types';

const sentFormats = [
  'text',
  'quickReply',
  'buttons',
  'list',
  'carousel',
  'attachment',
] as const;

export const sentMessageSchema = z.object({
  mid: z.string().optional(),
  channel: z.string(),
  type: z.enum(sentFormats),
  envelope: stdOutgoingMessageSchema,
});

type SentMessageFormat = (typeof sentFormats)[number];

export type SentMessageInfo = {
  mid?: string;
  channel: string;
  type: SentMessageFormat;
  envelope: StdOutgoingMessage;
};

export type MessageActionOutput = {
  sent: SentMessageInfo;
  reply?: StdIncomingMessage;
};

export const messageActionOutputSchema = z.object({
  sent: sentMessageSchema,
  reply: stdIncomingMessageSchema.optional(),
});

interface PreparedMessageContext {
  event: MessageInboundEvent;
  recipient: Subscriber;
  envelopeFactory: EnvelopeFactory;
}

export const messageActionSettingsSchema = z.strictObject({
  typing: z
    .int()
    .nonnegative()
    .default(0)
    .optional()
    .meta({ title: 'Typing indicator (ms)' }),
});

export type MessageActionSettings = z.infer<typeof messageActionSettingsSchema>;

export abstract class MessageAction<
  I,
  S = MessageActionSettings,
> extends BaseAction<I, MessageActionOutput, ConversationalWorkflowContext, S> {
  private static readonly DEFAULT_ICON = 'MessageSquare';

  private static readonly DEFAULT_COLOR = '#e47800';

  private static readonly DEFAULT_GROUP = 'messaging';

  protected constructor(
    metadata: ActionMetadata<I, MessageActionOutput, S>,
    actionService: ActionService,
  ) {
    super(
      {
        ...metadata,
        icon: metadata.icon ?? MessageAction.DEFAULT_ICON,
        color: metadata.color ?? MessageAction.DEFAULT_COLOR,
        group: metadata.group ?? MessageAction.DEFAULT_GROUP,
        workflowTypes: [WorkflowType.conversational],
      },
      actionService,
    );
  }

  private ensureEvent(context: ConversationalWorkflowContext) {
    if (!context.event) {
      throw new Error('Missing event on workflow context');
    }

    return context.event;
  }

  protected async prepare(
    context: ConversationalWorkflowContext,
  ): Promise<PreparedMessageContext> {
    const event = this.ensureEvent(context);
    const recipient = event.getInitiator();

    if (!recipient) {
      throw new Error('Missing recipient on event');
    }

    const envelopeFactory = new EnvelopeFactory();

    return {
      event,
      recipient,
      envelopeFactory,
    };
  }

  protected async sendPreparedMessage(
    workflowContext: ConversationalWorkflowContext,
    prepared: PreparedMessageContext,
    envelope: StdOutgoingMessageEnvelope,
    // settings: S,
    input?: any,
  ): Promise<MessageActionOutput> {
    const { event, recipient } = prepared;
    const eventEmitter = workflowContext.eventEmitter!;
    const { logger } = workflowContext.services;
    const options = this.resolveMessageOptions(input);
    const sendOptions = options ?? {};

    logger.debug('Sending action message ... ', event.getSenderForeignId());
    const response = await event
      .getHandler()
      .sendMessage(event, envelope, sendOptions);

    eventEmitter.emit('hook:stats:entry', StatsType.outgoing, 'Outgoing');
    eventEmitter.emit(
      'hook:stats:entry',
      StatsType.all_messages,
      'All Messages',
    );

    const mid = response && 'mid' in response ? response.mid : undefined;
    const sent: SentMessageInfo = {
      mid,
      channel: event.getHandler().getName(),
      type: envelope.type,
      envelope,
    };
    const threadId = event.getThreadId();
    if (!threadId) {
      throw new Error('Missing thread id on conversational event');
    }
    const sentMessage: MessageCreateDto = {
      mid: mid ?? '',
      message: envelope,
      recipient: recipient.id,
      thread: threadId,
      handover: false,
      read: false,
      delivery: false,
    };
    await eventEmitter.emitAsync('hook:chatbot:sent', sentMessage);

    return { sent };
  }

  protected async prepareAndSendMessage(
    workflowContext: ConversationalWorkflowContext,
    envelope: StdOutgoingMessageEnvelope,
    settings: S,
  ): Promise<MessageActionOutput> {
    const prepared = await this.prepare(workflowContext);

    return this.sendPreparedMessage(
      workflowContext,
      prepared,
      envelope,
      settings,
    );
  }

  protected resolveMessageOptions(input: I): Record<string, any> | undefined {
    if (input['typing'] === undefined) {
      return undefined;
    }

    return { typing: input['typing'] };
  }
}

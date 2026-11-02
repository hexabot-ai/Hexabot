/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  IncomingMessageType,
  OutgoingMessageType,
  StdOutgoingMessageEnvelope,
} from '@hexabot-ai/types';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { StatsType } from '@/analytics/entities/stats.entity';
import { MessageInboundEvent } from '@/channel/lib/inbound-events';
import { EnvelopeFactory } from '@/chat/helpers/envelope-factory';
import { ConversationalWorkflowContext } from '@/workflow/contexts/conversational-workflow.context';

import {
  MessageAction,
  MessageActionSettings,
  messageActionSettingsSchema,
} from './message-action.base';

class TestMessageAction extends MessageAction<any> {
  constructor(actionService: ActionService) {
    super(
      {
        name: 'test_message_action',
        description: 'test message action',
        inputSchema: z.any(),
        outputSchema: z.any(),
        settingsSchema: messageActionSettingsSchema,
      },
      actionService,
    );
  }

  async execute() {
    return null as any;
  }
}

type MockEvent = jest.Mocked<MessageInboundEvent>;

describe('MessageAction base', () => {
  let actionService: ActionService;
  let action: TestMessageAction;
  let settingsService: { getSettings: jest.Mock };
  let i18n: { t: jest.Mock };
  let logger: {
    debug: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let eventEmitter: { emit: jest.Mock; emitAsync: jest.Mock };
  let handler: { getName: jest.Mock; sendMessage: jest.Mock };
  let recipient: any;
  let event: MockEvent;
  let workflow: { suspend: jest.Mock };

  const buildWorkflowContext = (
    overrides: Partial<ConversationalWorkflowContext> = {},
  ): ConversationalWorkflowContext =>
    ({
      event,
      services: {
        settings: settingsService,
        i18n,
        logger,
      },
      eventEmitter,
      workflow,
      workflowRunId: 'run-123',
      ...overrides,
    }) as unknown as ConversationalWorkflowContext;

  beforeEach(() => {
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new TestMessageAction(actionService);

    settingsService = {
      getSettings: jest.fn().mockResolvedValue({ contact: {} }),
    };
    i18n = {
      t: jest.fn((_key, opts) => opts?.defaultValue ?? _key),
    };
    logger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    eventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue(undefined),
    };
    handler = {
      getName: jest.fn(() => 'web'),
      sendMessage: jest.fn().mockResolvedValue({ mid: 'server-mid' }),
    };
    recipient = {
      id: 'recipient-id',
      firstName: 'Recipient',
      lastName: 'User',
      language: 'fr',
    };
    event = {
      getInitiator: jest.fn(() => recipient),
      getSenderForeignId: jest.fn(() => 'foreign-123'),
      getHandler: jest.fn(() => handler as any),
      getThreadId: jest.fn(() => 'thread-1'),
      getMessage: jest.fn(() => ({
        type: IncomingMessageType.text,
        data: { text: 'incoming-message' },
      })),
    } as unknown as MockEvent;
    workflow = {
      suspend: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('throws when event is missing on the workflow context', async () => {
    const context = buildWorkflowContext({ event: undefined as any });

    await expect((action as any).prepare(context)).rejects.toThrow(
      'Missing event on workflow context',
    );
    expect(settingsService.getSettings).not.toHaveBeenCalled();
  });

  it('throws when recipient is missing on the event', async () => {
    const context = buildWorkflowContext({
      event: {
        ...event,
        getInitiator: jest.fn(() => undefined),
      } as unknown as MockEvent,
    });

    await expect((action as any).prepare(context)).rejects.toThrow(
      'Missing recipient on event',
    );
  });

  it('prepares the recipient and envelope factory', async () => {
    const prepared = await (action as any).prepare(buildWorkflowContext());

    expect(settingsService.getSettings).not.toHaveBeenCalled();
    expect(prepared.recipient).toBe(recipient);
    expect(prepared.envelopeFactory).toBeInstanceOf(EnvelopeFactory);
  });

  it('sends the message, emits stats, and returns sent metadata', async () => {
    const context = buildWorkflowContext();
    const prepared = await (action as any).prepare(context);
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.text,
      data: { text: 'hi' },
    };
    const result = await (action as any).sendPreparedMessage(
      context,
      prepared,
      envelope,
      { typing: 200 } as MessageActionSettings,
    );

    expect(logger.debug).toHaveBeenCalledWith(
      'Sending action message ... ',
      'foreign-123',
    );
    expect(handler.sendMessage).toHaveBeenCalledWith(prepared.event, envelope, {
      typing: 200,
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'hook:stats:entry',
      StatsType.outgoing,
      'Outgoing',
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'hook:stats:entry',
      StatsType.all_messages,
      'All Messages',
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith('hook:chatbot:sent', {
      mid: 'server-mid',
      message: envelope,
      recipient: recipient.id,
      thread: 'thread-1',
      handover: false,
      read: false,
      delivery: false,
    });
    expect(result).toEqual({
      sent: {
        mid: 'server-mid',
        channel: 'web',
        type: OutgoingMessageType.text,
        envelope,
      },
    });
  });

  it('returns sent metadata when no mid is provided by handler', async () => {
    const context = buildWorkflowContext();
    const prepared = await (action as any).prepare(context);
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.quickReply,
      data: { text: 'question', quickReplies: [] },
    };
    handler.sendMessage.mockResolvedValueOnce({});

    const result = await (action as any).sendPreparedMessage(
      context,
      prepared,
      envelope,
      {} as MessageActionSettings,
    );

    expect(handler.sendMessage).toHaveBeenCalledWith(
      prepared.event,
      envelope,
      {},
    );
    expect(result).toEqual({
      sent: {
        mid: undefined,
        channel: 'web',
        type: OutgoingMessageType.quickReply,
        envelope,
      },
    });
  });

  it('delegates send flow through prepareAndSendMessage', async () => {
    const context = buildWorkflowContext();
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.text,
      data: { text: 'hi' },
    };
    const prepared = await (action as any).prepare(context);
    const sendSpy = jest
      .spyOn(action as any, 'sendPreparedMessage')
      .mockResolvedValue('sent');
    const prepareSpy = jest
      .spyOn(action as any, 'prepare')
      .mockResolvedValue(prepared);
    const result = await (action as any).prepareAndSendMessage(
      context,
      envelope,
      {} as MessageActionSettings,
    );

    expect(prepareSpy).toHaveBeenCalledWith(context);
    expect(sendSpy).toHaveBeenCalledWith(
      context,
      prepared,
      envelope,
      {} as MessageActionSettings,
    );
    expect(result).toBe('sent');
  });

  it('returns message options only when typing is provided', () => {
    expect(
      (action as any).resolveMessageOptions({ typing: undefined }),
    ).toBeUndefined();
    expect((action as any).resolveMessageOptions({ typing: false })).toEqual({
      typing: false,
    });
    expect((action as any).resolveMessageOptions({ typing: 3 })).toEqual({
      typing: 3,
    });
  });
});

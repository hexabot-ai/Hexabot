/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Message,
  OutgoingMessageType,
  StdOutgoingMessage,
  Thread,
  ThreadFull,
} from '@hexabot-ai/types';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { MessageInboundEvent } from '@/channel/lib/inbound-events';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { ThreadService } from '@/chat/services/thread.service';
import { installMessageFixturesTypeOrm } from '@/utils/test/fixtures/message';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { ChannelRegistry } from './channel-registry.service';
import {
  OutboundMessageRefusedError,
  OutboundMessageService,
} from './outbound-message.service';

const envelope: StdOutgoingMessage = {
  type: OutgoingMessageType.text,
  data: { text: 'Your request was approved' },
};

describe('OutboundMessageService (TypeORM)', () => {
  let service: OutboundMessageService;
  let threadService: ThreadService;
  let messageService: MessageService;
  let subscriberService: SubscriberService;
  let eventEmitter: EventEmitter2;
  let thread: ThreadFull;
  let emitAsync: jest.SpyInstance;

  const sendMessage = jest.fn();
  const handler = { sendMessage };
  const channelRegistry = { findChannel: jest.fn() };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        OutboundMessageService,
        { provide: ChannelRegistry, useValue: channelRegistry },
        { provide: WEBSOCKET_GATEWAY, useValue: { joinSockets: jest.fn() } },
      ],
      typeorm: {
        fixtures: installMessageFixturesTypeOrm,
      },
    });
    [service, threadService, messageService, subscriberService, eventEmitter] =
      await testing.getMocks([
        OutboundMessageService,
        ThreadService,
        MessageService,
        SubscriberService,
        EventEmitter2,
      ]);

    const [message] = await messageService.find({ take: 1 });
    const populated = message
      ? await threadService.findOneAndPopulate(message.thread)
      : null;
    if (!populated) {
      throw new Error('Expected the fixtures to seed a thread with messages');
    }
    thread = populated;
  });

  beforeEach(() => {
    sendMessage.mockResolvedValue({ mid: 'mid-sent' });
    channelRegistry.findChannel.mockReturnValue(handler);
    emitAsync = jest.spyOn(eventEmitter, 'emitAsync').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('sends the message through the channel of the subscriber of the thread', async () => {
    const sent = await service.sendToThread(thread.id, envelope, {
      origin: 'spec',
    });

    expect(channelRegistry.findChannel).toHaveBeenCalledWith(
      thread.subscriber.channel.name,
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [event, sentEnvelope, options] = sendMessage.mock.calls[0] as [
      MessageInboundEvent,
      StdOutgoingMessage,
      Record<string, unknown>,
    ];
    expect(sentEnvelope).toBe(envelope);
    expect(options).toEqual({});
    expect(event.getHandler()).toBe(handler);
    expect(event.getChannel()).toBe(thread.subscriber.channel.name);
    expect(event.getInitiator().id).toBe(thread.subscriber.id);
    expect(event.getSenderForeignId()).toBe(thread.subscriber.foreignId);
    expect(event.getThreadId()).toBe(thread.id);
    expect(event.getSourceId()).toBe(thread.source.id);
    expect(event.getSourceSettings()).toEqual(thread.source.settings);
    expect(event.getRaw()).toEqual({ source: 'spec' });
    expect(sent).toMatchObject({
      mid: 'mid-sent',
      channel: thread.subscriber.channel.name,
      thread: { id: thread.id },
      recipient: { id: thread.subscriber.id },
    });
  });

  it('logs the sent message in the thread before returning', async () => {
    let logged = false;
    emitAsync.mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      logged = true;

      return [];
    });

    await service.sendToThread(thread.id, envelope, { sentBy: 'user-1' });

    expect(logged).toBe(true);
    expect(emitAsync).toHaveBeenCalledTimes(1);
    expect(emitAsync).toHaveBeenCalledWith('hook:chatbot:sent', {
      mid: 'mid-sent',
      recipient: thread.subscriber.id,
      thread: thread.id,
      message: envelope,
      sentBy: 'user-1',
      read: false,
      delivery: false,
      handover: false,
    });
  });

  it('answers the last message of the thread unless told which one', async () => {
    const findLastMessages = jest
      .spyOn(messageService, 'findLastMessages')
      .mockResolvedValue([{ mid: 'mid-last' } as Message]);

    await service.sendToThread(thread.id, envelope);
    await service.sendToThread(thread.id, envelope, { inReplyTo: 'mid-1' });

    const [byDefault, explicit] = sendMessage.mock.calls.map(
      ([event]) => event as MessageInboundEvent,
    );
    expect(findLastMessages).toHaveBeenCalledTimes(1);
    expect(findLastMessages).toHaveBeenCalledWith({ id: thread.id }, 1);
    expect(byDefault.getId()).toBe('mid-last');
    expect(explicit.getId()).toBe('mid-1');
  });

  it('gives the event an id of its own in a thread without messages', async () => {
    jest.spyOn(messageService, 'findLastMessages').mockResolvedValue([]);

    await service.sendToThread(thread.id, envelope);

    const [event] = sendMessage.mock.calls[0] as [MessageInboundEvent];
    expect(event.getId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets the failure of the channel through and logs nothing', async () => {
    sendMessage.mockRejectedValue(new Error('channel is down'));

    await expect(service.sendToThread(thread.id, envelope)).rejects.toThrow(
      'channel is down',
    );
    expect(emitAsync).not.toHaveBeenCalled();
  });

  describe('sendToSubscriber', () => {
    let resolveThreadForOutgoing: jest.SpyInstance;

    beforeEach(() => {
      resolveThreadForOutgoing = jest
        .spyOn(threadService, 'resolveThreadForOutgoing')
        .mockResolvedValue({ id: thread.id } as Thread);
    });

    it('sends the message on the thread resolved for the subscriber', async () => {
      const sent = await service.sendToSubscriber(
        thread.subscriber.id,
        envelope,
        { origin: 'spec' },
      );

      expect(resolveThreadForOutgoing).toHaveBeenCalledWith(
        thread.subscriber.id,
      );
      const [event, sentEnvelope] = sendMessage.mock.calls[0] as [
        MessageInboundEvent,
        StdOutgoingMessage,
      ];
      expect(sentEnvelope).toBe(envelope);
      expect(event.getInitiator().id).toBe(thread.subscriber.id);
      expect(event.getThreadId()).toBe(thread.id);
      expect(event.getSourceId()).toBe(thread.source.id);
      expect(event.getRaw()).toEqual({ source: 'spec' });
      expect(emitAsync).toHaveBeenCalledWith(
        'hook:chatbot:sent',
        expect.objectContaining({
          mid: 'mid-sent',
          recipient: thread.subscriber.id,
          thread: thread.id,
        }),
      );
      expect(sent).toMatchObject({
        mid: 'mid-sent',
        thread: { id: thread.id },
        recipient: { id: thread.subscriber.id },
      });
    });

    it.each([
      [
        'who does not exist',
        'subscriber_not_found',
        () => jest.spyOn(subscriberService, 'findOne').mockResolvedValue(null),
      ],
      [
        'whose channel is not registered',
        'channel_unavailable',
        () => channelRegistry.findChannel.mockReturnValue(undefined),
      ],
    ])(
      'refuses a subscriber %s without opening a thread',
      async (_case, code, arrange) => {
        arrange();

        const error = await service
          .sendToSubscriber(thread.subscriber.id, envelope)
          .catch((err: unknown) => err);

        expect(error).toBeInstanceOf(OutboundMessageRefusedError);
        expect(error).toMatchObject({ code });
        expect(resolveThreadForOutgoing).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
      },
    );
  });

  describe('refusals', () => {
    const expectRefusal = async (threadId: string, code: string) => {
      const error = await service
        .sendToThread(threadId, envelope)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(OutboundMessageRefusedError);
      expect(error).toMatchObject({ code });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(emitAsync).not.toHaveBeenCalled();

      return error as OutboundMessageRefusedError;
    };

    it('refuses a thread that does not exist', async () => {
      const id = '99999999-9999-4999-8999-999999999999';
      const error = await expectRefusal(id, 'thread_not_found');

      expect(error.message).toBe(`Thread with ID ${id} not found`);
    });

    it('refuses a thread whose subscriber is gone', async () => {
      jest.spyOn(subscriberService, 'findOne').mockResolvedValue(null);

      await expectRefusal(thread.id, 'subscriber_not_found');
    });

    it('refuses a subscriber whose channel is not registered', async () => {
      channelRegistry.findChannel.mockReturnValue(undefined);

      const error = await expectRefusal(thread.id, 'channel_unavailable');

      expect(error.message).toBe('Subscriber channel not found');
    });

    it('refuses a subscriber the channel cannot address', async () => {
      const subscriber = await subscriberService.findOne(thread.subscriber.id);
      jest
        .spyOn(subscriberService, 'findOne')
        .mockResolvedValue({ ...subscriber!, foreignId: '' });

      const error = await expectRefusal(thread.id, 'recipient_unreachable');

      expect(error.message).toBe('Subscriber foreign ID is missing');
    });
  });
});

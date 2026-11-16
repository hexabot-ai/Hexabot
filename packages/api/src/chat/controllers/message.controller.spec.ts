/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Message, MessageFull } from '@hexabot-ai/types';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  OutboundMessageRefusedError,
  OutboundMessageService,
} from '@/channel/services/outbound-message.service';
import { MessageService } from '@/chat/services/message.service';
import {
  installMessageFixturesTypeOrm,
  messageFixtures,
} from '@/utils/test/fixtures/message';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { MessageController } from './message.controller';

describe('MessageController (TypeORM)', () => {
  let messageController: MessageController;
  let messageService: MessageService;

  let plainMessages: Message[];
  let populatedMessages: MessageFull[];
  let referencePlain: Message;
  let referencePopulated: MessageFull;

  const outboundMessageServiceMock = {
    sendToThread: jest.fn(),
  };
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  };
  const defaultOrder = { order: { createdAt: 'ASC' as const } };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [MessageController],
      providers: [
        {
          provide: OutboundMessageService,
          useValue: outboundMessageServiceMock,
        },
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: websocketGatewayMock,
        },
      ],
      typeorm: {
        fixtures: installMessageFixturesTypeOrm,
      },
    });

    [messageController, messageService] = await testing.getMocks([
      MessageController,
      MessageService,
    ]);

    plainMessages = await messageService.find(defaultOrder);
    populatedMessages = await messageService.findAndPopulate(defaultOrder);

    const targetMid = messageFixtures[0]?.mid ?? null;

    referencePlain =
      plainMessages.find((message) => message.mid === targetMid) ??
      plainMessages[0];

    referencePopulated =
      populatedMessages.find((message) => message.mid === targetMid) ??
      populatedMessages[0];

    if (!referencePlain || !referencePopulated) {
      throw new Error('Expected message fixtures to seed at least one message');
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('findOne', () => {
    it('should find message by id with populated relations', async () => {
      const populateSpy = jest.spyOn(messageService, 'findOneAndPopulate');
      const result = await messageController.findMessage(referencePlain.id, [
        'sender',
        'recipient',
        'sentBy',
      ]);

      expect(populateSpy).toHaveBeenCalledWith(referencePlain.id);
      expect(result).toEqualPayload(referencePopulated);
    });

    it('should find message by id without populating relations', async () => {
      const findSpy = jest.spyOn(messageService, 'findOne');
      const result = await messageController.findMessage(referencePlain.id, []);

      expect(findSpy).toHaveBeenCalledWith(referencePlain.id);
      expect(result).toEqualPayload(referencePlain);
    });
  });

  describe('findPage', () => {
    it('should find messages without populating relations when none requested', async () => {
      const findSpy = jest.spyOn(messageService, 'find');
      const result = await messageController.findMessages([], defaultOrder);

      expect(findSpy).toHaveBeenCalledWith(defaultOrder);
      expect(result).toEqualPayload(plainMessages);
    });

    it('should find messages and populate requested relations', async () => {
      const populateSpy = jest.spyOn(messageService, 'findAndPopulate');
      const result = await messageController.findMessages(
        ['sender', 'recipient', 'sentBy'],
        defaultOrder,
      );

      expect(populateSpy).toHaveBeenCalledWith(defaultOrder);
      expect(result).toEqualPayload(populatedMessages);
    });

    it('should filter messages by thread id', async () => {
      const threadId = referencePlain.thread;
      const result = await messageController.findMessages([], {
        where: {
          thread: { id: threadId },
        },
      } as any);

      expect(result.every((message) => message.thread === threadId)).toBe(true);
    });
  });

  describe('create', () => {
    const req = {
      session: {
        passport: {
          user: { id: 'user-1' },
        },
      },
    } as any;
    const message = { type: 'text', data: { text: 'Hello from the Inbox' } };
    const send = () =>
      messageController.create(
        {
          thread: referencePlain.thread,
          inReplyTo: 'mid-1',
          message,
        } as any,
        req,
      );

    it('requires thread id in send payload', async () => {
      await expect(
        messageController.create({ message } as any, req),
      ).rejects.toThrow('MessageController send : thread id is required');
      expect(outboundMessageServiceMock.sendToThread).not.toHaveBeenCalled();
    });

    it('sends the message on the thread as the authenticated user', async () => {
      outboundMessageServiceMock.sendToThread.mockResolvedValue({
        mid: 'mid-created',
      });

      await expect(send()).resolves.toEqual({ success: true });
      expect(outboundMessageServiceMock.sendToThread).toHaveBeenCalledTimes(1);
      expect(outboundMessageServiceMock.sendToThread).toHaveBeenCalledWith(
        referencePlain.thread,
        message,
        {
          inReplyTo: 'mid-1',
          sentBy: 'user-1',
          origin: 'message-controller',
        },
      );
    });

    it.each([
      ['thread_not_found', 'Thread with ID x not found', NotFoundException],
      [
        'subscriber_not_found',
        'Subscriber with ID x not found',
        NotFoundException,
      ],
      [
        'channel_unavailable',
        'Subscriber channel not found',
        BadRequestException,
      ],
      [
        'recipient_unreachable',
        'Subscriber foreign ID is missing',
        BadRequestException,
      ],
    ] as const)(
      'answers a %s refusal with its reason',
      async (code, reason, exception) => {
        outboundMessageServiceMock.sendToThread.mockRejectedValue(
          new OutboundMessageRefusedError(code, reason),
        );

        const error = await send().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(exception);
        expect(error).toMatchObject({ message: reason });
      },
    );

    it('hides why the channel failed to send the message', async () => {
      outboundMessageServiceMock.sendToThread.mockRejectedValue(
        new Error('channel is down'),
      );

      const error = await send().catch((err: unknown) => err);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: 'MessageController send : unable to send message',
      });
    });
  });
});

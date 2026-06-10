/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Message, MessageFull } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import { ChannelService } from '@/channel/channel.service';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import {
  installMessageFixturesTypeOrm,
  messageFixtures,
} from '@/utils/test/fixtures/message';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { MessageController } from './message.controller';

describe('MessageController (TypeORM)', () => {
  let module: TestingModule;
  let messageController: MessageController;
  let messageService: MessageService;

  let plainMessages: Message[];
  let populatedMessages: MessageFull[];
  let referencePlain: Message;
  let referencePopulated: MessageFull;

  const subscriberServiceMock: Partial<SubscriberService> = {
    findOne: jest.fn(),
    findOneAndPopulate: jest.fn(),
  };
  const channelServiceMock: Partial<ChannelService> = {
    findChannel: jest.fn(),
    getChannelHandler: jest.fn(),
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
          provide: SubscriberService,
          useValue: subscriberServiceMock,
        },
        {
          provide: ChannelService,
          useValue: channelServiceMock,
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

    module = testing.module;

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

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
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
    it('requires thread id in send payload', async () => {
      const req = {
        session: {
          passport: {
            user: { id: 'user-1' },
          },
        },
      } as any;

      await expect(
        messageController.create(
          {
            message: { text: 'Hello' } as any,
          } as any,
          req,
        ),
      ).rejects.toThrow('MessageController send : thread id is required');
    });

    it('sends message using thread-first payload and emits sent event', async () => {
      const thread = referencePopulated.thread;
      const subscriber =
        referencePopulated.sender ?? referencePopulated.recipient;
      if (!thread || !subscriber) {
        throw new Error(
          'Expected reference message to include thread and subscriber',
        );
      }
      const sendMessage = jest.fn().mockResolvedValue({ mid: 'mid-created' });
      const emitSpy = jest.spyOn(
        (messageController as any).eventEmitter,
        'emit',
      );
      const req = {
        session: {
          passport: {
            user: { id: 'user-1' },
          },
        },
      } as any;

      (subscriberServiceMock.findOne as jest.Mock).mockResolvedValue(
        subscriber,
      );
      (channelServiceMock.findChannel as jest.Mock).mockReturnValue(true);
      (channelServiceMock.getChannelHandler as jest.Mock).mockReturnValue({
        sendMessage,
      });

      const result = await messageController.create(
        {
          thread: thread.id,
          inReplyTo: referencePlain.mid ?? undefined,
          message: { text: 'Hello from thread API' } as any,
        } as any,
        req,
      );

      expect(result).toEqual({ success: true });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(
        'hook:chatbot:sent',
        expect.objectContaining({
          mid: 'mid-created',
          recipient: subscriber.id,
          thread: thread.id,
        }),
        expect.anything(),
      );
    });
  });
});

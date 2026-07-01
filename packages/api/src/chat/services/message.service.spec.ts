/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Message, MessageFull, Thread } from '@hexabot-ai/types';

import { MessageRepository } from '@/chat/repositories/message.repository';
import { MessageService } from '@/chat/services/message.service';
import {
  installMessageFixturesTypeOrm,
  messageFixtures,
} from '@/utils/test/fixtures/message';
import { buildTestingMocks } from '@/utils/test/utils';

describe('MessageService (TypeORM)', () => {
  let messageService: MessageService;
  let messageRepository: MessageRepository;

  let plainMessages: Message[];
  let populatedMessages: MessageFull[];
  let referencePlain: Message;
  let referencePopulated: MessageFull;
  let referenceThread: Thread;
  let threadMessagesDesc: Message[];

  const orderByCreatedAtAsc = { order: { createdAt: 'ASC' as const } };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [MessageService],
      typeorm: {
        fixtures: installMessageFixturesTypeOrm,
      },
    });

    [messageService, messageRepository] = await testing.getMocks([
      MessageService,
      MessageRepository,
    ]);

    plainMessages = await messageService.find(orderByCreatedAtAsc);
    populatedMessages =
      await messageService.findAndPopulate(orderByCreatedAtAsc);

    if (!plainMessages.length || !populatedMessages.length) {
      throw new Error('Expected seeded message fixtures to be available');
    }

    const targetMid = messageFixtures[0]?.mid ?? null;
    referencePlain =
      plainMessages.find((message) => message.mid === targetMid) ??
      plainMessages[0];
    referencePopulated =
      populatedMessages.find((message) => message.mid === targetMid) ??
      populatedMessages[0];

    if (!referencePopulated) {
      throw new Error('Unable to resolve a reference message from fixtures');
    }

    if (!referencePopulated.thread) {
      throw new Error('Expected reference message to include a thread');
    }

    referenceThread = referencePopulated.thread;
    threadMessagesDesc = plainMessages
      .filter((message) => message.thread === referenceThread.id)
      .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  describe('findOneAndPopulate', () => {
    it('finds a message by id and populates relations', async () => {
      const spy = jest.spyOn(messageRepository, 'findOneAndPopulate');
      const result = await messageService.findOneAndPopulate(referencePlain.id);

      expect(spy).toHaveBeenCalledWith(referencePlain.id);
      expect(result).toEqualPayload(referencePopulated);

      spy.mockRestore();
    });
  });

  describe('findAndPopulate', () => {
    it('retrieves messages and populates requested relations', async () => {
      const spy = jest.spyOn(messageRepository, 'findAndPopulate');
      const result = await messageService.findAndPopulate(orderByCreatedAtAsc);

      expect(spy).toHaveBeenCalledWith(orderByCreatedAtAsc);
      expect(result).toEqualPayload(populatedMessages);

      spy.mockRestore();
    });
  });

  describe('findHistoryUntilDate', () => {
    it('returns history until the specified date ordered from newest to oldest', async () => {
      const until = new Date('2024-12-31T23:59:59.999Z');
      const result = await messageService.findHistoryUntilDate(
        referenceThread,
        until,
        30,
      );
      const expected = threadMessagesDesc
        .filter((message) => message.createdAt! < until)
        .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());

      expect(result).toEqualPayload(expected);
    });
  });

  describe('findHistorySinceDate', () => {
    it('returns history since the specified date ordered from oldest to newest', async () => {
      const since = threadMessagesDesc[threadMessagesDesc.length - 1].createdAt;
      const result = await messageService.findHistorySinceDate(
        referenceThread,
        since,
        30,
      );
      const expected = threadMessagesDesc
        .filter((message) => message.createdAt! > since)
        .sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());

      expect(result).toEqualPayload(expected, [
        'id',
        'createdAt',
        'updatedAt',
        'recipient',
        'sender',
        'sentBy',
      ]);
    });
  });

  describe('findLastMessages', () => {
    it('returns the most recent messages for a subscriber in chronological order', async () => {
      const limit = 2;
      const result = await messageService.findLastMessages(
        referenceThread,
        limit,
      );
      const expected = threadMessagesDesc.slice(0, limit);

      expect(result).toEqualPayload(expected, [
        'id',
        'createdAt',
        'updatedAt',
        'recipient',
        'sender',
        'sentBy',
      ]);
    });
  });
});

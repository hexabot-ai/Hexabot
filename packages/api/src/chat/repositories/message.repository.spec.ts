/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MessageOrmEntity } from '@/chat/entities/message.entity';
import { installMessageFixturesTypeOrm } from '@/utils/test/fixtures/message';
import { buildTestingMocks } from '@/utils/test/utils';

import { MessageRepository } from './message.repository';

describe('MessageRepository (TypeORM)', () => {
  let module: TestingModule;
  let messageRepository: MessageRepository;
  let repository: Repository<MessageOrmEntity>;
  let seededMessages: MessageOrmEntity[];

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [MessageRepository],
      typeorm: {
        fixtures: installMessageFixturesTypeOrm,
      },
    });

    module = testing.module;

    [messageRepository] = await testing.getMocks([MessageRepository]);

    repository = module.get<Repository<MessageOrmEntity>>(
      getRepositoryToken(MessageOrmEntity),
    );

    seededMessages = await repository.find({
      relations: ['sender', 'recipient', 'sentBy'],
      order: { createdAt: 'ASC' },
    });
  }, 30000);

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findOneAndPopulate', () => {
    it('returns a populated message by id', async () => {
      const reference = seededMessages.find(
        (message) => message.mid === 'mid-1',
      );
      if (!reference) {
        throw new Error('Expected fixture with mid "mid-1" to be available');
      }

      const result = await messageRepository.findOneAndPopulate(reference.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(reference.id);
      expect(result!.mid ?? null).toBe(reference.mid ?? null);
      expect(result!.message).toEqual(reference.message);
      expect(result!.read).toBe(reference.read);
      expect(result!.delivery).toBe(reference.delivery);
      expect(result!.handover).toBe(reference.handover);

      expect(result!.sender?.id ?? null).toBe(reference.sender?.id ?? null);
      expect(result!.recipient?.id ?? null).toBe(
        reference.recipient?.id ?? null,
      );
      expect(result!.sentBy?.id ?? null).toBe(reference.sentBy?.id ?? null);
    });
  });

  describe('findAndPopulate', () => {
    it('populates related entities for every message', async () => {
      const result = await messageRepository.findAndPopulate({
        order: { createdAt: 'ASC' },
      });

      expect(result).toHaveLength(seededMessages.length);

      const byId = new Map(result.map((message) => [message.id, message]));

      seededMessages.forEach((entity) => {
        const dto = byId.get(entity.id);
        expect(dto).toBeDefined();
        expect(dto!.mid ?? null).toBe(entity.mid ?? null);
        expect(dto!.message).toEqual(entity.message);
        expect(dto!.sender?.id ?? null).toBe(entity.sender?.id ?? null);
        expect(dto!.recipient?.id ?? null).toBe(entity.recipient?.id ?? null);
        expect(dto!.sentBy?.id ?? null).toBe(entity.sentBy?.id ?? null);
      });
    });
  });
});

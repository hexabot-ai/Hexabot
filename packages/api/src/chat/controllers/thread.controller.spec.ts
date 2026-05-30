/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Thread, ThreadFull } from '@hexabot-ai/types';
import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

import { ThreadOrmEntity } from '@/chat/entities/thread.entity';
import { ThreadService } from '@/chat/services/thread.service';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';
import { installMessageFixturesTypeOrm } from '@/utils/test/fixtures/message';
import { buildTestingMocks } from '@/utils/test/utils';

import {
  THREAD_ALLOWED_FILTER_FIELDS,
  ThreadController,
} from './thread.controller';

describe('ThreadController (TypeORM)', () => {
  let module: TestingModule;
  let threadController: ThreadController;
  let threadService: ThreadService;

  let totalThreads: number;
  let plainThreads: Thread[];
  let populatedThreads: ThreadFull[];
  let referencePlain: Thread;
  let referencePopulated: ThreadFull;

  const defaultOrder = { order: { createdAt: 'ASC' as const } };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [ThreadController],
      typeorm: {
        fixtures: installMessageFixturesTypeOrm,
      },
    });

    module = testing.module;
    [threadController, threadService] = await testing.getMocks([
      ThreadController,
      ThreadService,
    ]);

    totalThreads = await threadService.count();
    plainThreads = await threadService.find(defaultOrder);
    populatedThreads = await threadService.findAndPopulate(defaultOrder);
    referencePlain = plainThreads[0];
    referencePopulated =
      populatedThreads.find((thread) => thread.id === referencePlain.id) ??
      populatedThreads[0];

    if (!referencePlain || !referencePopulated) {
      throw new Error('Expected thread fixtures to seed at least one thread');
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('count', () => {
    it('counts threads', async () => {
      const countSpy = jest.spyOn(threadService, 'count');
      const result = await threadController.filterCount();

      expect(countSpy).toHaveBeenCalledWith({});
      expect(result).toEqual({ count: totalThreads });
    });
  });

  describe('findOne', () => {
    it('finds a thread by id with populated relations', async () => {
      const populateSpy = jest.spyOn(threadService, 'findOneAndPopulate');
      const result = await threadController.findThread(referencePlain.id, [
        'subscriber',
      ]);

      expect(populateSpy).toHaveBeenCalledWith(referencePlain.id);
      expect(result).toEqualPayload(referencePopulated);
    });

    it('finds a thread by id without populating relations', async () => {
      const findSpy = jest.spyOn(threadService, 'findOne');
      const result = await threadController.findThread(referencePlain.id, []);

      expect(findSpy).toHaveBeenCalledWith(referencePlain.id);
      expect(result).toEqualPayload(referencePlain);
    });
  });

  describe('findPage', () => {
    it('finds threads without populating relations when none requested', async () => {
      const findSpy = jest.spyOn(threadService, 'find');
      const result = await threadController.findThreads([], defaultOrder);

      expect(findSpy).toHaveBeenCalledWith(defaultOrder);
      expect(result).toEqualPayload(plainThreads);
    });

    it('finds threads and populates requested relations', async () => {
      const populateSpy = jest.spyOn(threadService, 'findAndPopulate');
      const result = await threadController.findThreads(
        ['subscriber'],
        defaultOrder,
      );

      expect(populateSpy).toHaveBeenCalledWith(defaultOrder);
      expect(result).toEqualPayload(populatedThreads);
    });

    it('accepts subscriber-derived filters (firstName)', async () => {
      const pipe = new TypeOrmSearchFilterPipe<ThreadOrmEntity>({
        allowedFields: THREAD_ALLOWED_FILTER_FIELDS,
      });
      const keyword = referencePopulated.subscriber.firstName.slice(0, 2);

      expect(keyword.length).toBeGreaterThan(0);
      const options = await pipe.transform(
        {
          where: {
            'subscriber.firstName': {
              contains: keyword,
            },
          },
        } as any,
        {} as ArgumentMetadata,
      );
      const result = await threadController.findThreads(
        ['subscriber'],
        options,
      );

      expect(result.length).toBeGreaterThan(0);
      expect(
        (result as ThreadFull[]).some((thread) =>
          thread.subscriber.firstName.includes(keyword),
        ),
      ).toBe(true);
    });

    it('accepts source-based filters', async () => {
      const pipe = new TypeOrmSearchFilterPipe<ThreadOrmEntity>({
        allowedFields: THREAD_ALLOWED_FILTER_FIELDS,
      });
      const sourceId = referencePopulated.source.id;
      const options = await pipe.transform(
        {
          where: {
            'source.id': sourceId,
          },
        } as any,
        {} as ArgumentMetadata,
      );
      const result = await threadController.findThreads(
        ['subscriber', 'source'],
        options,
      );

      expect(result.length).toBeGreaterThan(0);
      expect(
        (result as ThreadFull[]).every(
          (thread) => thread.source.id === sourceId,
        ),
      ).toBe(true);
    });
  });

  describe('create', () => {
    it('creates a new thread for a subscriber', async () => {
      const payload = {
        subscriber: referencePlain.subscriber,
        title: 'Support',
      };
      const before = await threadService.count();
      const created = await threadController.create(payload);

      expect(created.subscriber).toBe(payload.subscriber);
      expect(created.status).toBe('open');
      expect(created.title).toBe(payload.title);
      expect(await threadService.count()).toBe(before + 1);
    });
  });

  describe('updateOne', () => {
    it('updates thread status and close reason', async () => {
      const closed = await threadController.updateOne(referencePlain.id, {
        status: 'closed',
        closeReason: 'manual',
      });
      const stored = await threadService.findOne(referencePlain.id);

      expect(closed.status).toBe('closed');
      expect(closed.closeReason).toBe('manual');
      expect(stored?.status).toBe('closed');
      expect(stored?.closeReason).toBe('manual');
    });

    it('rejects subscriber/source updates on thread patch payload', async () => {
      await expect(
        threadController.updateOne(referencePlain.id, {
          subscriber: referencePlain.subscriber,
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        threadController.updateOne(referencePlain.id, {
          source: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

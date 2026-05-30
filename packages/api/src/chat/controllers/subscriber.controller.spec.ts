/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Subscriber, SubscriberFull } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import { AttachmentService } from '@/attachment/services/attachment.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import {
  installSubscriberFixturesTypeOrm,
  subscriberFixtures,
} from '@/utils/test/fixtures/subscriber';
import { buildTestingMocks } from '@/utils/test/utils';

import { SubscriberController } from './subscriber.controller';

describe('SubscriberController (TypeORM)', () => {
  let module: TestingModule;
  let subscriberController: SubscriberController;
  let subscriberService: SubscriberService;

  let plainSubscribers: Subscriber[];
  let populatedSubscribers: SubscriberFull[];
  let referencePlain: Subscriber;
  let referencePopulated: SubscriberFull;

  const attachmentServiceMock: Partial<AttachmentService> = {
    download: jest.fn(),
    store: jest.fn(),
    readAsBuffer: jest.fn(),
    readAsStream: jest.fn(),
  };
  const defaultOrder = { order: { createdAt: 'ASC' as const } };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [SubscriberController],
      providers: [
        {
          provide: AttachmentService,
          useValue: attachmentServiceMock,
        },
      ],
      typeorm: {
        fixtures: installSubscriberFixturesTypeOrm,
      },
    });

    module = testing.module;

    [subscriberController, subscriberService] = await testing.getMocks([
      SubscriberController,
      SubscriberService,
    ]);
    plainSubscribers = await subscriberService.find(defaultOrder);
    populatedSubscribers =
      await subscriberService.findAndPopulate(defaultOrder);

    const targetFirstName = subscriberFixtures[0]?.firstName ?? null;

    referencePlain =
      plainSubscribers.find(({ firstName }) => firstName === targetFirstName) ??
      plainSubscribers[0];

    referencePopulated =
      populatedSubscribers.find(
        (subscriber) => subscriber.id === referencePlain.id,
      ) ?? populatedSubscribers[0];

    if (!referencePlain || !referencePopulated) {
      throw new Error(
        'Expected subscriber fixtures to seed at least one subscriber',
      );
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findOne', () => {
    it('should find subscriber by id with populated relations', async () => {
      const populateSpy = jest.spyOn(subscriberService, 'findOneAndPopulate');
      const result = await subscriberController.findSubscriber(
        referencePlain.id,
        ['labels', 'assignedTo', 'avatar'],
      );

      expect(populateSpy).toHaveBeenCalledWith(referencePlain.id);
      expect(result).toEqualPayload(referencePopulated);
    });

    it('should find subscriber by id without populating relations', async () => {
      const findSpy = jest.spyOn(subscriberService, 'findOne');
      const result = await subscriberController.findSubscriber(
        referencePlain.id,
        [],
      );

      expect(findSpy).toHaveBeenCalledWith(referencePlain.id);
      expect(result).toEqualPayload(referencePlain);
    });
  });

  describe('findPage', () => {
    it('should find subscribers without populating relations when none requested', async () => {
      const findSpy = jest.spyOn(subscriberService, 'find');
      const result = await subscriberController.findSubscribers(
        [],
        defaultOrder,
      );

      expect(findSpy).toHaveBeenCalledWith(defaultOrder);
      expect(result).toEqualPayload(plainSubscribers);
    });

    it('should find subscribers and populate requested relations', async () => {
      const populateSpy = jest.spyOn(subscriberService, 'findAndPopulate');
      const result = await subscriberController.findSubscribers(
        ['labels', 'assignedTo', 'avatar'],
        defaultOrder,
      );

      expect(populateSpy).toHaveBeenCalledWith(defaultOrder);
      expect(result).toEqualPayload(populatedSubscribers);
    });
  });
});

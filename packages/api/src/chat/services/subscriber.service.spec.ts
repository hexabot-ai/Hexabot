/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import type { User, Subscriber } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import mime from 'mime';
import { Repository } from 'typeorm';

import { AttachmentOrmEntity } from '@/attachment/entities/attachment.entity';
import { AttachmentService } from '@/attachment/services/attachment.service';
import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentFile,
  AttachmentResourceRef,
} from '@/attachment/types';
import { SourceOrmEntity } from '@/channel/entities/source.entity';
import { UserRepository } from '@/user/repositories/user.repository';
import { UserService } from '@/user/services/user.service';
import { installLabelGroupFixturesTypeOrm } from '@/utils/test/fixtures/label-group';
import { installSubscriberFixturesTypeOrm } from '@/utils/test/fixtures/subscriber';
import { sortRowsBy } from '@/utils/test/sort';
import { buildTestingMocks } from '@/utils/test/utils';
import { WebsocketGateway } from '@/websocket/websocket.gateway';

import { LabelGroupRepository } from '../repositories/label-group.repository';
import { LabelRepository } from '../repositories/label.repository';
import { SubscriberRepository } from '../repositories/subscriber.repository';

import { LabelService } from './label.service';
import { SubscriberService } from './subscriber.service';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');

  return {
    ...actual,
    randomUUID: jest.fn(() => actual.randomUUID()),
  };
});

const randomUUIDMock = randomUUID as jest.MockedFunction<typeof randomUUID>;
const normalizeSourcePayload = (source: unknown) => {
  if (!source || typeof source !== 'object') {
    return source ?? null;
  }

  const record = source as {
    id?: string;
    name?: string;
    channel?: string;
    settings?: Record<string, unknown>;
    state?: boolean;
    defaultWorkflow?: { id?: string } | string | null;
  };
  const defaultWorkflow =
    typeof record.defaultWorkflow === 'object'
      ? (record.defaultWorkflow?.id ?? null)
      : (record.defaultWorkflow ?? null);

  return {
    id: record.id,
    name: record.name,
    channel: record.channel,
    settings: record.settings ?? {},
    state: record.state,
    defaultWorkflow,
  };
};

describe('SubscriberService (TypeORM)', () => {
  let module: TestingModule;
  let subscriberService: SubscriberService;
  let subscriberRepository: SubscriberRepository;
  let labelRepository: LabelRepository;
  let labelGroupRepository: LabelGroupRepository;
  let userService: UserService;
  let userRepository: UserRepository;
  let sourceRepository: Repository<SourceOrmEntity>;
  const STORED_ATTACHMENT_ID = '99999999-9999-4999-9999-999999999999';
  const EXISTING_ATTACHMENT_ID = '88888888-8888-4888-8888-888888888888';
  const attachmentServiceMock = {
    store: jest.fn(),
  } as jest.Mocked<Pick<AttachmentService, 'store'>>;
  const websocketGatewayMock = {
    getConnectedAuthenticatedUserIds: jest.fn(),
  } as jest.Mocked<Pick<WebsocketGateway, 'getConnectedAuthenticatedUserIds'>>;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        SubscriberService,
        LabelService,
        LabelGroupRepository,
        UserService,
        UserRepository,
        { provide: AttachmentService, useValue: attachmentServiceMock },
        { provide: WebsocketGateway, useValue: websocketGatewayMock },
      ],
      typeorm: {
        fixtures: [
          installLabelGroupFixturesTypeOrm,
          installSubscriberFixturesTypeOrm,
        ],
      },
    });

    module = testing.module;

    [
      subscriberService,
      subscriberRepository,
      labelRepository,
      labelGroupRepository,
      userService,
      userRepository,
    ] = await testing.getMocks([
      SubscriberService,
      SubscriberRepository,
      LabelRepository,
      LabelGroupRepository,
      UserService,
      UserRepository,
    ]);
    sourceRepository = module.get<Repository<SourceOrmEntity>>(
      getRepositoryToken(SourceOrmEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });
  describe('findOneAndPopulate', () => {
    it('should find one subscriber and populate related data', async () => {
      const subscriber = await subscriberRepository.findOne({
        where: { firstName: 'Jhon' },
      });
      expect(subscriber).not.toBeNull();

      const spy = jest.spyOn(subscriberService, 'findOneAndPopulate');
      const result = await subscriberService.findOneAndPopulate(subscriber!.id);

      expect(spy).toHaveBeenCalledWith(subscriber!.id);
      expect(result).not.toBeNull();

      const [labels, users, sources] = await Promise.all([
        labelRepository.findAll(),
        userRepository.findAll(),
        sourceRepository.find(),
      ]);
      const sourceById = new Map(sources.map((source) => [source.id, source]));
      const sortLabelsByName = <T extends { name: string }>(list: T[]) =>
        [...list].sort((a, b) => a.name.localeCompare(b.name));
      const expectedLabels = sortLabelsByName(
        labels.filter((label) => subscriber!.labels.includes(label.id)),
      );
      const normalizedResult = {
        ...result!,
        labels: sortLabelsByName(result!.labels ?? []),
        source: normalizeSourcePayload(result!.source),
      };

      expect(normalizedResult).toEqualPayload({
        ...subscriber,
        labels: expectedLabels,
        assignedTo: users.find(({ id }) => subscriber!.assignedTo === id),
        source: normalizeSourcePayload(
          typeof subscriber!.source === 'string'
            ? (sourceById.get(subscriber!.source) ?? null)
            : null,
        ),
      });
    });
  });

  describe('findAndPopulate', () => {
    it('should find subscribers and populate related data', async () => {
      const spy = jest.spyOn(subscriberRepository, 'findAndPopulate');
      const result = await subscriberService.findAndPopulate();

      expect(spy).toHaveBeenCalled();
      expect(result).not.toHaveLength(0);

      const [subscribers, labels, users, sources] = await Promise.all([
        subscriberRepository.findAll(),
        labelRepository.findAll(),
        userRepository.findAll(),
        sourceRepository.find(),
      ]);
      const sourceById = new Map(sources.map((source) => [source.id, source]));
      const sortLabelsByName = <T extends { name: string }>(list: T[]) =>
        [...list].sort((a, b) => a.name.localeCompare(b.name));
      const subscribersWithRelations = subscribers.map((subscriber) => ({
        ...subscriber,
        labels: sortLabelsByName(
          labels.filter((label) => subscriber.labels.includes(label.id)),
        ),
        assignedTo:
          users.find(({ id }) => subscriber.assignedTo === id) || null,
        source: normalizeSourcePayload(
          typeof subscriber.source === 'string'
            ? (sourceById.get(subscriber.source) ?? null)
            : null,
        ),
      }));
      const normalizedResult = result.map((item) => ({
        ...item,
        labels: sortLabelsByName(item.labels ?? []),
        source: normalizeSourcePayload(item.source),
      }));
      const expected = [...subscribersWithRelations].sort(sortRowsBy);
      const actual = [...normalizedResult].sort(sortRowsBy);

      expect(actual).toEqualPayload(expected);
    });
  });

  describe('findOneByForeignId', () => {
    it('should find one subscriber by foreign id', async () => {
      const subscriber = await subscriberRepository.findOne({
        where: { foreignId: 'foreign-id-dimelo' },
      });
      expect(subscriber).not.toBeNull();

      const spy = jest.spyOn(subscriberRepository, 'findOneByForeignId');
      const result =
        await subscriberService.findOneByForeignId('foreign-id-dimelo');

      expect(spy).toHaveBeenCalledWith('foreign-id-dimelo', undefined);
      expect(result).toEqualPayload({
        ...subscriber,
        labels: subscriber!.labels,
      });
    });
  });

  describe('storeAvatar', () => {
    it('should persist the avatar and patch the subscriber', async () => {
      const subscriber = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-messenger' },
      }))!;
      const avatarPayload: AttachmentFile = {
        file: Buffer.from('fake-png'),
        type: 'image/png',
        size: 8_192,
      };
      jest.spyOn(mime, 'extension').mockReturnValue('png');
      randomUUIDMock.mockReturnValueOnce(
        'test-uuid' as ReturnType<typeof randomUUID>,
      );

      const fakeAttachment = Object.assign(new AttachmentOrmEntity(), {
        id: STORED_ATTACHMENT_ID,
      });
      attachmentServiceMock.store.mockResolvedValue(fakeAttachment as any);

      const attachmentRepository = module.get(
        getRepositoryToken(AttachmentOrmEntity),
      );
      await attachmentRepository.save(
        attachmentRepository.create({
          id: fakeAttachment.id,
          name: 'avatar-test-uuid.png',
          type: 'image/png',
          size: avatarPayload.size,
          location: `avatar-${fakeAttachment.id}`,
          resourceRef: AttachmentResourceRef.SubscriberAvatar,
          access: AttachmentAccess.Private,
          createdByRef: AttachmentCreatedByRef.Subscriber,
          createdBy: subscriber.id,
        }),
      );

      const result = await subscriberService.storeAvatar(
        subscriber.id,
        avatarPayload,
      );

      expect(attachmentServiceMock.store).toHaveBeenCalledTimes(1);
      expect(attachmentServiceMock.store).toHaveBeenCalledWith(
        avatarPayload.file,
        expect.objectContaining({
          name: 'avatar-test-uuid.png',
          type: 'image/png',
          size: 8_192,
          resourceRef: AttachmentResourceRef.SubscriberAvatar,
          access: AttachmentAccess.Private,
          createdByRef: AttachmentCreatedByRef.Subscriber,
          createdBy: subscriber.id,
        }),
      );

      expect(result.avatar).toBe(fakeAttachment.id);
    });

    it('should propagate an error from AttachmentService and leave the subscriber unchanged', async () => {
      const subscriber = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-1' },
      }))!;
      const avatarPayload: AttachmentFile = {
        file: Buffer.from('fake-jpg'),
        type: 'image/jpeg',
        size: 5_048,
      };
      jest.spyOn(mime, 'extension').mockReturnValue('jpg');

      const failure = new Error('disk full');
      attachmentServiceMock.store.mockRejectedValue(failure);
      const updateOneSpy = jest
        .spyOn(subscriberService, 'updateOne')
        .mockResolvedValue(subscriber);

      await expect(
        subscriberService.storeAvatar(subscriber.id, avatarPayload),
      ).rejects.toThrow(failure);

      expect(updateOneSpy).not.toHaveBeenCalled();
    });

    it('should generate the filename with the proper extension', async () => {
      const subscriber = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-2' },
      }))!;
      const avatarPayload: AttachmentFile = {
        file: Buffer.from('fake-png'),
        type: 'image/png',
        size: 1_024,
      };
      jest.spyOn(mime, 'extension').mockReturnValue('png');
      randomUUIDMock.mockReturnValueOnce(
        'test-uuid' as ReturnType<typeof randomUUID>,
      );

      attachmentServiceMock.store.mockResolvedValue({
        id: EXISTING_ATTACHMENT_ID,
      } as any);

      const attachmentRepository = module.get(
        getRepositoryToken(AttachmentOrmEntity),
      );
      await attachmentRepository.save(
        attachmentRepository.create({
          id: EXISTING_ATTACHMENT_ID,
          name: 'avatar-test-uuid.png',
          type: 'image/png',
          size: avatarPayload.size,
          location: `avatar-${EXISTING_ATTACHMENT_ID}`,
          resourceRef: AttachmentResourceRef.SubscriberAvatar,
          access: AttachmentAccess.Private,
          createdByRef: AttachmentCreatedByRef.Subscriber,
          createdBy: subscriber.id,
        }),
      );

      await subscriberService.storeAvatar(subscriber.id, avatarPayload);

      const [, metadata] = attachmentServiceMock.store.mock.calls[0];
      expect(metadata.name).toBe('avatar-test-uuid.png');
    });
  });

  describe('assignLabels', () => {
    it('should merge and deduplicate labels', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-messenger' },
      }))!;
      const newLabels = (
        await labelRepository.createMany([
          { title: 'Is Interested', name: 'IS_INTERESTED' },
          { title: 'Follow Up Required', name: 'FOLLOW_UP_REQUIRED' },
        ])
      ).map(({ id }) => id);
      const expectedLabels = Array.from(
        new Set([...profile.labels, ...newLabels]),
      );
      const result = await subscriberService.assignLabels(profile, [
        ...newLabels,
        profile.labels[0],
      ]);

      expect([...result.labels].sort()).toEqual(expectedLabels.sort());
    });

    it('should handle mutual exclusion for grouped labels', async () => {
      const mutexGroup = await labelGroupRepository.create({
        name: 'MUTEX_TEST_GROUP',
      });
      const timestamp = Date.now();
      const [oldLabel, newLabel] = await labelRepository.createMany([
        {
          title: 'Mutex Old',
          name: `MUTEX_OLD_${timestamp}`,
          group: mutexGroup.id,
        },
        {
          title: 'Mutex New',
          name: `MUTEX_NEW_${timestamp}`,
          group: mutexGroup.id,
        },
      ]);
      const baseSubscriber = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-1' },
      }))!;
      const alteredSubscriber = await subscriberService.assignLabels(
        baseSubscriber,
        [oldLabel.id],
      );
      const result = await subscriberService.assignLabels(alteredSubscriber, [
        newLabel.id,
      ]);
      const expected: Subscriber = {
        ...alteredSubscriber,
        labels: [
          ...alteredSubscriber.labels.filter((id) => id !== oldLabel.id),
          newLabel.id,
        ],
      };

      expect([...result.labels].sort()).toEqual([...expected.labels].sort());
      expect(result.labels).not.toContain(oldLabel.id);
    });

    it('should propagate errors from assignLabels', async () => {
      const base = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-2' },
      }))!;
      const failure = new Error('Any error');
      const targetLabel = base.labels[0];
      expect(targetLabel).toBeDefined();

      jest.spyOn(subscriberService, 'assignLabels').mockRejectedValue(failure);

      await expect(
        subscriberService.applyUpdates(base as any, [targetLabel], null),
      ).rejects.toThrow(failure);
    });
  });

  describe('updateLabels', () => {
    it('should remove labels when only labelsToRemove is provided', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-messenger' },
      }))!;
      const labelToRemove = profile.labels[0];
      expect(labelToRemove).toBeDefined();

      const result = await subscriberService.updateLabels(
        profile,
        [],
        [labelToRemove, labelToRemove],
      );

      expect(result.labels).not.toContain(labelToRemove);
    });

    it('should apply assign-wins behavior for overlapping labels', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-2' },
      }))!;
      const labelToRemove = profile.labels[0];
      const [labelToAssign] = await labelRepository.createMany([
        {
          title: 'Update Labels Assign Wins',
          name: `UPDATE_LABELS_ASSIGN_WINS_${Date.now()}`,
        },
      ]);
      expect(labelToRemove).toBeDefined();

      const result = await subscriberService.updateLabels(
        profile,
        [labelToAssign.id],
        [labelToRemove, labelToAssign.id, labelToAssign.id],
      );

      expect(result.labels).toContain(labelToAssign.id);
      expect(result.labels).not.toContain(labelToRemove);
    });

    it('should preserve mutex replacement behavior through assign path', async () => {
      const mutexGroup = await labelGroupRepository.create({
        name: 'MUTEX_UPDATE_LABELS_GROUP',
      });
      const timestamp = Date.now();
      const [oldLabel, newLabel] = await labelRepository.createMany([
        {
          title: 'Update Labels Mutex Old',
          name: `UPDATE_LABELS_MUTEX_OLD_${timestamp}`,
          group: mutexGroup.id,
        },
        {
          title: 'Update Labels Mutex New',
          name: `UPDATE_LABELS_MUTEX_NEW_${timestamp}`,
          group: mutexGroup.id,
        },
      ]);
      const baseSubscriber = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-1' },
      }))!;
      const withOldLabel = await subscriberService.updateLabels(
        baseSubscriber,
        [oldLabel.id],
        [],
      );
      const result = await subscriberService.updateLabels(
        withOldLabel,
        [newLabel.id],
        [],
      );

      expect(result.labels).toContain(newLabel.id);
      expect(result.labels).not.toContain(oldLabel.id);
    });

    it('should throw when there are no effective label operations', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-1' },
      }))!;

      await expect(subscriberService.updateLabels(profile)).rejects.toThrow(
        'At least one label operation is required',
      );
    });
  });

  describe('resolveLabelNames', () => {
    it('preserves input order, removes duplicates, and ignores unknown ids', async () => {
      const timestamp = Date.now();
      const [labelA, labelB] = await labelRepository.createMany([
        {
          title: 'Resolve Label Name A',
          name: `RESOLVE_LABEL_NAME_A_${timestamp}`,
        },
        {
          title: 'Resolve Label Name B',
          name: `RESOLVE_LABEL_NAME_B_${timestamp}`,
        },
      ]);
      const unknownId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const result = await subscriberService.resolveLabelNames([
        labelB.id,
        labelA.id,
        labelB.id,
        unknownId,
      ]);

      expect(result).toEqual([labelB.name, labelA.name]);
    });

    it('returns an empty array when there are no label ids to resolve', async () => {
      await expect(subscriberService.resolveLabelNames([])).resolves.toEqual(
        [],
      );
    });
  });

  describe('handOver', () => {
    it('should set assignedTo when provided without labels', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-1' },
      }))!;
      const assignee = (await userRepository.findOne({
        where: { username: 'admin' },
      })) as User;
      const expected = { ...profile, assignedTo: assignee.id } as Subscriber;
      const updateSpy = jest
        .spyOn(subscriberService, 'updateOne')
        .mockResolvedValue(expected);
      const result = await subscriberService.handOver(profile, assignee.id);

      expect(updateSpy).toHaveBeenCalledWith(profile.id, {
        assignedTo: assignee.id,
        assignedAt: expect.any(Date),
      });
      expect(result).toEqualPayload(expected);
    });
  });

  describe('assignment lifecycle hooks', () => {
    it('updates assignedAt and emits assign hook on handover', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-dimelo' },
      }))!;
      const assignee = (await userRepository.findOne({
        where: { username: 'admin' },
      })) as User;
      const initialAssignedAt = new Date('2024-01-01T00:00:00.000Z');
      await subscriberService.updateOne(profile.id, {
        assignedTo: assignee.id,
        assignedAt: initialAssignedAt,
      });
      const emitSpy = jest.spyOn(
        subscriberRepository.getEventEmitter(),
        'emitAsync',
      );
      const updated = await subscriberService.handOver(profile, assignee.id);

      expect(updated.assignedTo).toBe(assignee.id);
      expect(updated.assignedAt).toBeInstanceOf(Date);
      expect(updated.assignedAt).not.toEqual(initialAssignedAt);
      expect(emitSpy).toHaveBeenCalledWith(
        'hook:subscriber:assign',
        expect.objectContaining({
          assignedTo: assignee.id,
          assignedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: profile.id,
        }),
      );
    });

    it('clears assignedAt and emits assign hook on handback', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-dimelo' },
      }))!;
      const assignee = (await userRepository.findOne({
        where: { username: 'admin' },
      })) as User;
      const updatedSubscriber = await subscriberService.updateOne(profile.id, {
        assignedTo: assignee.id,
        assignedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      const emitSpy = jest.spyOn(
        subscriberRepository.getEventEmitter(),
        'emit',
      );

      expect(updatedSubscriber.assignedTo).not.toBeNull();
      expect(updatedSubscriber.assignedAt).not.toBeNull();
      if (!profile.foreignId) {
        throw new Error('Expected fixture subscriber to have a foreignId');
      }

      const updated = await subscriberService.handBackByForeignId(
        profile.foreignId,
      );

      expect(updated.assignedTo).toBeNull();
      expect(updated.assignedAt).toBeNull();
      expect(emitSpy).toHaveBeenCalledWith(
        'hook:subscriber:assign',
        expect.objectContaining({
          assignedTo: null,
          assignedAt: null,
        }),
        expect.objectContaining({
          id: profile.id,
        }),
      );
    });
  });

  describe('handOverByPolicy', () => {
    it('assigns in specific mode when assignee is active', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-2' },
      }))!;
      const assigneeId = '11111111-1111-4111-8111-111111111111';
      const updated = { ...profile, assignedTo: assigneeId } as Subscriber;

      jest
        .spyOn(userService, 'findActiveUserIds')
        .mockResolvedValue([assigneeId]);
      const handOverSpy = jest
        .spyOn(subscriberService, 'handOver')
        .mockResolvedValue(updated);
      const result = await subscriberService.handOverByPolicy(profile, {
        mode: 'specific',
        userId: assigneeId,
      });

      expect(handOverSpy).toHaveBeenCalledWith(profile, assigneeId);
      expect(result).toEqualPayload({
        success: true,
        mode: 'specific',
        subscriber: updated,
        assignedTo: assigneeId,
      });
    });

    it('throws in specific mode when assignee is inactive or missing', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-2' },
      }))!;
      const assigneeId = '22222222-2222-4222-8222-222222222222';

      jest.spyOn(userService, 'findActiveUserIds').mockResolvedValue([]);

      await expect(
        subscriberService.handOverByPolicy(profile, {
          mode: 'specific',
          userId: assigneeId,
        }),
      ).rejects.toThrow(
        `Unable to handover to user "${assigneeId}": user is inactive or does not exist`,
      );
    });

    it('chooses the least-loaded active online assignee in auto mode', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-web-1' },
      }))!;
      const updated = {
        ...profile,
        assignedTo: '33333333-3333-4333-8333-333333333333',
      } as Subscriber;

      websocketGatewayMock.getConnectedAuthenticatedUserIds.mockReturnValue([
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
      ]);
      jest
        .spyOn(userService, 'findActiveUserIds')
        .mockResolvedValue([
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ]);
      jest
        .spyOn(subscriberRepository, 'countAssignedSubscribersByUserIds')
        .mockResolvedValue({
          '11111111-1111-4111-8111-111111111111': 5,
          '33333333-3333-4333-8333-333333333333': 1,
        });
      const handOverSpy = jest
        .spyOn(subscriberService, 'handOver')
        .mockResolvedValue(updated);
      const result = await subscriberService.handOverByPolicy(profile, {
        mode: 'auto',
      });

      expect(handOverSpy).toHaveBeenCalledWith(
        profile,
        '33333333-3333-4333-8333-333333333333',
      );
      expect(result).toEqualPayload({
        success: true,
        mode: 'auto',
        subscriber: updated,
        assignedTo: '33333333-3333-4333-8333-333333333333',
      });
    });

    it('returns no-op output in auto mode when no active online user exists', async () => {
      const profile = (await subscriberService.findOne({
        where: { foreignId: 'foreign-id-messenger' },
      }))!;

      websocketGatewayMock.getConnectedAuthenticatedUserIds.mockReturnValue([]);
      const handOverSpy = jest.spyOn(subscriberService, 'handOver');
      const result = await subscriberService.handOverByPolicy(profile, {
        mode: 'auto',
      });

      expect(handOverSpy).not.toHaveBeenCalled();
      expect(result).toEqualPayload({
        success: false,
        mode: 'auto',
        subscriber: profile,
        assignedTo: profile.assignedTo ?? null,
        reason: 'no_available_user',
      });
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { config } from '@/config';
import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import {
  attachmentFixtures,
  installAttachmentFixturesTypeOrm,
} from '@/utils/test/fixtures/attachment';
import { installUserFixturesTypeOrm } from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';

import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
} from '../types';

import { AttachmentRepository } from './attachment.repository';

describe('AttachmentRepository (TypeORM)', () => {
  let repository: AttachmentRepository;
  const createdAttachmentIds = new Set<string>();
  const CREATOR_UUID = '66666666-6666-6666-6666-666666666666';

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [AttachmentRepository],
      typeorm: {
        fixtures: [
          installUserFixturesTypeOrm,
          installAttachmentFixturesTypeOrm,
        ],
      },
    });

    [repository] = await testing.getMocks([AttachmentRepository]);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    for (const id of Array.from(createdAttachmentIds)) {
      await repository.deleteOne(id);
      createdAttachmentIds.delete(id);
    }
  });
  describe('configuration', () => {
    it('exposes createdBy as the only populatable relation', () => {
      expect(repository.getPopulateRelations()).toEqual(['createdBy']);
      expect(repository.canPopulate(['createdBy'])).toBe(true);
      expect(repository.canPopulate(['createdBy', 'unknown'])).toBe(false);
      expect(repository.canPopulate([])).toBe(false);
    });
  });

  describe('read operations', () => {
    it('returns seeded attachments and finds one by id', async () => {
      const attachments = await repository.findAll({ order: { name: 'asc' } });
      expect(attachments).toHaveLength(attachmentFixtures.length);

      const expected = [...attachmentFixtures]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => {
          const attachmentUuid = attachments.find(
            (r) => r.location === a.location,
          )?.id;

          return {
            ...a,
            url: `${config.apiBaseUrl}/attachment/download/${attachmentUuid}/${a.name}`,
          };
        });

      expect(attachments).toEqualPayload(expected, [...IGNORED_TEST_FIELDS]);

      const target = attachments[0];
      const fetched = await repository.findOne(target.id);
      expect(fetched).toEqualPayload(target);
    });

    it('returns null when an attachment cannot be found', async () => {
      const result = await repository.findOne(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('write operations', () => {
    const buildPayload = (overrides: Partial<Record<string, unknown>> = {}) => {
      const suffix = randomUUID();

      return {
        name: `new-file-${suffix}.png`,
        type: 'image/png',
        size: 1234,
        location: `${suffix}.png`,
        resourceRef: AttachmentResourceRef.MessageAttachment,
        access: AttachmentAccess.Public,
        createdByRef: AttachmentCreatedByRef.User,
        createdBy: CREATOR_UUID,
        channel: {
          web: { id: 'channel-id' },
        },
        ...overrides,
      };
    };

    it('creates and deletes an attachment', async () => {
      const payload = buildPayload();
      const created = await repository.create(payload);
      createdAttachmentIds.add(created.id);

      expect(created).toMatchObject({
        name: payload.name,
        type: payload.type,
        size: payload.size,
        location: payload.location,
        resourceRef: payload.resourceRef,
        access: payload.access,
        createdBy: payload.createdBy,
        createdByRef: payload.createdByRef,
        channel: payload.channel,
      });

      const fetched = await repository.findOne(created.id);
      expect(fetched).toEqualPayload(created);

      const result = await repository.deleteOne(created.id);
      expect(result).toEqual({
        acknowledged: true,
        deletedCount: 1,
      });
      createdAttachmentIds.delete(created.id);

      const afterDelete = await repository.findOne(created.id);
      expect(afterDelete).toBeNull();
    });

    it('updates an attachment', async () => {
      const payload = buildPayload();
      const created = await repository.create(payload);
      createdAttachmentIds.add(created.id);

      const updated = await repository.updateOne(created.id, {
        name: `${payload.name}-updated`,
        access: AttachmentAccess.Private,
      });

      expect(updated).not.toBeNull();
      expect(updated).toMatchObject({
        id: created.id,
        name: `${payload.name}-updated`,
        access: AttachmentAccess.Private,
      });

      const refetched = await repository.findOne(created.id);
      expect(refetched).not.toBeNull();
      expect(refetched).toMatchObject({
        name: `${payload.name}-updated`,
        access: AttachmentAccess.Private,
      });
    });
  });
});

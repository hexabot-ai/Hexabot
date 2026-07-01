/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { getRandom } from '@/utils/helpers/safeRandom';
import {
  installSettingFixturesTypeOrm,
  settingFixtures,
} from '@/utils/test/fixtures/setting';
import { buildTestingMocks } from '@/utils/test/utils';

import { SettingOrmEntity } from '../entities/setting.entity';

import { SettingRepository } from './setting.repository';

describe('SettingRepository (TypeORM)', () => {
  let settingRepository: SettingRepository;
  let repository: Repository<SettingOrmEntity>;
  let module: TestingModule;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [SettingRepository],
      typeorm: {
        fixtures: installSettingFixturesTypeOrm,
      },
    });

    module = testing.module;
    settingRepository = module.get(SettingRepository);
    repository = module.get<Repository<SettingOrmEntity>>(
      getRepositoryToken(SettingOrmEntity),
    );
  });

  afterEach(async () => {
    jest.clearAllMocks();
    if (createdIds.length > 0) {
      await repository.delete(createdIds);
      createdIds.length = 0;
    }
  });
  describe('findAll', () => {
    it('returns all settings', async () => {
      const result = await settingRepository.findAll();

      expect(result).toHaveLength(settingFixtures.length);
    });
  });

  describe('find', () => {
    it('filters settings by group', async () => {
      const result = await settingRepository.find({
        where: { group: 'contact' },
      });
      const expected = settingFixtures
        .filter((fixture) => fixture.group === 'contact')
        .sort((left, right) => left.label.localeCompare(right.label));
      const sortedResult = [...result].sort((left, right) =>
        left.label.localeCompare(right.label),
      );

      expect(sortedResult).toEqualPayload(expected, [
        'id',
        'createdAt',
        'updatedAt',
        'subgroup',
      ]);
    });
  });

  describe('count', () => {
    it('counts settings that match a filter', async () => {
      const total = await settingRepository.count({
        where: { group: 'global_settings' },
      });
      const expected = settingFixtures.filter(
        (fixture) => fixture.group === 'global_settings',
      );

      expect(total).toBe(expected.length);
    });
  });

  describe('findOne', () => {
    it('returns the first match for provided criteria', async () => {
      const target = settingFixtures.find(
        (fixture) => fixture.group === 'contact',
      )!;
      const found = await settingRepository.findOne({
        where: {
          group: target.group,
          label: target.label,
        },
      });

      expect(found).toBeDefined();
      expect(found).toEqualPayload(target, [
        'id',
        'createdAt',
        'updatedAt',
        'subgroup',
      ]);
    });
  });

  describe('create & update', () => {
    it('persists new settings and updates them', async () => {
      const base = {
        group: `group_${getRandom()}`,
        label: `label_${randomUUID()}`,
        value: 'initial value',
      };
      const created = await settingRepository.create(base);
      createdIds.push(created.id);

      expect(created).toMatchObject({
        group: base.group,
        label: base.label,
        value: base.value,
      });

      const updated = await settingRepository.updateOne(created.id, {
        value: 'updated value',
      });

      expect(updated).not.toBeNull();
      expect(updated).toMatchObject({
        id: created.id,
        value: 'updated value',
      });
    });
  });

  describe('value persistence', () => {
    it.each([
      'text value',
      42,
      true,
      null,
      ['first', 'second'],
      { nested: { value: 'object' } },
    ])(
      'stores setting values without type-based validation: %p',
      async (value) => {
        const created = await settingRepository.create({
          group: `group_${getRandom()}`,
          label: `label_${randomUUID()}`,
          value,
        });
        createdIds.push(created.id);

        expect(created.value).toEqual(value);
      },
    );
  });

  describe('deleteMany', () => {
    it('removes matching settings', async () => {
      const payloads = Array.from({ length: 2 }, () => ({
        group: `cleanup_${getRandom()}`,
        label: `label_${randomUUID()}`,
        value: 'to delete',
      }));
      const inserted = await settingRepository.createMany(payloads);
      const labels = inserted.map((setting) => setting.label);
      const result = await settingRepository.deleteMany({
        where: {
          label: In(labels),
        },
      });

      expect(result.deletedCount).toBe(payloads.length);
    });
  });
});

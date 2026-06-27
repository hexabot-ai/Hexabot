/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { In } from 'typeorm';

import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import { labelFixtures } from '@/utils/test/fixtures/label';
import { installSubscriberFixturesTypeOrm } from '@/utils/test/fixtures/subscriber';
import { buildTestingMocks } from '@/utils/test/utils';

import { LabelRepository } from './label.repository';
import { SubscriberRepository } from './subscriber.repository';

const sortById = <T extends { id?: string }>(row1: T, row2: T) =>
  (row1.id ?? '').localeCompare(row2.id ?? '');

describe('LabelRepository (TypeORM)', () => {
  let labelRepository: LabelRepository;
  let subscriberRepository: SubscriberRepository;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [LabelRepository, SubscriberRepository],
      typeorm: {
        fixtures: installSubscriberFixturesTypeOrm,
      },
    });

    [labelRepository, subscriberRepository] = await testing.getMocks([
      LabelRepository,
      SubscriberRepository,
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('findOneAndPopulate', () => {
    it('should load a label and populate its users', async () => {
      const label = await labelRepository.findOne({
        where: { name: 'TEST_TITLE_2' },
      });

      expect(label).not.toBeNull();

      const populated = await labelRepository.findOneAndPopulate(label!.id);

      expect(populated).not.toBeNull();
      expect(populated!.name).toBe(label!.name);
      expect(populated!.group ?? null).toBeNull();

      const expectedFixture = labelFixtures.find(
        ({ name }) => name === label!.name,
      );
      expect(expectedFixture).toBeDefined();

      expect(populated).toEqualPayload(expectedFixture!, [
        ...IGNORED_TEST_FIELDS,
        'users',
        'group',
      ]);

      const subscribers = await subscriberRepository.findAll();
      const expectedUsers = [...subscribers].sort(sortById);
      const actualUsers = [...(populated!.users ?? [])].sort(sortById);

      expect(actualUsers).toEqualPayload(expectedUsers);
    });
  });

  describe('findAllAndPopulate', () => {
    it('should load every label with populated users', async () => {
      const populated = await labelRepository.findAllAndPopulate({
        order: { name: 'asc' },
      });

      expect(populated).toHaveLength(labelFixtures.length);

      const populatedNames = populated.map(({ name }) => name).sort();
      const expectedNames = labelFixtures.map(({ name }) => name).sort();
      expect(populatedNames).toEqual(expectedNames);

      const subscribers = await subscriberRepository.findAll();
      const expectedUsers = [...subscribers].sort(sortById);

      populated.forEach((label) => {
        expect(label.group ?? null).toBeNull();

        const actualUsers = [...(label.users ?? [])].sort(sortById);
        expect(actualUsers).toEqualPayload(expectedUsers);
      });
    });
  });

  describe('findAndPopulate', () => {
    it('should filter labels and populate matching results', async () => {
      const targetNames = labelFixtures.slice(0, 2).map(({ name }) => name);
      const results = await labelRepository.findAndPopulate({
        where: { name: In(targetNames) },
      });

      expect(results).toHaveLength(2);

      const resultNames = results.map(({ name }) => name).sort();
      expect(resultNames).toEqual([...targetNames].sort());

      const subscribers = await subscriberRepository.findAll();
      const expectedUsers = [...subscribers].sort(sortById);

      results.forEach((label) => {
        const fixture = labelFixtures.find(({ name }) => name === label.name);
        expect(fixture).toBeDefined();
        expect(label).toEqualPayload(fixture!, [
          ...IGNORED_TEST_FIELDS,
          'users',
          'group',
        ]);

        const actualUsers = [...(label.users ?? [])].sort(sortById);
        expect(actualUsers).toEqualPayload(expectedUsers);
      });
    });
  });
});

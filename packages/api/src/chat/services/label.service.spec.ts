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

import { LabelRepository } from '../repositories/label.repository';
import { SubscriberRepository } from '../repositories/subscriber.repository';

import { LabelService } from './label.service';

const sortById = <T extends { id?: string }>(row1: T, row2: T) =>
  (row1.id ?? '').localeCompare(row2.id ?? '');

describe('LabelService (TypeORM)', () => {
  let labelService: LabelService;
  let labelRepository: LabelRepository;
  let subscriberRepository: SubscriberRepository;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [LabelService, SubscriberRepository],
      typeorm: {
        fixtures: installSubscriberFixturesTypeOrm,
      },
    });

    [labelService, labelRepository, subscriberRepository] =
      await testing.getMocks([
        LabelService,
        LabelRepository,
        SubscriberRepository,
      ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('findAllAndPopulate', () => {
    it('should find all labels and populate users', async () => {
      jest.spyOn(labelRepository, 'findAllAndPopulate');

      const result = await labelService.findAllAndPopulate({
        order: { name: 'ASC' },
      });

      expect(labelRepository.findAllAndPopulate).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });

      expect(result).toHaveLength(labelFixtures.length);

      const resultNames = result.map(({ name }) => name).sort();
      const expectedNames = labelFixtures.map(({ name }) => name).sort();
      expect(resultNames).toEqual(expectedNames);

      const subscribers = await subscriberRepository.findAll();
      const expectedUsers = [...subscribers].sort(sortById);

      result.forEach((label) => {
        const fixture = labelFixtures.find(({ name }) => name === label.name);
        expect(fixture).toBeDefined();
        expect(label.group ?? null).toBeNull();
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

  describe('findAndPopulate', () => {
    it('should find matching labels and populate users', async () => {
      const targetNames = labelFixtures.slice(0, 2).map(({ name }) => name);

      jest.spyOn(labelRepository, 'findAndPopulate');

      const result = await labelService.findAndPopulate({
        where: { name: In(targetNames) },
        order: { name: 'ASC' },
      });

      expect(labelRepository.findAndPopulate).toHaveBeenCalledWith({
        where: { name: In(targetNames) },
        order: { name: 'ASC' },
      });

      expect(result).toHaveLength(targetNames.length);

      const resultNames = result.map(({ name }) => name).sort();
      expect(resultNames).toEqual([...targetNames].sort());

      const subscribers = await subscriberRepository.findAll();
      const expectedUsers = [...subscribers].sort(sortById);

      result.forEach((label) => {
        const fixture = labelFixtures.find(({ name }) => name === label.name);
        expect(fixture).toBeDefined();
        expect(label.group ?? null).toBeNull();
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

  describe('findOneAndPopulate', () => {
    it('should load a label by id and populate its users', async () => {
      jest.spyOn(labelRepository, 'findOneAndPopulate');

      const label = await labelRepository.findOne({
        where: { name: 'TEST_TITLE_1' },
      });

      expect(label).not.toBeNull();

      const result = await labelService.findOneAndPopulate(label!.id);

      expect(labelRepository.findOneAndPopulate).toHaveBeenCalledWith(
        label!.id,
      );

      expect(result).not.toBeNull();
      expect(result!.group ?? null).toBeNull();

      const fixture = labelFixtures.find(({ name }) => name === label!.name);
      expect(fixture).toBeDefined();
      expect(result).toEqualPayload(fixture!, [
        ...IGNORED_TEST_FIELDS,
        'users',
        'group',
      ]);

      const subscribers = await subscriberRepository.findAll();
      const expectedUsers = [...subscribers].sort(sortById);
      const actualUsers = [...(result!.users ?? [])].sort(sortById);
      expect(actualUsers).toEqualPayload(expectedUsers);
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { TestingModule } from '@nestjs/testing';

import {
  groupedLabelFixtures,
  installLabelGroupFixturesTypeOrm,
  labelGroupFixtures,
} from '@/utils/test/fixtures/label-group';
import { buildTestingMocks } from '@/utils/test/utils';

import { LabelGroupRepository } from './label-group.repository';
import { LabelRepository } from './label.repository';

describe('LabelGroupRepository (TypeORM)', () => {
  let module: TestingModule;
  let labelRepository: LabelRepository;
  let labelGroupRepository: LabelGroupRepository;
  const createdLabelIds: string[] = [];
  const createdGroupIds: string[] = [];

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [LabelRepository, LabelGroupRepository],
      typeorm: {
        fixtures: installLabelGroupFixturesTypeOrm,
      },
    });

    module = testing.module;

    [labelRepository, labelGroupRepository] = await testing.getMocks([
      LabelRepository,
      LabelGroupRepository,
    ]);
  });

  afterEach(async () => {
    jest.clearAllMocks();

    if (createdLabelIds.length > 0) {
      const ids = createdLabelIds.splice(0);
      await Promise.all(ids.map((id) => labelRepository.deleteOne(id)));
    }

    if (createdGroupIds.length > 0) {
      const ids = createdGroupIds.splice(0);
      await Promise.all(ids.map((id) => labelGroupRepository.deleteOne(id)));
    }
  });

  describe('populate helpers', () => {
    it('exposes supported relations', () => {
      expect(labelGroupRepository.getPopulateRelations()).toEqual(['labels']);
    });

    it('validates supported populate queries', () => {
      expect(labelGroupRepository.canPopulate(['labels'])).toBe(true);
      expect(labelGroupRepository.canPopulate(['unknown'])).toBe(false);
    });
  });

  describe('findAll', () => {
    it('returns all stored label groups', async () => {
      const results = await labelGroupRepository.findAll({
        order: { name: 'asc' },
      });

      expect(results).toHaveLength(labelGroupFixtures.length);
      const names = results.map(({ name }) => name).sort();
      const expectedNames = labelGroupFixtures.map(({ name }) => name).sort();
      expect(names).toEqual(expectedNames);
    });
  });

  describe('findAllAndPopulate', () => {
    it('returns all label groups with their labels populated', async () => {
      const results = await labelGroupRepository.findAllAndPopulate({
        order: { name: 'asc' },
      });

      expect(results).toHaveLength(labelGroupFixtures.length);
      const subscription = results.find(
        ({ name }) => name === labelGroupFixtures[0].name,
      );
      expect(subscription).toBeDefined();
      const labelNames = (subscription?.labels ?? [])
        .map(({ name }) => name)
        .sort();
      const expectedNames = groupedLabelFixtures.map(({ name }) => name).sort();
      expect(labelNames).toEqual(expectedNames);
    });
  });

  describe('find', () => {
    it('filters label groups based on criteria', async () => {
      const targetName = labelGroupFixtures[0].name;
      const results = await labelGroupRepository.find({
        where: { name: targetName },
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe(targetName);
    });
  });

  describe('findOne', () => {
    it('retrieves a label group by id', async () => {
      const [existing] = await labelGroupRepository.findAll();
      const result = await labelGroupRepository.findOne(existing.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(existing.id);
      expect(result?.name).toBe(existing.name);
    });

    it('retrieves a label group using options', async () => {
      const targetName = labelGroupFixtures[0].name;
      const result = await labelGroupRepository.findOne({
        where: { name: targetName },
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe(targetName);
    });
  });

  describe('findAndPopulate', () => {
    it('retrieves populated label groups using options', async () => {
      const targetName = labelGroupFixtures[0].name;
      const results = await labelGroupRepository.findAndPopulate({
        where: { name: targetName },
      });

      expect(results).toHaveLength(1);
      const [group] = results;
      expect(group?.name).toBe(targetName);
      const labelNames = (group?.labels ?? []).map(({ name }) => name).sort();
      const expectedNames = groupedLabelFixtures.map(({ name }) => name).sort();
      expect(labelNames).toEqual(expectedNames);
    });
  });

  describe('create', () => {
    it('persists a new label group', async () => {
      const name = `Group-${randomUUID()}`;
      const created = await labelGroupRepository.create({ name });
      createdGroupIds.push(created.id);

      expect(created.name).toBe(name);

      const stored = await labelGroupRepository.findOne(created.id);
      expect(stored?.name).toBe(name);
    });
  });

  describe('updateOne', () => {
    it('updates an existing label group', async () => {
      const name = `Group-${randomUUID()}`;
      const created = await labelGroupRepository.create({ name });
      createdGroupIds.push(created.id);

      const updatedName = `Group-${randomUUID()}`;
      const updated = await labelGroupRepository.updateOne(created.id, {
        name: updatedName,
      });

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(updatedName);

      const stored = await labelGroupRepository.findOne(created.id);
      expect(stored?.name).toBe(updatedName);
    });
  });

  describe('deleteOne', () => {
    it('should reset labels to null when their group is deleted', async () => {
      const newGroup = await labelGroupRepository.create({
        name: `Group-${randomUUID()}`,
      });
      createdGroupIds.push(newGroup.id);

      const newLabel = await labelRepository.create({
        title: `Orphan Label ${randomUUID()}`,
        name: `ORPHAN_LABEL_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        group: newGroup.id,
      });
      createdLabelIds.push(newLabel.id);

      const result = await labelGroupRepository.deleteOne(newGroup.id);

      expect(result).toEqual({
        acknowledged: true,
        deletedCount: 1,
      });

      const groupIndex = createdGroupIds.indexOf(newGroup.id);
      if (groupIndex !== -1) {
        createdGroupIds.splice(groupIndex, 1);
      }

      const orphanLabel = await labelRepository.findOne({
        where: { id: newLabel.id },
      });

      expect(orphanLabel).toBeDefined();
      expect(orphanLabel?.group).toBeNull();
    });
  });
});

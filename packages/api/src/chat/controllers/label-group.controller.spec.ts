/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';

import { NOT_FOUND_ID } from '@/utils/constants/mock';
import {
  installLabelGroupFixturesTypeOrm,
  labelGroupFixtures,
} from '@/utils/test/fixtures/label-group';
import { buildTestingMocks } from '@/utils/test/utils';

import { LabelGroupCreateDto } from '../dto/label-group.dto';
import { LabelGroupService } from '../services/label-group.service';

import { LabelGroupController } from './label-group.controller';

describe('LabelGroupController', () => {
  let labelGroupController: LabelGroupController;
  let labelGroupService: LabelGroupService;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [LabelGroupController],
      typeorm: {
        fixtures: installLabelGroupFixturesTypeOrm,
      },
    });

    [labelGroupController, labelGroupService] = await testing.getMocks([
      LabelGroupController,
      LabelGroupService,
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  describe('findPage', () => {
    it('should find label groups', async () => {
      const expected = await labelGroupService.find({});
      jest.spyOn(labelGroupService, 'find').mockResolvedValue(expected);

      const result = await labelGroupController.findLabelGroups([], {});

      expect(labelGroupService.find).toHaveBeenCalledWith({});
      expect(result).toEqualPayload(expected);
    });

    it('should find label groups with populated labels', async () => {
      const expected = await labelGroupService.findAndPopulate({});
      jest
        .spyOn(labelGroupService, 'findAndPopulate')
        .mockResolvedValue(expected);

      const result = await labelGroupController.findLabelGroups(['labels'], {});

      expect(labelGroupService.findAndPopulate).toHaveBeenCalledWith({});
      expect(result).toEqualPayload(expected);
    });
  });

  describe('findOne', () => {
    it('should find one label by id', async () => {
      const target = await labelGroupService.findOne({
        where: { name: labelGroupFixtures[0].name },
      });
      expect(target).toBeDefined();

      jest.spyOn(labelGroupService, 'findOne');
      const result = await labelGroupController.findLabelGroup(target!.id, []);

      expect(labelGroupService.findOne).toHaveBeenCalledWith(target!.id);
      expect(result).toEqualPayload(labelGroupFixtures[0]);
    });

    it('should find one label group with populated labels', async () => {
      const target = await labelGroupService.findOne({
        where: { name: labelGroupFixtures[0].name },
      });
      expect(target).toBeDefined();

      jest.spyOn(labelGroupService, 'findOneAndPopulate');
      const result = await labelGroupController.findLabelGroup(target!.id, [
        'labels',
      ]);

      expect(labelGroupService.findOneAndPopulate).toHaveBeenCalledWith(
        target!.id,
      );
      expect(result.labels).toBeDefined();
    });
  });

  describe('create', () => {
    it('should create a label group', async () => {
      jest.spyOn(labelGroupService, 'create');
      const payload: LabelGroupCreateDto = {
        name: 'Sector',
      };
      const result = await labelGroupController.create(payload);

      expect(labelGroupService.create).toHaveBeenCalledWith(payload);
      expect(result.name).toBe(payload.name);
    });
  });

  describe('deleteOne', () => {
    it('should delete one label by id', async () => {
      const labelGroupToDelete = await labelGroupService.create({
        name: 'To Be Deleted',
      });
      jest.spyOn(labelGroupService, 'deleteOne');
      const result = await labelGroupController.deleteOne(
        labelGroupToDelete.id,
      );

      expect(labelGroupService.deleteOne).toHaveBeenCalledWith(
        labelGroupToDelete.id,
      );
      expect(result).toEqual({
        acknowledged: true,
        deletedCount: 1,
      });
    });

    it('should throw a NotFoundException when attempting to delete a non existing label by id', async () => {
      await expect(
        labelGroupController.deleteOne(NOT_FOUND_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateOne', () => {
    it('should update a label by id', async () => {
      const labelGroupToBeUpdated = await labelGroupService.create({
        name: 'To Be Updated',
      });
      jest.spyOn(labelGroupService, 'updateOne');
      const result = await labelGroupController.updateOne(
        labelGroupToBeUpdated.id,
        { name: 'Updated' },
      );

      expect(labelGroupService.updateOne).toHaveBeenCalledWith(
        labelGroupToBeUpdated.id,
        { name: 'Updated' },
      );
      expect(result.name).toBe('Updated');
    });

    it('should throw a NotFoundException when attempting to update a non existing label by id', async () => {
      await expect(
        labelGroupController.updateOne(NOT_FOUND_ID, { name: 'Foo Bar' }),
      ).rejects.toThrow();
    });
  });

  describe('deleteMany', () => {
    it('should delete multiple label groups', async () => {
      const labelGroups = (
        await labelGroupService.createMany([
          { name: 'Group 1' },
          { name: 'Group 2' },
        ])
      ).map(({ id }) => id);
      const result = await labelGroupController.deleteLabelGroups(labelGroups);

      expect(result.deletedCount).toEqual(labelGroups.length);
      const remainingValues = await labelGroupService.find({
        where: { id: In(labelGroups) },
      });

      expect(remainingValues.length).toBe(0);
    });

    it('should throw BadRequestException when no IDs are provided', async () => {
      await expect(labelGroupController.deleteMany([])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when provided IDs do not exist', async () => {
      const nonExistentIds = [NOT_FOUND_ID, NOT_FOUND_ID.replace(/9/g, '8')];

      await expect(
        labelGroupController.deleteMany(nonExistentIds),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

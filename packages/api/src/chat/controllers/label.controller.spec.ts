/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { Label } from '@hexabot-ai/types';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';

import { installLabelFixturesTypeOrm } from '@/utils/test/fixtures/label';
import { installSubscriberFixturesTypeOrm } from '@/utils/test/fixtures/subscriber';
import { buildTestingMocks } from '@/utils/test/utils';

import { LabelCreateDto, LabelUpdateDto } from '../dto/label.dto';
import { LabelService } from '../services/label.service';

import { LabelController } from './label.controller';

const randomString = () => Math.random().toString(36).slice(2, 10);
const createUniqueLabelName = () => `LABEL_${randomString().toUpperCase()}`;
const createUniqueLabelTitle = () => `Label ${randomString()}`;

describe('LabelController (TypeORM)', () => {
  let module: TestingModule;
  let labelController: LabelController;
  let labelService: LabelService;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [LabelController],
      typeorm: {
        fixtures: [
          installLabelFixturesTypeOrm,
          installSubscriberFixturesTypeOrm,
        ],
      },
    });

    module = testing.module;

    [labelController, labelService] = await testing.getMocks([
      LabelController,
      LabelService,
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('findPage', () => {
    it('should find labels without population', async () => {
      const expected = await labelService.find({});
      const findSpy = jest
        .spyOn(labelService, 'find')
        .mockResolvedValue(expected);
      const result = await labelController.findLabels([], {});

      expect(findSpy).toHaveBeenCalledWith({});
      expect(result).toEqualPayload(expected);
    });

    it('should find labels and populate users', async () => {
      const expected = await labelService.findAndPopulate({});
      const findAndPopulateSpy = jest
        .spyOn(labelService, 'findAndPopulate')
        .mockResolvedValue(expected);
      const result = await labelController.findLabels(['users'], {});

      expect(findAndPopulateSpy).toHaveBeenCalledWith({});
      expect(result).toEqualPayload(expected);
    });
  });

  describe('findOne', () => {
    let existingLabel: Label;

    beforeAll(async () => {
      const all = await labelService.find({});
      if (!all.length) {
        throw new Error('Expected label fixtures to be available');
      }
      const fetched = await labelService.findOne(all[0].id);
      if (!fetched) {
        throw new Error('Expected label to be retrievable by id');
      }
      existingLabel = fetched;
    });

    it('should find one label by id', async () => {
      const findSpy = jest.spyOn(labelService, 'findOne');
      const result = await labelController.findLabel(existingLabel.id, []);

      expect(findSpy).toHaveBeenCalledWith(existingLabel.id);
      expect(result).toEqualPayload(existingLabel);
    });

    it('should find one label and populate users', async () => {
      const findSpy = jest.spyOn(labelService, 'findOneAndPopulate');
      const result = await labelController.findLabel(existingLabel.id, [
        'users',
      ]);

      expect(findSpy).toHaveBeenCalledWith(existingLabel.id);
      expect(result.users).toBeDefined();
      expect(result.users?.length).toBeGreaterThan(0);
    });

    it('should throw NotFoundException when label does not exist', async () => {
      const id = randomUUID();
      const findSpy = jest
        .spyOn(labelService, 'findOne')
        .mockResolvedValueOnce(null);

      await expect(labelController.findLabel(id, [])).rejects.toThrow(
        new NotFoundException(`Label with ID ${id} not found`),
      );
      expect(findSpy).toHaveBeenCalledWith(id);
    });
  });

  describe('create', () => {
    it('should create a label', async () => {
      const payload: LabelCreateDto = {
        title: createUniqueLabelTitle(),
        name: createUniqueLabelName(),
        description: 'A sample label description',
      };
      const createSpy = jest.spyOn(labelService, 'create');
      const result = await labelController.create(payload);

      expect(createSpy).toHaveBeenCalledWith(payload);
      expect(result).toEqualPayload({ ...payload, builtin: false });

      await labelService.deleteOne(result.id);
    });
  });

  describe('updateOne', () => {
    it('should update a label by id', async () => {
      const created = await labelService.create({
        title: createUniqueLabelTitle(),
        name: createUniqueLabelName(),
        description: 'Initial description',
      });
      const updates: LabelUpdateDto = {
        description: 'Updated description',
      };
      const updateSpy = jest.spyOn(labelService, 'updateOne');
      const result = await labelController.updateOne(created.id, updates);

      expect(updateSpy).toHaveBeenCalledWith(created.id, updates);
      expect(result.id).toBe(created.id);
      expect(result.description).toBe(updates.description);

      await labelService.deleteOne(result.id);
    });

    it('should throw NotFoundException when attempting to update a non-existing label', async () => {
      await expect(
        labelController.updateOne(randomUUID(), { description: 'Missing' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOne', () => {
    it('should delete one label by id', async () => {
      const deletable = await labelService.create({
        title: createUniqueLabelTitle(),
        name: createUniqueLabelName(),
        description: 'Label to delete',
      });
      const deleteSpy = jest.spyOn(labelService, 'deleteOne');
      const result = await labelController.deleteOne(deletable.id);

      expect(deleteSpy).toHaveBeenCalledWith(deletable.id);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });

      const lookup = await labelService.findOne(deletable.id);
      expect(lookup).toBeNull();
    });

    it('should throw NotFoundException when deletion result is empty', async () => {
      const id = randomUUID();
      const deleteSpy = jest
        .spyOn(labelService, 'deleteOne')
        .mockResolvedValueOnce({ acknowledged: true, deletedCount: 0 });

      await expect(labelController.deleteOne(id)).rejects.toThrow(
        new NotFoundException(`Label with ID ${id} not found`),
      );
      expect(deleteSpy).toHaveBeenCalledWith(id);
    });
  });

  describe('deleteMany', () => {
    it('should delete multiple labels', async () => {
      const created = await labelService.createMany([
        {
          title: createUniqueLabelTitle(),
          name: createUniqueLabelName(),
        },
        {
          title: createUniqueLabelTitle(),
          name: createUniqueLabelName(),
        },
      ]);
      const ids = created.map(({ id }) => id);
      const result = await labelController.deleteMany(ids);

      expect(result).toEqualPayload({
        acknowledged: true,
        deletedCount: ids.length,
      });

      const remaining = await labelService.find({
        where: { id: In(ids) },
      });
      expect(remaining).toHaveLength(0);
    });

    it('should throw NotFoundException when provided IDs do not exist', async () => {
      const ids = [randomUUID(), randomUUID()];

      await expect(labelController.deleteMany(ids)).rejects.toThrow(
        new NotFoundException('Labels with provided IDs not found'),
      );
    });

    it('should throw BadRequestException when no IDs are provided', async () => {
      await expect(labelController.deleteMany([])).rejects.toThrow(
        new BadRequestException('No IDs provided for deletion.'),
      );
    });
  });
});

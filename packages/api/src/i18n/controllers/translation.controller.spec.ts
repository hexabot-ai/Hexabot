/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { NotFoundException } from '@nestjs/common';
import { FindManyOptions } from 'typeorm';

import { NOT_FOUND_ID } from '@/utils/constants/mock';
import {
  installTranslationFixturesTypeOrm,
  translationFixtures,
} from '@/utils/test/fixtures/translation';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import { buildTestingMocks } from '@/utils/test/utils';
import { WorkflowService } from '@/workflow/services/workflow.service';

import { TranslationUpdateDto } from '../dto/translation.dto';
import { TranslationOrmEntity } from '../entities/translation.entity';
import { TranslationService } from '../services/translation.service';

import { TranslationController } from './translation.controller';

describe('TranslationController', () => {
  let translationController: TranslationController;
  let translationService: TranslationService;
  let translation: TranslationOrmEntity;

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [TranslationController],
      providers: [
        {
          provide: WorkflowService,
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          } as Partial<WorkflowService>,
        },
        I18nServiceProvider,
      ],
      typeorm: [
        {
          fixtures: installTranslationFixturesTypeOrm,
        },
      ],
    });
    [translationService, translationController] = await getMocks([
      TranslationService,
      TranslationController,
    ]);
    translation = (await translationService.findOne({
      where: { str: 'Welcome' },
    })) as TranslationOrmEntity;
  });

  afterEach(jest.clearAllMocks);

  describe('findOne', () => {
    it('should find one translation by id', async () => {
      jest.spyOn(translationService, 'findOne');
      const result = await translationController.findOne(translation.id);

      expect(translationService.findOne).toHaveBeenCalledWith(translation.id);
      expect(result).toEqualPayload(
        translationFixtures.find(
          ({ str }) => str === translation.str,
        ) as TranslationOrmEntity,
      );
    });
  });

  describe('find', () => {
    it('should find translations', async () => {
      jest.spyOn(translationService, 'find');
      const options: FindManyOptions<TranslationOrmEntity> = {};
      const result = await translationController.findPage(options);

      expect(translationService.find).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload(translationFixtures);
    });
  });

  describe('updateOne', () => {
    const translationUpdateDto: TranslationUpdateDto = {
      str: 'Welcome !',
    };
    it('should update one translation by id', async () => {
      jest.spyOn(translationService, 'updateOne');
      const result = await translationController.updateOne(
        translation.id,
        translationUpdateDto,
      );

      expect(translationService.updateOne).toHaveBeenCalledWith(
        translation.id,
        translationUpdateDto,
      );
      expect(result).toEqualPayload({
        ...translationFixtures.find(({ str }) => str === translation.str),
        ...translationUpdateDto,
      });
    });

    it('should throw a NotFoundException when attempting to update a translation by id', async () => {
      jest.spyOn(translationService, 'updateOne');
      await expect(
        translationController.updateOne(NOT_FOUND_ID, translationUpdateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

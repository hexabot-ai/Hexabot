/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Language } from '@hexabot-ai/types';
import { NotFoundException } from '@nestjs/common';
import { FindManyOptions } from 'typeorm';

import { NOT_FOUND_ID } from '@/utils/constants/mock';
import {
  installLanguageFixturesTypeOrm,
  languageFixtures,
} from '@/utils/test/fixtures/language';
import { buildTestingMocks } from '@/utils/test/utils';

import { LanguageUpdateDto } from '../dto/language.dto';
import { LanguageOrmEntity } from '../entities/language.entity';
import { LanguageService } from '../services/language.service';

import { LanguageController } from './language.controller';

describe('LanguageController', () => {
  let languageController: LanguageController;
  let languageService: LanguageService;
  let language: Language;

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [LanguageController],
      typeorm: {
        fixtures: installLanguageFixturesTypeOrm,
      },
    });
    [languageService, languageController] = await getMocks([
      LanguageService,
      LanguageController,
    ]);
    language = (await languageService.findOne({
      where: {
        code: 'en',
      },
    }))!;
  });

  afterEach(jest.clearAllMocks);

  describe('findOne', () => {
    it('should find one translation by id', async () => {
      jest.spyOn(languageService, 'findOne');
      const result = await languageController.findOne(language.id);

      expect(languageService.findOne).toHaveBeenCalledWith(language.id);
      expect(result).toEqualPayload(
        languageFixtures.find(
          ({ code }) => code === language.code,
        ) as LanguageOrmEntity,
      );
    });
  });

  describe('find', () => {
    it('should find languages', async () => {
      const options: FindManyOptions<LanguageOrmEntity> = {
        order: {
          code: 'ASC',
        },
      };
      jest.spyOn(languageService, 'find');
      const result = await languageController.findPage(options);

      expect(languageService.find).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload(
        languageFixtures.slice().sort(({ code: codeA }, { code: codeB }) => {
          if (codeA < codeB) {
            return -1;
          }
          if (codeA > codeB) {
            return 1;
          }

          return 0;
        }),
      );
    });
  });

  describe('updateOne', () => {
    const translationUpdateDto: LanguageUpdateDto = {
      title: 'English (US)',
    };
    it('should update one language by id', async () => {
      jest.spyOn(languageService, 'updateOne');
      const result = await languageController.updateOne(
        language.id,
        translationUpdateDto,
      );

      expect(languageService.updateOne).toHaveBeenCalledWith(
        language.id,
        translationUpdateDto,
      );
      expect(result).toEqualPayload({
        ...languageFixtures.find(({ code }) => code === language.code),
        ...translationUpdateDto,
      });
    });

    it('should mark a language as default', async () => {
      jest.spyOn(languageService, 'updateOne');
      const translationUpdateDto = { isDefault: true };
      const frLang = (await languageService.findOne({
        where: {
          code: 'fr',
        },
      })) as LanguageOrmEntity;
      const result = await languageController.updateOne(
        frLang.id,
        translationUpdateDto,
      );

      expect(languageService.updateOne).toHaveBeenCalledWith(
        frLang.id,
        translationUpdateDto,
      );
      expect(result).toEqualPayload({
        ...languageFixtures.find(({ code }) => code === frLang.code),
        ...translationUpdateDto,
      });

      const enLang = (await languageService.findOne({
        where: {
          code: 'en',
        },
      })) as LanguageOrmEntity;
      expect(enLang.isDefault).toBe(false);
    });

    it('should throw a NotFoundException when attempting to update a translation by id', async () => {
      jest.spyOn(languageService, 'updateOne');
      await expect(
        languageController.updateOne(NOT_FOUND_ID, translationUpdateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOne', () => {
    it('should throw when attempting to delete the default language', async () => {
      const defaultLang = (await languageService.findOne({
        where: {
          isDefault: true,
        },
      }))!;
      await expect(
        languageController.deleteOne(defaultLang.id),
      ).rejects.toThrow();
    });
  });
});

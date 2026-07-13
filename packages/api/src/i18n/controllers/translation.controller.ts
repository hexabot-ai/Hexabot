/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FindManyOptions } from 'typeorm';
import { DeleteResult } from 'typeorm/driver/mongodb/typings';

import { UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import { TranslationUpdateDto } from '../dto/translation.dto';
import { TranslationOrmEntity } from '../entities/translation.entity';
import { LanguageService } from '../services/language.service';
import { TranslationService } from '../services/translation.service';

@Controller('translation')
export class TranslationController extends BaseOrmController<TranslationOrmEntity> {
  constructor(
    private readonly languageService: LanguageService,
    protected readonly translationService: TranslationService,
  ) {
    super(translationService);
  }

  @Get()
  async findPage(
    @Query(
      new TypeOrmSearchFilterPipe<TranslationOrmEntity>({
        allowedFields: ['str'],
      }),
    )
    options: FindManyOptions<TranslationOrmEntity>,
  ) {
    return await this.translationService.find(options);
  }

  /**
   * Counts the filtered number of translations.
   * @returns A promise that resolves to an object representing the filtered number of translations.
   */
  @Get('count')
  async filterCount(
    @Query(
      new TypeOrmSearchFilterPipe<TranslationOrmEntity>({
        allowedFields: ['str'],
      }),
    )
    options: FindManyOptions<TranslationOrmEntity> = {},
  ) {
    return await this.count(options);
  }

  @Get(':id')
  async findOne(@UuidParam('id') id: string) {
    const translation = await this.translationService.findOne(id);
    if (!translation) {
      this.logger.warn(`Unable to find Translation by id ${id}`);
      throw new NotFoundException(`Translation with ID ${id} not found`);
    }

    return translation;
  }

  @Patch(':id')
  async updateOne(
    @UuidParam('id') id: string,
    @Body() translationUpdate: TranslationUpdateDto,
  ) {
    return await this.translationService.updateOne(id, translationUpdate);
  }

  /**
   * Refresh translations : Add new strings and remove old ones
   */
  @Post('refresh')
  async refresh(): Promise<DeleteResult> {
    const defaultLanguage = await this.languageService.getDefaultLanguage();
    const languages = await this.languageService.getLanguages();
    const defaultTrans: TranslationOrmEntity['translations'] = Object.keys(
      languages,
    )
      .filter((lang) => lang !== defaultLanguage.code)
      .reduce(
        (acc, curr) => {
          acc[curr] = '';

          return acc;
        },
        {} as { [key: string]: string },
      );

    return await this.translationService.refreshWorkflowTranslations(
      defaultTrans,
    );
  }

  /**
   * Deletes a translation by its ID.
   * @param id - The ID of the translation to be deleted.
   * @returns A Promise that resolves to the deletion result.
   */
  @Delete(':id')
  @HttpCode(204)
  async deleteTranslation(@UuidParam('id') id: string): Promise<DeleteResult> {
    return await this.deleteOne(id);
  }
}

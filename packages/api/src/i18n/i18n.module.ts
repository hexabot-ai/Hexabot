/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  DynamicModule,
  Global,
  InternalServerErrorException,
  Module,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { I18nOptions, I18nModule as NativeI18nModule } from 'nestjs-i18n';

import { WorkflowModule } from '@/workflow/workflow.module';

import { LanguageController } from './controllers/language.controller';
import { TranslationController } from './controllers/translation.controller';
import { LanguageOrmEntity } from './entities/language.entity';
import { TranslationOrmEntity } from './entities/translation.entity';
import { LanguageRepository } from './repositories/language.repository';
import { TranslationRepository } from './repositories/translation.repository';
import { LanguageSeeder } from './seeds/language.seed';
import { TranslationSeeder } from './seeds/translation.seed';
import { I18nService } from './services/i18n.service';
import { LanguageService } from './services/language.service';
import { TranslationService } from './services/translation.service';

// No constructor: Nest then injects what the installed nestjs-i18n declares.
// Restating its parameters broke on 10.8, which added `loaders` and
// `middleware`, so a request rejected before routing (an invalid CSRF token)
// crashed the library's error middleware into a 500.
@Global()
@Module({})
export class I18nModule extends NativeI18nModule {
  static forRoot(options: I18nOptions): DynamicModule {
    const { imports, providers, controllers, exports } = super.forRoot(options);
    if (!providers || !exports) {
      throw new InternalServerErrorException(
        'I18n: Unable to find providers and/or exports forRoot()',
      );
    }

    return {
      module: I18nModule,
      imports: (imports || []).concat([
        TypeOrmModule.forFeature([LanguageOrmEntity, TranslationOrmEntity]),
        WorkflowModule,
      ]),
      controllers: (controllers || []).concat([
        LanguageController,
        TranslationController,
      ]),
      providers: providers.concat([
        I18nService,
        LanguageRepository,
        LanguageService,
        LanguageSeeder,
        TranslationRepository,
        TranslationService,
        TranslationSeeder,
      ]),
      exports: exports.concat(I18nService, LanguageService),
    };
  }
}

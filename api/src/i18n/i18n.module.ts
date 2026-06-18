/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  DynamicModule,
  Global,
  Inject,
  InternalServerErrorException,
  Module,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import {
  I18N_OPTIONS,
  I18N_TRANSLATIONS,
  I18nMiddleware,
  I18nOptions,
  I18nTranslation,
  I18nModule as NativeI18nModule,
} from 'nestjs-i18n';
import { Observable } from 'rxjs';

import { ChatModule } from '@/chat/chat.module';

import { I18nController } from './controllers/i18n.controller';
import { LanguageController } from './controllers/language.controller';
import { TranslationController } from './controllers/translation.controller';
import { LanguageRepository } from './repositories/language.repository';
import { TranslationRepository } from './repositories/translation.repository';
import { LanguageModel } from './schemas/language.schema';
import { TranslationModel } from './schemas/translation.schema';
import { LanguageSeeder } from './seeds/language.seed';
import { TranslationSeeder } from './seeds/translation.seed';
import { I18nService } from './services/i18n.service';
import { LanguageService } from './services/language.service';
import { TranslationService } from './services/translation.service';

@Global()
@Module({})
export class I18nModule extends NativeI18nModule {
  constructor(
    i18n: I18nService,
    @Inject(I18N_TRANSLATIONS)
    translations: Observable<I18nTranslation>,
    @Inject(I18N_OPTIONS) i18nOptions: I18nOptions,
    adapter: HttpAdapterHost,
    middleware: I18nMiddleware,
  ) {
    super(i18n, translations, i18nOptions, adapter, middleware);
  }

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
        MongooseModule.forFeature([LanguageModel, TranslationModel]),
        ChatModule,
      ]),
      controllers: (controllers || []).concat([
        LanguageController,
        TranslationController,
        I18nController,
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

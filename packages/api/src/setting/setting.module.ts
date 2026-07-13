/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { extensionNodeModulesGlobs } from '@/utils/helpers/extension-globs';

import { SettingController } from './controllers/setting.controller';
import { MetadataOrmEntity } from './entities/metadata.entity';
import { SettingOrmEntity } from './entities/setting.entity';
import { MetadataRepository } from './repositories/metadata.repository';
import { SettingRepository } from './repositories/setting.repository';
import { MetadataSeeder } from './seeds/metadata.seed';
import { SettingSeeder } from './seeds/setting.seed';
import { MetadataService } from './services/metadata.service';
import { RuntimeSettingsService } from './services/runtime-settings.service';
import { SettingService } from './services/setting.service';

const runtimeSettingProviderPatterns = [
  // Built-in core settings groups
  'dist/setting/**/*.settings.js',
  // Built-in core extension settings groups. Channel source settings are
  // owned by channel handlers and are intentionally not discovered here.
  'dist/extensions/**/*.settings.js',
  ...(process.env.NODE_ENV === 'test'
    ? []
    : [
        // API package settings groups installed via npm
        'node_modules/@hexabot-ai/api/dist/**/*.settings.js',
        // Community settings groups installed via npm, wherever the package
        // manager placed them (flat install, hoisted workspace root, …)
        ...extensionNodeModulesGlobs('hexabot-*/**/*.settings.js'),
      ]),
] as const;

@Global()
@InjectDynamicProviders(...runtimeSettingProviderPatterns)
@Module({
  imports: [TypeOrmModule.forFeature([SettingOrmEntity, MetadataOrmEntity])],
  providers: [
    SettingRepository,
    MetadataRepository,
    SettingSeeder,
    MetadataSeeder,
    SettingService,
    RuntimeSettingsService,
    MetadataService,
  ],
  controllers: [SettingController],
  exports: [SettingService, MetadataService, RuntimeSettingsService],
})
export class SettingModule {}

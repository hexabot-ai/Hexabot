/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { ChatModule } from '@/chat/chat.module';
import { CmsModule } from '@/cms/cms.module';
import { extensionNodeModulesGlobs } from '@/utils/helpers/extension-globs';

import { HelperController } from './helper.controller';
import { HelperService } from './helper.service';

@Global()
@InjectDynamicProviders(
  // Built-in core helpers
  'node_modules/@hexabot-ai/api/dist/extensions/helpers/**/*.helper.js',
  // Community extensions installed via npm, wherever the package manager
  // placed them (flat install, hoisted workspace root, …)
  ...extensionNodeModulesGlobs('hexabot-helper-*/**/*.helper.js'),
  // Custom & under dev helpers
  'dist/extensions/helpers/**/*.helper.js',
)
@Module({
  imports: [HttpModule, CmsModule, ChatModule],
  controllers: [HelperController],
  providers: [HelperService],
  exports: [HelperService],
})
export class HelperModule {}

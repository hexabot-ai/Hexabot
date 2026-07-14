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

import { HelperController } from './helper.controller';
import { HelperService } from './helper.service';

@Global()
@InjectDynamicProviders(
  // Built-in core helpers
  'node_modules/@hexabot-ai/api/dist/extensions/helpers/**/*.helper.js',
  // Community extensions installed in the API package
  'node_modules/hexabot-helper-*/**/*.helper.js',
  // Community extensions installed at the workspace root
  '../../node_modules/hexabot-helper-*/**/*.helper.js',
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

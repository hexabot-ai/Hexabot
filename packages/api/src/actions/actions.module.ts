/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Global, Module } from '@nestjs/common';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { ActionService } from './actions.service';

@Global()
@InjectDynamicProviders(
  // Built-in core actions
  'node_modules/@hexabot-ai/api/dist/extensions/actions/**/*.action.js',
  // Community extensions installed in the API package
  'node_modules/hexabot-action-*/**/*.action.js',
  // Community extensions installed at the workspace root
  '../../node_modules/hexabot-action-*/**/*.action.js',
  // Custom & under dev actions
  'dist/extensions/actions/**/*.action.js',
)
@Module({
  providers: [ActionService],
  exports: [ActionService],
})
export class ActionsModule {}

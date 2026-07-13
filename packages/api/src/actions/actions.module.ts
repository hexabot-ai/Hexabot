/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Global, Module } from '@nestjs/common';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { extensionNodeModulesGlobs } from '@/utils/helpers/extension-globs';

import { ActionService } from './actions.service';

@Global()
@InjectDynamicProviders(
  // Built-in core actions
  'node_modules/@hexabot-ai/api/dist/extensions/actions/**/*.action.js',
  // Community extensions installed via npm, wherever the package manager
  // placed them (flat install, hoisted workspace root, …)
  ...extensionNodeModulesGlobs('hexabot-action-*/**/*.action.js'),
  // Custom & under dev actions
  'dist/extensions/actions/**/*.action.js',
)
@Module({
  providers: [ActionService],
  exports: [ActionService],
})
export class ActionsModule {}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Global, Module } from '@nestjs/common';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { extensionNodeModulesGlobs } from '@/utils/helpers/extension-globs';

import { RuntimeBindingsService } from './runtime-bindings.service';

@Global()
@InjectDynamicProviders(
  // Built-in core runtime binding kinds
  'node_modules/@hexabot-ai/api/dist/extensions/actions/**/*.binding.js',
  // Community runtime binding kinds installed via npm, wherever the package
  // manager placed them (flat install, hoisted workspace root, …)
  ...extensionNodeModulesGlobs('hexabot-action-*/**/*.binding.js'),
  // Custom & under dev runtime binding kinds
  'dist/extensions/actions/**/*.binding.js',
)
@Module({
  providers: [RuntimeBindingsService],
  exports: [RuntimeBindingsService],
})
export class BindingsModule {}

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Files marking the root of a project or workspace. The node_modules walk
 * never escapes the first ancestor containing one of these, so extensions
 * are only discovered inside the current project.
 */
const PROJECT_ROOT_MARKERS = [
  '.git',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'bun.lock',
  'bun.lockb',
];
const isProjectRoot = (dir: string): boolean =>
  PROJECT_ROOT_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));

/**
 * Build glob patterns matching npm-installed extension files in the
 * node_modules directories Node's module resolver would consult from this
 * package. Installers place extensions differently depending on the layout
 * (flat npm/yarn install in the starter template, hoisted root node_modules
 * in a pnpm workspace, …); mirroring `module.paths` keeps discovery aligned
 * with wherever `require()` would actually find the extension.
 *
 * Only node_modules directories that exist are kept, and the walk stops at
 * the project/workspace root instead of continuing to the filesystem root.
 */
export const extensionNodeModulesGlobs = (pattern: string): string[] => {
  const globs: string[] = [];

  for (const nodeModulesDir of module.paths) {
    if (fs.existsSync(nodeModulesDir)) {
      globs.push([nodeModulesDir.split(path.sep).join('/'), pattern].join('/'));
    }

    if (isProjectRoot(path.dirname(nodeModulesDir))) {
      break;
    }
  }

  return globs;
};

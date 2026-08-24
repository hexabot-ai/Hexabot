/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createRequire } from 'node:module';

const ADD_PACKAGE_COMMANDS: Record<string, string> = {
  npm: 'npm i',
  pnpm: 'pnpm add',
  yarn: 'yarn add',
  bun: 'bun add',
};
const requirePackage = createRequire(__filename);

export const getAddPackageCommand = (packageName: string) => {
  const packageManager = process.env.npm_config_user_agent?.split('/')[0] ?? '';
  const command = ADD_PACKAGE_COMMANDS[packageManager] ?? 'npm i';

  return `${command} ${packageName}`;
};

export const isPackageInstalled = (packageName: string) => {
  try {
    requirePackage.resolve(packageName);

    return true;
  } catch {
    return false;
  }
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { updateProjectConfig, type HexabotConfig } from './config.js';
import { bootstrapEnvFile, resolveEnvExample } from './env.js';
import {
  detectPackageManager,
  normalizePackageManager,
} from './package-manager.js';

/**
 * Picks the package manager (`--pm`, then the project config, then the
 * lockfile) and records it in the project config.
 */
export const resolveProjectPackageManager = (
  projectRoot: string,
  config: HexabotConfig,
  pmOption?: string,
) => {
  const pm =
    normalizePackageManager(pmOption) ||
    config.packageManager ||
    detectPackageManager(projectRoot);

  if (config.packageManager !== pm) {
    updateProjectConfig(projectRoot, { packageManager: pm });
  }

  return pm;
};

/** Creates the Docker or local env file from its example when it is missing. */
export const bootstrapProjectEnv = (
  projectRoot: string,
  config: HexabotConfig,
  options: { docker?: boolean; env?: string },
) => {
  if (options.docker) {
    bootstrapEnvFile(projectRoot, config.env.dockerExample, config.env.docker);

    return;
  }

  const envFile = options.env || config.env.local;
  const envExample = resolveEnvExample(
    projectRoot,
    envFile,
    config.env.localExample,
  );
  bootstrapEnvFile(projectRoot, envExample, envFile);
};

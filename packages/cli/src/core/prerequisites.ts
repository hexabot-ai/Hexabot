/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { execSync } from 'child_process';

import chalk from 'chalk';

const REQUIRED_NODE_VERSION = '24.17.0';

export interface PrerequisiteOptions {
  docker?: boolean;
  silent?: boolean;
  fatal?: boolean;
}

export interface PrerequisiteCheckResult {
  ok: boolean;
  message: string;
  details?: string;
}

export const checkPrerequisites = (options: PrerequisiteOptions = {}) => {
  checkNodeVersion(options);
  if (options.docker) {
    checkDocker(options);
    checkDockerCompose(options);
  }
};

export const checkNodeVersion = (
  options: PrerequisiteOptions = {},
): PrerequisiteCheckResult => {
  try {
    const nodeVersion = execSync('node --version', {
      encoding: 'utf-8',
    }).trim();
    const currentNodeVersion = normalizeVersion(nodeVersion);

    if (compareVersions(currentNodeVersion, REQUIRED_NODE_VERSION) >= 0) {
      const message = `Node.js ${nodeVersion} ✓`;
      logSuccess(message, options);

      return { ok: true, message };
    }

    const message = `Node.js version must be at least ${REQUIRED_NODE_VERSION}. Current version: ${nodeVersion}.`;
    handleFailure(message, options);

    return { ok: false, message };
  } catch (error) {
    const message =
      "Node.js is not accessible or installed correctly. Install Node.js v24.17.0+ and ensure it's in your PATH.";

    handleFailure(message, options, error);

    return { ok: false, message, details: (error as Error).message };
  }
};

export const checkDocker = (
  options: PrerequisiteOptions = {},
): PrerequisiteCheckResult => {
  try {
    const dockerVersion = execSync('docker --version', {
      encoding: 'utf-8',
    }).trim();
    const message = `Docker is installed: ${dockerVersion}`;
    logSuccess(message, options);

    return { ok: true, message };
  } catch (error) {
    const message =
      'Docker is required for this command. Please install Docker.';
    handleFailure(message, options, error);

    return { ok: false, message, details: (error as Error).message };
  }
};

export const checkDockerCompose = (
  options: PrerequisiteOptions = {},
): PrerequisiteCheckResult => {
  try {
    const composeVersion = execSync('docker compose version', {
      encoding: 'utf-8',
    }).trim();
    const message = `Docker Compose is installed: ${composeVersion}`;
    logSuccess(message, options);

    return { ok: true, message };
  } catch (error) {
    const message =
      'Docker Compose (v2) is required for this command. Please install or update Docker Desktop / the Compose plugin.';
    handleFailure(message, options, error);

    return { ok: false, message, details: (error as Error).message };
  }
};

const normalizeVersion = (version: string) => {
  return version.startsWith('v') ? version.slice(1) : version;
};
const compareVersions = (current: string, required: string) => {
  const currentParts = current.split('.').map(Number);
  const requiredParts = required.split('.').map(Number);

  for (let i = 0; i < requiredParts.length; i++) {
    if ((currentParts[i] || 0) > (requiredParts[i] || 0)) {
      return 1;
    } else if ((currentParts[i] || 0) < (requiredParts[i] || 0)) {
      return -1;
    }
  }

  return 0;
};
const logSuccess = (message: string, options: PrerequisiteOptions) => {
  if (!options.silent) {
    console.log(chalk.green(message));
  }
};
const handleFailure = (
  message: string,
  options: PrerequisiteOptions,
  error?: unknown,
) => {
  console.error(chalk.red(message));

  if (options.fatal !== false) {
    if (error && options.silent) {
      console.error(chalk.red((error as Error).message));
    }
    process.exit(1);
  }
};

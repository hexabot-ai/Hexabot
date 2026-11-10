/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';

import chalk from 'chalk';

import type { PackageManager } from './package-manager.js';

export interface DockerConfig {
  composeFile: string;
  defaultServices: string[];
}

export interface EnvConfig {
  local: string;
  localExample: string;
  docker: string;
  dockerExample: string;
}

export interface HexabotConfig {
  devScript: string;
  startScript: string;
  packageManager?: PackageManager;
  docker: DockerConfig;
  env: EnvConfig;
}

const CONFIG_FILE_NAME = 'hexabot.config.json';
const DEFAULT_CONFIG: HexabotConfig = {
  devScript: 'dev',
  startScript: 'start',
  docker: {
    composeFile: 'docker/docker-compose.yml',
    defaultServices: [],
  },
  env: {
    local: '.env',
    localExample: '.env.example',
    docker: '.env.docker',
    dockerExample: '.env.docker.example',
  },
};

export const resolveConfigPath = (projectRoot = process.cwd()) => {
  return path.join(projectRoot, CONFIG_FILE_NAME);
};

export const loadProjectConfig = (projectRoot = process.cwd()) => {
  const configPath = resolveConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HexabotConfig>;

    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (error) {
    console.warn(chalk.yellow('Invalid hexabot.config.json. Using defaults.'));
    console.warn(chalk.yellow((error as Error).message));

    return { ...DEFAULT_CONFIG };
  }
};

export const ensureProjectConfig = (
  projectRoot = process.cwd(),
  overrides: Partial<HexabotConfig> = {},
) => {
  const configPath = resolveConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) {
    const config = mergeConfig(DEFAULT_CONFIG, overrides);
    writeProjectConfig(config, projectRoot);

    return config;
  }

  if (Object.keys(overrides).length > 0) {
    return updateProjectConfig(projectRoot, overrides);
  }

  return loadProjectConfig(projectRoot);
};

const writeProjectConfig = (
  config: HexabotConfig,
  projectRoot = process.cwd(),
) => {
  const configPath = resolveConfigPath(projectRoot);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
};

export const updateProjectConfig = (
  projectRoot: string,
  overrides: Partial<HexabotConfig>,
) => {
  const existing = loadProjectConfig(projectRoot);
  const next = mergeConfig(existing, overrides);
  writeProjectConfig(next, projectRoot);

  return next;
};

const mergeConfig = (
  base: HexabotConfig,
  overrides: Partial<HexabotConfig>,
): HexabotConfig => {
  return {
    ...base,
    ...overrides,
    docker: {
      ...base.docker,
      ...(overrides.docker || {}),
    },
    env: {
      ...base.env,
      ...(overrides.env || {}),
    },
  };
};

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as path from 'path';

import { Command } from 'commander';

import { runProjectCompose } from '../core/compose.js';
import { loadProjectConfig } from '../core/config.js';
import { runPackageScript } from '../core/package-manager.js';
import {
  bootstrapProjectEnv,
  resolveProjectPackageManager,
} from '../core/project-run.js';
import { assertHexabotProject } from '../core/project.js';

export interface StartOptions {
  docker?: boolean;
  services?: string;
  detach?: boolean;
  build?: boolean;
  env?: string;
  envBootstrap?: boolean;
  pm?: string;
  cwd?: string;
}

export const registerStartCommand = (program: Command) => {
  program
    .command('start')
    .description('Run the project in production mode')
    .option('--docker', 'Run using Docker (production stack)')
    .option('--services <list>', 'Comma-separated services/profiles to enable')
    .option('-d, --detach', 'Detach Docker containers')
    .option('--build', 'Build Docker images before starting')
    .option('--env <file>', 'Env file to use (default: .env)')
    .option('--env-bootstrap', 'Generate env files from *.example if missing')
    .option('--pm <npm|pnpm|yarn|bun>', 'Override package manager')
    .action(async (options: StartOptions) => {
      await runStart(options);
    });
};

export const runStart = async (options: StartOptions = {}) => {
  const projectRoot = path.resolve(options.cwd || process.cwd());
  assertHexabotProject(projectRoot);
  const config = loadProjectConfig(projectRoot);
  const pm = resolveProjectPackageManager(projectRoot, config, options.pm);

  if (options.envBootstrap) {
    bootstrapProjectEnv(projectRoot, config, options);
  }

  if (options.docker) {
    const upArgs = ['up'];
    if (options.build) {
      upArgs.push('--build');
    }
    if (options.detach) {
      upArgs.push('-d');
    }

    runProjectCompose(projectRoot, config, {
      services: options.services,
      mode: 'prod',
      args: upArgs,
      action: 'Starting Docker services in production mode',
    });
  } else {
    runPackageScript(pm, config.startScript, projectRoot);
  }
};

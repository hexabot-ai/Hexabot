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

export interface DevOptions {
  docker?: boolean;
  services?: string;
  detach?: boolean;
  env?: string;
  envBootstrap?: boolean;
  pm?: string;
  cwd?: string;
}

export const registerDevCommand = (program: Command) => {
  program
    .command('dev')
    .description('Run the current Hexabot project in development mode')
    .option('--docker', 'Run using Docker')
    .option(
      '--services <list>',
      'Comma-separated services or profiles to enable',
    )
    .option('-d, --detach', 'Detach Docker containers (Docker mode only)')
    .option('--env <file>', 'Env file to use for local dev (default: .env)')
    .option('--no-env-bootstrap', 'Skip env bootstrapping')
    .option('--pm <npm|pnpm|yarn|bun>', 'Override package manager')
    .action(async (options: DevOptions) => {
      await runDev(options);
    });
};

export const runDev = async (options: DevOptions = {}) => {
  const projectRoot = path.resolve(options.cwd || process.cwd());
  assertHexabotProject(projectRoot);
  const config = loadProjectConfig(projectRoot);
  const pm = resolveProjectPackageManager(projectRoot, config, options.pm);

  if (options.envBootstrap !== false) {
    bootstrapProjectEnv(projectRoot, config, options);
  }

  if (options.docker) {
    const upArgs = ['up', '--build'];
    if (options.detach) {
      upArgs.push('-d');
    }

    runProjectCompose(projectRoot, config, {
      services: options.services,
      mode: 'dev',
      args: upArgs,
      action: 'Starting Docker services',
    });
  } else {
    runPackageScript(pm, config.devScript, projectRoot);
  }
};

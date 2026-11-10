/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as path from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { runProjectCompose } from '../core/compose.js';
import { loadProjectConfig } from '../core/config.js';
import { assertHexabotProject } from '../core/project.js';

export interface StopOptions {
  docker?: boolean;
  services?: string;
  volumes?: boolean;
  removeOrphans?: boolean;
  cwd?: string;
}

export const registerStopCommand = (program: Command) => {
  program
    .command('stop')
    .description('Stop the Docker stack started with `dev`/`start`')
    .option('--docker', 'Stop the Docker services (required)')
    .option('--services <list>', 'Comma-separated services/profiles to stop')
    .option('-v, --volumes', 'Remove named volumes declared by the stack')
    .option('--remove-orphans', 'Remove containers not defined in the stack')
    .action(async (options: StopOptions) => {
      await runStop(options);
    });
};

export const runStop = async (options: StopOptions = {}) => {
  const projectRoot = path.resolve(options.cwd || process.cwd());
  assertHexabotProject(projectRoot);

  if (!options.docker) {
    console.error(chalk.red('`hexabot stop` only manages the Docker stack.'));
    console.log(
      chalk.yellow(
        'Run `hexabot stop --docker`. Local `dev`/`start` runs in the foreground—press Ctrl+C to stop it.',
      ),
    );
    process.exit(1);
  }

  const config = loadProjectConfig(projectRoot);
  const downArgs = ['down'];
  if (options.volumes) {
    downArgs.push('--volumes');
  }
  if (options.removeOrphans) {
    downArgs.push('--remove-orphans');
  }

  runProjectCompose(projectRoot, config, {
    services: options.services,
    args: downArgs,
    action: 'Stopping Docker services',
  });
};

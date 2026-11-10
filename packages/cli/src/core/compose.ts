/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import chalk from 'chalk';

import { parseServices } from '../utils/services.js';

import type { HexabotConfig } from './config.js';
import {
  dockerCompose,
  generateComposeFiles,
  resolveComposeEnvFile,
  resolveComposeFile,
  type ComposeMode,
} from './docker.js';
import { checkDocker } from './prerequisites.js';
import { ensureDockerFolder } from './project.js';

/**
 * Runs `docker compose <args>` over the project's compose files for the
 * requested services, or the configured default services.
 */
export const runProjectCompose = (
  projectRoot: string,
  config: HexabotConfig,
  {
    services: servicesOption,
    mode,
    args,
    action,
  }: {
    services?: string;
    mode?: ComposeMode;
    args: string[];
    /** Log prefix, e.g. "Starting Docker services". */
    action: string;
  },
) => {
  checkDocker({ silent: true });
  ensureDockerFolder(projectRoot);
  const servicesInput = parseServices(servicesOption || '');
  const services = servicesInput.length
    ? servicesInput
    : config.docker.defaultServices;
  const composeFile = resolveComposeFile(
    projectRoot,
    config.docker.composeFile,
  );
  const envFile = resolveComposeEnvFile(projectRoot, config.env.docker);
  const composeArgs = mode
    ? generateComposeFiles(composeFile, services, mode)
    : generateComposeFiles(composeFile, services);
  const composeCommand = `${composeArgs} ${args.join(' ')}`.trim();
  console.log(
    chalk.blue(
      `${action}${services.length ? ` (${services.join(', ')})` : ''}`,
    ),
  );
  dockerCompose(composeCommand, { envFile });
};

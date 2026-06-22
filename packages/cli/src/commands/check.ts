/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import chalk from 'chalk';
import { Command } from 'commander';

import { loadProjectConfig } from '../core/config.js';
import { listEnvStatus } from '../core/env.js';
import {
  checkDocker,
  checkDockerCompose,
  checkNodeVersion,
} from '../core/prerequisites.js';
import { isHexabotProject } from '../core/project.js';

interface CheckCommandOptions {
  dockerOnly?: boolean;
  docker?: boolean;
  noDocker?: boolean;
}

export const registerCheckCommand = (program: Command) => {
  program
    .command('check')
    .description('Run diagnostic checks')
    .option('--docker-only', 'Only run Docker checks')
    .option('--no-docker', 'Skip Docker checks')
    .action((options: CheckCommandOptions) => {
      runDiagnostics({
        dockerOnly: options.dockerOnly,
        noDocker: options.noDocker ?? options.docker === false,
      });
    });
};

const runDiagnostics = (options: {
  dockerOnly?: boolean;
  noDocker?: boolean;
}) => {
  const projectRoot = process.cwd();
  const onlyDocker = options.dockerOnly;
  const skipDocker = options.noDocker;
  const results: DiagnosticResult[] = [];

  if (!onlyDocker) {
    const nodeResult = checkNodeVersion({ fatal: false, silent: true });
    results.push({
      label: 'Node.js version',
      ok: nodeResult.ok,
      message: nodeResult.message,
    });

    const projectResult = isHexabotProject(projectRoot);
    results.push({
      label: 'Hexabot project',
      ok: projectResult,
      message: projectResult
        ? 'Found @hexabot-ai/api in package.json'
        : 'Run inside a Hexabot project directory',
    });

    if (projectResult) {
      const config = loadProjectConfig(projectRoot);
      const envStatuses = listEnvStatus(projectRoot, config);
      envStatuses.forEach((status) => {
        results.push({
          label: `Env file ${status.file}`,
          ok: status.exists,
          message: status.exists ? 'Found' : 'Missing',
        });
      });
    }
  }

  if (!skipDocker) {
    const dockerResult = checkDocker({ fatal: false, silent: true });
    results.push({
      label: 'Docker',
      ok: dockerResult.ok,
      message: dockerResult.message,
    });

    const dockerComposeResult = checkDockerCompose({
      fatal: false,
      silent: true,
    });
    results.push({
      label: 'Docker Compose',
      ok: dockerComposeResult.ok,
      message: dockerComposeResult.message,
    });
  }

  const hasErrors = results.some((result) => !result.ok);
  results.forEach((result) => printResult(result));

  if (hasErrors) {
    process.exitCode = 1;
  }
};

interface DiagnosticResult {
  label: string;
  ok: boolean;
  message?: string;
}

const printResult = (result: DiagnosticResult) => {
  const status = result.ok ? chalk.green('PASS') : chalk.red('FAIL');
  console.log(
    `${status} ${result.label}${result.message ? ` — ${result.message}` : ''}`,
  );
};

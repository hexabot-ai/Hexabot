/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';

import chalk from 'chalk';

const DOCKER_FOLDER_NAME = 'docker';
const HEXABOT_PACKAGE = '@hexabot-ai/api';

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export const readPackageJson = (
  projectRoot = process.cwd(),
): PackageJson | null => {
  try {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  } catch (_error) {
    return null;
  }
};

export const isHexabotProject = (projectRoot = process.cwd()) => {
  const packageJson = readPackageJson(projectRoot);
  if (!packageJson) {
    return false;
  }

  return hasHexabotDependency(packageJson);
};

export const assertHexabotProject = (projectRoot = process.cwd()) => {
  if (!isHexabotProject(projectRoot)) {
    console.error(
      chalk.red(
        'This command must be executed inside a Hexabot project (missing @hexabot-ai/api in package.json).',
      ),
    );
    console.log(
      chalk.yellow(
        'Run `hexabot create <project>` or navigate to your project.',
      ),
    );
    process.exit(1);
  }
};

export const resolveDockerFolder = (projectRoot = process.cwd()) => {
  return path.resolve(projectRoot, `./${DOCKER_FOLDER_NAME}`);
};

export const ensureDockerFolder = (projectRoot = process.cwd()) => {
  const folder = resolveDockerFolder(projectRoot);

  if (!fs.existsSync(folder)) {
    console.error(
      chalk.red(
        `The '${DOCKER_FOLDER_NAME}' folder is missing. Docker commands require the Hexabot project's docker/ directory.`,
      ),
    );
    console.log(
      chalk.yellow(
        `Ensure you're at the project root (e.g. cd path/to/my-bot) before running Docker commands.`,
      ),
    );
    process.exit(1);
  }

  return folder;
};

const hasHexabotDependency = (packageJson: PackageJson) => {
  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  return Boolean(allDeps[HEXABOT_PACKAGE]);
};

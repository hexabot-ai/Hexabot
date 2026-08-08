/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';

import { input, password } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command } from 'commander';

import { ensureProjectConfig, loadProjectConfig } from '../core/config.js';
import { bootstrapEnvFile, upsertEnvVariables } from '../core/env.js';
import {
  detectPackageManager,
  installDependencies,
  normalizePackageManager,
} from '../core/package-manager.js';
import { downloadAndExtractTemplate } from '../services/templates.js';
import { validateProjectName } from '../utils/validation.js';

import { runDev } from './dev.js';

const DEFAULT_TEMPLATE_REPO = 'hexastack/hexabot-template-starter';

interface CreateCommandOptions {
  template?: string;
  pm?: string;
  install?: boolean;
  dev?: boolean;
  docker?: boolean;
  force?: boolean;
}

interface AdminSeedCredentials {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export const registerCreateCommand = (program: Command) => {
  program
    .command('create <projectName>')
    .description('Create a new Hexabot project from the starter')
    .option(
      '-t, --template <name>',
      'Project template to use (default: starter)',
    )
    .option('--pm <npm|pnpm|yarn|bun>', 'Preferred package manager')
    .option('--no-install', 'Skip installing dependencies')
    .option('--dev', 'Run hexabot dev after creation (local SQLite by default)')
    .option(
      '--docker',
      'Show Docker/Postgres next steps and use Docker mode with --dev',
    )
    .option('--force', 'Allow scaffolding into a non-empty directory')
    .action(createProject);
};

const createProject = async (
  projectName: string,
  options: CreateCommandOptions,
) => {
  if (!validateProjectName(projectName)) {
    console.error(
      chalk.red(
        'Invalid project name. Use lowercase letters, numbers, and dashes.',
      ),
    );
    process.exit(1);
  }

  const projectPath = path.join(process.cwd(), projectName);
  ensureTargetDirectory(projectPath, options.force);

  const templateRepo = resolveTemplateRepo(options.template);
  console.log(chalk.blue(`Using template ${templateRepo}`));

  try {
    const latestTag = await fetchLatestReleaseTag(templateRepo);
    const templateUrl = `https://github.com/${templateRepo}/archive/refs/tags/${latestTag}.zip`;
    await downloadAndExtractTemplate(templateUrl, projectPath);

    const pmPreference = normalizePackageManager(options.pm);
    const detectedPm = detectPackageManager(projectPath);
    const packageManager = pmPreference || detectedPm;
    const configOverrides: Partial<ReturnType<typeof loadProjectConfig>> = {
      packageManager,
    };

    ensureProjectConfig(projectPath, configOverrides);
    const config = loadProjectConfig(projectPath);
    const dockerEnvBootstrapped = bootstrapCreateEnvFiles(projectPath, config);
    const adminCredentials = await promptSeedAdminCredentials();
    persistAdminSeedCredentials(
      projectPath,
      config,
      adminCredentials,
      dockerEnvBootstrapped,
      projectName,
    );

    if (!options.install) {
      console.log(
        chalk.yellow('Skipping dependency installation (--no-install).'),
      );
    } else {
      console.log(
        chalk.blue(`Installing dependencies with ${packageManager}...`),
      );
      installDependencies(packageManager, projectPath);
    }

    logSuccessMessage(projectName, { docker: options.docker });

    if (options.dev) {
      if (!options.install) {
        console.log(
          chalk.yellow(
            'Dependencies were not installed. Run `npm install` before `--dev`.',
          ),
        );
      } else {
        console.log(chalk.blue('Starting dev server...'));
        await runDev({
          cwd: projectPath,
          docker: options.docker,
        });
      }
    }
  } catch (error) {
    console.error(chalk.red('Error creating project.'), error);
    process.exit(1);
  }
};
const resolveTemplateRepo = (template?: string) => {
  if (!template) {
    return DEFAULT_TEMPLATE_REPO;
  }

  if (template.includes('/')) {
    return template;
  }

  return `hexastack/hexabot-template-${template}`;
};
const ensureTargetDirectory = (projectPath: string, force?: boolean) => {
  if (fs.existsSync(projectPath)) {
    const isEmpty = fs.readdirSync(projectPath).length === 0;
    if (!isEmpty && !force) {
      console.error(
        chalk.red(
          `Directory ${projectPath} is not empty. Use --force to scaffold anyway.`,
        ),
      );
      process.exit(1);
    }
  } else {
    fs.mkdirSync(projectPath, { recursive: true });
  }
};
const fetchLatestReleaseTag = async (templateRepo: string) => {
  const response = await fetch(
    `https://api.github.com/repos/${templateRepo}/releases/latest`,
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Failed to fetch the latest release information: ${data.message}`,
    );
  }

  return data.tag_name;
};
const bootstrapCreateEnvFiles = (
  projectPath: string,
  config: ReturnType<typeof loadProjectConfig>,
) => {
  bootstrapEnvFile(projectPath, config.env.localExample, config.env.local, {
    quiet: true,
  });

  return bootstrapEnvFile(
    projectPath,
    config.env.dockerExample,
    config.env.docker,
    { quiet: true },
  );
};
const buildAdminSeedVariables = (credentials: AdminSeedCredentials) => {
  return {
    SEED_ADMIN_FIRST_NAME: credentials.firstName,
    SEED_ADMIN_LAST_NAME: credentials.lastName,
    SEED_ADMIN_EMAIL: credentials.email,
    SEED_ADMIN_PASSWORD: credentials.password,
  };
};
const persistAdminSeedCredentials = (
  projectPath: string,
  config: ReturnType<typeof loadProjectConfig>,
  credentials: AdminSeedCredentials,
  dockerEnvBootstrapped: boolean,
  projectName: string,
) => {
  const seedVariables = buildAdminSeedVariables(credentials);
  upsertEnvVariables(projectPath, config.env.local, seedVariables);

  if (
    dockerEnvBootstrapped ||
    fs.existsSync(path.join(projectPath, config.env.docker))
  ) {
    upsertEnvVariables(projectPath, config.env.docker, {
      ...seedVariables,
      COMPOSE_PROJECT_NAME: projectName,
    });
  }
};
const requireValue = (label: string) => {
  return (value: string) => {
    if (!value.trim()) {
      return `${label} is required.`;
    }

    return true;
  };
};
const validateEmail = (value: string) => {
  if (!value.trim()) {
    return 'Email is required.';
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(value.trim())) {
    return 'Enter a valid email address.';
  }

  return true;
};
const validateAdminPassword = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Password is required.';
  }

  // Keep the rule simple and explicit for CLI UX. Complexity policies vary by org.
  const minLength = 8;
  if (trimmed.length < minLength) {
    return `Password must be at least ${minLength} characters.`;
  }

  return true;
};
const assertInteractiveTerminal = () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'hexabot create requires an interactive terminal to capture admin credentials.',
    );
  }
};
const promptSeedAdminCredentials = async (): Promise<AdminSeedCredentials> => {
  assertInteractiveTerminal();

  console.log('\n');
  console.log(chalk.bold('Admin account'));
  console.log(
    chalk.gray(
      'These details will be used to create the first admin user during setup.',
    ),
  );
  console.log(
    chalk.gray(
      'You can update them later from the generated environment file before starting the app.',
    ),
  );
  console.log('\n');

  const firstName = (
    await input({
      message: 'First name:',
      validate: requireValue('First name'),
    })
  ).trim();
  const lastName = (
    await input({
      message: 'Last name:',
      validate: requireValue('Last name'),
    })
  ).trim();
  const email = (
    await input({
      message: 'Email:',
      validate: validateEmail,
    })
  ).trim();
  const adminPassword = await password({
    message: 'Password:',
    mask: '*',
    validate: validateAdminPassword,
  });
  await password({
    message: 'Confirm password:',
    mask: '*',
    validate: (value: string) => {
      if (value !== adminPassword) {
        return 'Passwords do not match.';
      }

      return true;
    },
  });

  return {
    firstName,
    lastName,
    email,
    password: adminPassword,
  };
};
const logSuccessMessage = (
  projectName: string,
  options: { docker?: boolean },
) => {
  console.log('\n');
  console.log(chalk.green(`🎉 Project ${projectName} created successfully.`));
  console.log('\n');
  console.log(chalk.bgYellow(`Next steps:`));
  console.log(chalk.gray(`1. Navigate to the project folder:`));
  console.log(chalk.yellow(`   cd ${projectName}`));
  if (options.docker) {
    console.log(chalk.gray(`2. Start dev with Docker and Postgres:`));
    console.log(chalk.yellow(`   hexabot dev --docker --services postgres`));
    console.log(chalk.gray(`3. Or start local dev with SQLite:`));
    console.log(chalk.yellow(`   hexabot dev`));
  } else {
    console.log(chalk.gray(`2. Start local dev with SQLite:`));
    console.log(chalk.yellow(`   hexabot dev`));
    console.log(chalk.gray(`3. Or start dev with Docker and Postgres:`));
    console.log(chalk.yellow(`   hexabot dev --docker --services postgres`));
  }
  console.log(chalk.gray(`Env bootstrap completed.`));
  console.log('\n');
  console.log(chalk.blue('Optional: install Hexabot AI coding skills'));
  console.log(
    chalk.gray(
      'Use these with AI coding agents to generate actions and workflows faster:',
    ),
  );
  console.log('\n');
  console.log(chalk.yellow('   npx skills add hexabot-ai/action-creator'));
  console.log(chalk.yellow('   npx skills add hexabot-ai/workflow-writer'));
  console.log('\n');
  console.log(
    chalk.gray(
      'After starting Hexabot, you can generate an MCP token from your profile and connect your favorite AI coding agent.',
    ),
  );
  console.log('\n');
};

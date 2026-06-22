/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { jest } from '@jest/globals';
import { Command } from 'commander';

const loadProjectConfig = jest.fn();
const listEnvStatus = jest.fn();
const checkDocker = jest.fn();
const checkDockerCompose = jest.fn();
const checkNodeVersion = jest.fn();
const isHexabotProject = jest.fn();

jest.unstable_mockModule('../../core/config.js', () => ({
  loadProjectConfig,
}));

jest.unstable_mockModule('../../core/env.js', () => ({
  listEnvStatus,
}));

jest.unstable_mockModule('../../core/prerequisites.js', () => ({
  checkDocker,
  checkDockerCompose,
  checkNodeVersion,
}));

jest.unstable_mockModule('../../core/project.js', () => ({
  isHexabotProject,
}));

let registerCheckCommand: (program: Command) => void;

beforeAll(async () => {
  ({ registerCheckCommand } = await import('../check.js'));
});

beforeEach(() => {
  jest.resetAllMocks();
  process.exitCode = undefined;
});

describe('registerCheckCommand', () => {
  it('runs full diagnostics by default', async () => {
    checkNodeVersion.mockReturnValue({ ok: true, message: 'Node OK' });
    isHexabotProject.mockReturnValue(true);
    loadProjectConfig.mockReturnValue({
      env: {
        local: '.env',
      },
    });
    listEnvStatus.mockReturnValue([
      { file: '.env', exists: true },
      { file: '.env.docker', exists: true },
    ]);
    checkDocker.mockReturnValue({ ok: true, message: 'Docker OK' });
    checkDockerCompose.mockReturnValue({
      ok: true,
      message: 'Docker Compose OK',
    });
    const logs: string[] = [];
    jest.spyOn(console, 'log').mockImplementation((message?: string) => {
      logs.push(String(message));
    });

    const program = new Command();
    registerCheckCommand(program);
    await program.parseAsync(['node', 'test', 'check']);

    expect(logs.join('\n')).toContain('Node.js version');
    expect(logs.join('\n')).toContain('Hexabot project');
    expect(logs.join('\n')).toContain('Env file .env');
    expect(logs.join('\n')).toContain('Docker');
    expect(logs.join('\n')).toContain('Docker Compose');
    expect(process.exitCode).toBeUndefined();
  });

  it('supports docker-only and no-docker modes', async () => {
    checkDocker.mockReturnValue({ ok: true, message: 'Docker OK' });
    checkDockerCompose.mockReturnValue({
      ok: true,
      message: 'Docker Compose OK',
    });
    checkNodeVersion.mockReturnValue({ ok: true, message: 'Node OK' });

    const dockerOnlyProgram = new Command();
    registerCheckCommand(dockerOnlyProgram);
    await dockerOnlyProgram.parseAsync([
      'node',
      'test',
      'check',
      '--docker-only',
    ]);

    expect(checkNodeVersion).not.toHaveBeenCalled();
    expect(isHexabotProject).not.toHaveBeenCalled();
    expect(checkDocker).toHaveBeenCalled();
    expect(checkDockerCompose).toHaveBeenCalled();

    jest.clearAllMocks();
    checkDocker.mockReturnValue({ ok: true, message: 'Docker OK' });
    checkDockerCompose.mockReturnValue({
      ok: true,
      message: 'Docker Compose OK',
    });
    checkNodeVersion.mockReturnValue({ ok: true, message: 'Node OK' });
    const noDockerProgram = new Command();
    registerCheckCommand(noDockerProgram);
    await noDockerProgram.parseAsync(['node', 'test', 'check', '--no-docker']);
    expect(checkDocker).not.toHaveBeenCalled();
    expect(checkDockerCompose).not.toHaveBeenCalled();
  });

  it('sets process exit code when checks fail', async () => {
    checkNodeVersion.mockReturnValue({ ok: true, message: 'Node OK' });
    isHexabotProject.mockReturnValue(false);
    checkDocker.mockReturnValue({ ok: false, message: 'Docker missing' });
    checkDockerCompose.mockReturnValue({
      ok: false,
      message: 'Docker Compose missing',
    });
    const logs: string[] = [];
    jest.spyOn(console, 'log').mockImplementation((message?: string) => {
      logs.push(String(message));
    });

    const program = new Command();
    registerCheckCommand(program);
    await program.parseAsync(['node', 'test', 'check', '--no-docker']);

    expect(logs.join('\n')).toContain('Hexabot project');
    expect(process.exitCode).toBe(1);
  });
});

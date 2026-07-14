/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { WorkflowVersionAction } from '@/workflow/types';

import type { HexabotMcpRequest } from '../types';

import { HexabotWorkflowMcpHelper } from './workflow-mcp.helper';
import { HexabotWorkflowVersionMcpTools } from './workflow-version-mcp.tools';

const actor = {
  id: 'user-id',
  email: 'agent@example.com',
  username: 'agent',
  roles: ['role-id'],
  state: true,
};
const request = {
  hexabotUser: actor,
} as HexabotMcpRequest;
const defaultWorkflowService = () => ({
  findOneAndPopulate: jest.fn().mockResolvedValue({ id: 'workflow-id' }),
});
const defaultWorkflowVersionService = () => ({
  commit: jest.fn(),
  restoreVersion: jest.fn(),
});
const buildWorkflowHelper = (
  workflowService: Record<string, unknown>,
  workflowVersionService: Record<string, unknown>,
) =>
  new HexabotWorkflowMcpHelper(
    workflowService as any,
    workflowVersionService as any,
  );
const buildWorkflowVersionTools = (overrides: Record<string, unknown> = {}) => {
  const workflowService = overrides.workflowService ?? defaultWorkflowService();
  const workflowVersionService =
    overrides.workflowVersionService ?? defaultWorkflowVersionService();
  const actionService =
    overrides.actionService ??
    ({
      getRegistry: jest.fn().mockReturnValue({}),
    } as any);
  const runtimeBindingsService =
    overrides.runtimeBindingsService ??
    ({
      getRegistry: jest.fn().mockReturnValue({}),
    } as any);

  return new HexabotWorkflowVersionMcpTools(
    workflowVersionService as any,
    actionService as any,
    runtimeBindingsService as any,
    buildWorkflowHelper(
      workflowService as Record<string, unknown>,
      workflowVersionService as Record<string, unknown>,
    ),
  );
};

describe('HexabotWorkflowVersionMcpTools', () => {
  it('validates and commits workflow YAML versions', async () => {
    const workflowVersion = { id: 'version-id', version: 1 };
    const workflowVersionService = {
      commit: jest.fn().mockResolvedValue(workflowVersion),
    };
    const tools = buildWorkflowVersionTools({ workflowVersionService });

    await expect(
      tools.commitWorkflowYaml(
        {
          workflowId: 'workflow-id',
          definitionYml: WorkflowOrmEntity.BLANK_DEFINITION_YML,
          message: 'initial workflow',
          action: WorkflowVersionAction.update,
        },
        {},
        request,
      ),
    ).resolves.toEqual(workflowVersion);

    expect(workflowVersionService.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'workflow-id',
        definitionYml: WorkflowOrmEntity.BLANK_DEFINITION_YML,
        createdBy: actor.id,
      }),
    );
  });

  it('uses the current workflow version as the default commit parent', async () => {
    const workflowVersion = { id: 'version-id', version: 4 };
    const workflowService = {
      findOneAndPopulate: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        currentVersion: { id: 'current-version-id' },
      }),
    };
    const workflowVersionService = {
      commit: jest.fn().mockResolvedValue(workflowVersion),
    };
    const tools = buildWorkflowVersionTools({
      workflowService,
      workflowVersionService,
    });

    await expect(
      tools.commitWorkflowYaml(
        {
          workflowId: 'workflow-id',
          definitionYml: WorkflowOrmEntity.BLANK_DEFINITION_YML,
          message: 'draft change',
          action: WorkflowVersionAction.update,
        },
        {},
        request,
      ),
    ).resolves.toEqual(workflowVersion);

    expect(workflowVersionService.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'workflow-id',
        parentVersion: 'current-version-id',
        createdBy: actor.id,
      }),
    );
  });

  it('rolls back workflow YAML by creating a restore snapshot', async () => {
    const restoredVersion = { id: 'restored-version-id', version: 5 };
    const workflowVersionService = {
      restoreVersion: jest.fn().mockResolvedValue(restoredVersion),
    };
    const tools = buildWorkflowVersionTools({ workflowVersionService });

    await expect(
      tools.rollbackWorkflowVersion(
        {
          workflowId: 'workflow-id',
          versionId: 'target-version-id',
          message: 'Rollback to production-safe version',
        },
        {},
        request,
      ),
    ).resolves.toEqual(restoredVersion);

    expect(workflowVersionService.restoreVersion).toHaveBeenCalledWith(
      'workflow-id',
      'target-version-id',
      {
        updatedBy: actor.id,
        message: 'Rollback to production-safe version',
      },
    );
  });

  it('rejects invalid workflow YAML before committing a version', async () => {
    const workflowVersionService = {
      commit: jest.fn(),
    };
    const tools = buildWorkflowVersionTools({ workflowVersionService });

    await expect(
      tools.commitWorkflowYaml(
        {
          workflowId: 'workflow-id',
          definitionYml: 'not: a hexabot workflow',
          action: WorkflowVersionAction.update,
        },
        {},
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(workflowVersionService.commit).not.toHaveBeenCalled();
  });

  it('validates workflow YAML without committing a version', async () => {
    const tools = buildWorkflowVersionTools();

    await expect(
      tools.validateWorkflowYaml({
        definitionYml: WorkflowOrmEntity.BLANK_DEFINITION_YML,
      }),
    ).resolves.toEqual({
      valid: true,
      issues: [],
      definition: expect.objectContaining({
        defs: {},
        flow: [],
        outputs: {},
      }),
    });
  });

  it('lists workflow versions as compact summaries without YAML bodies', async () => {
    const version = {
      id: 'version-id',
      version: 3,
      definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      checksum: 'checksum',
      message: 'Draft update',
      action: WorkflowVersionAction.update,
      parentVersion: null,
      workflow: 'workflow-id',
      createdBy: actor.id,
      createdAt: new Date('2026-05-08T10:00:00.000Z'),
      updatedAt: new Date('2026-05-08T10:00:00.000Z'),
    };
    const workflowVersionService = {
      findAndPopulate: jest.fn().mockResolvedValue([version]),
      count: jest.fn().mockResolvedValue(1),
    };
    const tools = buildWorkflowVersionTools({ workflowVersionService });
    const result = await tools.searchWorkflowVersions({
      workflowId: 'workflow-id',
      limit: 20,
      skip: 0,
      sortBy: 'version',
      sortDirection: 'DESC',
    });

    expect(result).toEqual({
      items: [
        {
          id: 'version-id',
          version: 3,
          checksum: 'checksum',
          message: 'Draft update',
          action: WorkflowVersionAction.update,
          parentVersion: null,
          workflow: 'workflow-id',
          createdBy: actor.id,
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
          definitionYmlByteLength: Buffer.byteLength(
            version.definitionYml,
            'utf8',
          ),
        },
      ],
      total: 1,
      limit: 20,
      skip: 0,
    });
    expect(result.items[0]).not.toHaveProperty('definitionYml');
  });

  it('returns exact workflow YAML chunks with checksum metadata', async () => {
    const version = {
      id: 'version-id',
      version: 3,
      definitionYml: '0123456789',
      checksum: 'checksum',
      workflow: 'workflow-id',
    };
    const workflowVersionService = {
      findOneAndPopulate: jest.fn().mockResolvedValue(version),
    };
    const tools = buildWorkflowVersionTools({ workflowVersionService });

    await expect(
      tools.getWorkflowYaml({
        versionId: 'version-id',
        offset: 3,
        limit: 4,
      }),
    ).resolves.toEqual({
      workflowId: 'workflow-id',
      versionId: 'version-id',
      version: 3,
      checksum: 'checksum',
      definitionYmlByteLength: 10,
      definitionYmlLength: 10,
      chunk: {
        offset: 3,
        limit: 4,
        unit: 'utf8Bytes',
        endOffset: 7,
        length: 4,
        byteLength: 4,
        hasMore: true,
        nextOffset: 7,
      },
      definitionYml: '3456',
    });
    expect(workflowVersionService.findOneAndPopulate).toHaveBeenCalledWith({
      where: {
        id: 'version-id',
      },
    });
  });

  it('chunks workflow YAML on UTF-8 byte offsets without splitting characters', async () => {
    const version = {
      id: 'version-id',
      version: 3,
      definitionYml: 'aé🙂z',
      checksum: 'checksum',
      workflow: 'workflow-id',
    };
    const workflowVersionService = {
      findOneAndPopulate: jest.fn().mockResolvedValue(version),
    };
    const tools = buildWorkflowVersionTools({ workflowVersionService });

    await expect(
      tools.getWorkflowYaml({
        versionId: 'version-id',
        offset: 1,
        limit: 2,
      }),
    ).resolves.toEqual({
      workflowId: 'workflow-id',
      versionId: 'version-id',
      version: 3,
      checksum: 'checksum',
      definitionYmlByteLength: 8,
      definitionYmlLength: 5,
      chunk: {
        offset: 1,
        limit: 2,
        unit: 'utf8Bytes',
        endOffset: 3,
        length: 1,
        byteLength: 2,
        hasMore: true,
        nextOffset: 3,
      },
      definitionYml: 'é',
    });
  });

  it('returns structured workflow YAML validation issues', async () => {
    const tools = buildWorkflowVersionTools();

    await expect(
      tools.validateWorkflowYaml({
        definitionYml: 'not: a hexabot workflow',
      }),
    ).resolves.toEqual({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'schema',
          message: expect.stringContaining('defs'),
        }),
      ]),
    });
  });

  it('validates workflow YAML against the installed action catalog by default', async () => {
    const actionService = {
      getRegistry: jest.fn().mockReturnValue({}),
    };
    const tools = buildWorkflowVersionTools({ actionService });

    await expect(
      tools.validateWorkflowYaml({
        definitionYml: `
defs:
  missing_action:
    kind: task
    action: unknown_action
flow:
  - do: missing_action
outputs:
  result: "=true"
`,
      }),
    ).resolves.toEqual({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_action',
          actionName: 'unknown_action',
          path: ['defs', 'missing_action', 'action'],
          message: expect.stringContaining('unknown_action'),
        }),
      ]),
    });
  });

  it('returns native action schema issues from shared validation', async () => {
    const actionService = {
      getRegistry: jest.fn().mockReturnValue({
        send_message: {
          inputSchema: z.strictObject({ recipient: z.string() }),
          settingSchema: z.strictObject({ channel: z.string() }),
          supportedBindings: [],
        },
      }),
    };
    const tools = buildWorkflowVersionTools({ actionService });

    await expect(
      tools.validateWorkflowYaml({
        definitionYml: `
defs:
  send_message_task:
    kind: task
    action: send_message
flow:
  - do: send_message_task
outputs:
  result: "=true"
`,
      }),
    ).resolves.toEqual({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'action_inputs',
          actionName: 'send_message',
          path: ['defs', 'send_message_task', 'inputs', 'recipient'],
        }),
        expect.objectContaining({
          code: 'action_settings',
          actionName: 'send_message',
          path: ['defs', 'send_message_task', 'settings', 'channel'],
        }),
      ]),
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BadRequestException } from '@nestjs/common';

import { ActionService } from '@/actions/actions.service';
import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import { WorkflowRunRepository } from '@/workflow/repositories/workflow-run.repository';
import { WorkflowRunService } from '@/workflow/services/workflow-run.service';
import { WorkflowVersionService } from '@/workflow/services/workflow-version.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { WorkflowType, WorkflowVersionAction } from '@/workflow/types';

import type { HexabotMcpRequest } from '../types';

import { HexabotWorkflowMcpHelper } from './workflow-mcp.helper';
import { HexabotWorkflowMcpTools } from './workflow-mcp.tools';

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
const creator = {
  ...actor,
  firstName: 'Ada',
  lastName: 'Lovelace',
  sendEmail: false,
  resetCount: 1,
  resetToken: '$2a$10$pendingPasswordResetTokenHash',
  provider: { strategy: 'local' },
};
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
const buildWorkflowTools = (overrides: Record<string, unknown> = {}) => {
  const workflowService = overrides.workflowService ?? {};
  const workflowVersionService =
    overrides.workflowVersionService ?? defaultWorkflowVersionService();

  return new HexabotWorkflowMcpTools(
    workflowService as any,
    buildWorkflowHelper(
      workflowService as Record<string, unknown>,
      workflowVersionService as Record<string, unknown>,
    ),
  );
};

describe('HexabotWorkflowMcpTools', () => {
  it('searches workflows with compact version summaries', async () => {
    const workflow = {
      id: 'workflow-id',
      name: 'Support triage',
      description: null,
      type: WorkflowType.manual,
      schedule: null,
      inputSchema: {},
      builtin: false,
      x: 0,
      y: 0,
      zoom: 1,
      direction: 'horizontal',
      currentVersion: {
        id: 'current-version-id',
        version: 3,
        definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
        checksum: 'current-checksum',
        message: 'Draft update',
        action: WorkflowVersionAction.update,
        parentVersion: null,
        workflow: 'workflow-id',
        createdBy: actor.id,
        createdAt: new Date('2026-05-08T10:00:00.000Z'),
        updatedAt: new Date('2026-05-08T10:00:00.000Z'),
      },
      publishedVersion: null,
      createdBy: null,
      createdAt: new Date('2026-05-08T09:00:00.000Z'),
      updatedAt: new Date('2026-05-08T10:00:00.000Z'),
    };
    const workflowService = {
      findAndPopulate: jest.fn().mockResolvedValue([workflow]),
      count: jest.fn().mockResolvedValue(1),
    };
    const tools = buildWorkflowTools({ workflowService });
    const result = await tools.searchWorkflows({
      limit: 20,
      skip: 0,
      sortBy: 'createdAt',
      sortDirection: 'DESC',
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'workflow-id',
          currentVersion: expect.objectContaining({
            id: 'current-version-id',
            checksum: 'current-checksum',
          }),
          currentVersionId: 'current-version-id',
          publishedVersionId: null,
        }),
      ],
      total: 1,
      limit: 20,
      skip: 0,
    });
    expect(result.items[0].currentVersion).not.toHaveProperty('definitionYml');
  });

  it('returns current and published workflow version status without YAML payloads', async () => {
    const currentVersion = {
      id: 'current-version-id',
      version: 3,
      definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      checksum: 'current-checksum',
      message: 'Draft update',
      action: WorkflowVersionAction.update,
      parentVersion: 'published-version-id',
      workflow: 'workflow-id',
      createdBy: actor.id,
      createdAt: new Date('2026-05-08T10:00:00.000Z'),
      updatedAt: new Date('2026-05-08T10:00:00.000Z'),
    };
    const publishedVersion = {
      id: 'published-version-id',
      version: 2,
      definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      checksum: 'published-checksum',
      message: 'Published update',
      action: WorkflowVersionAction.update,
      parentVersion: null,
      workflow: 'workflow-id',
      createdBy: actor.id,
      createdAt: new Date('2026-05-08T09:00:00.000Z'),
      updatedAt: new Date('2026-05-08T09:00:00.000Z'),
    };
    const workflowService = {
      findOneAndPopulate: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        name: 'Support triage',
        type: WorkflowType.manual,
        currentVersion,
        publishedVersion,
      }),
    };
    const tools = buildWorkflowTools({ workflowService });
    const result = await tools.getWorkflowVersionStatus({
      id: 'workflow-id',
    });

    expect(result).toEqual({
      workflow: {
        id: 'workflow-id',
        name: 'Support triage',
        type: WorkflowType.manual,
      },
      currentVersion: {
        id: 'current-version-id',
        version: 3,
        checksum: 'current-checksum',
        message: 'Draft update',
        action: WorkflowVersionAction.update,
        parentVersion: 'published-version-id',
        workflow: 'workflow-id',
        createdBy: actor.id,
        createdAt: currentVersion.createdAt,
        updatedAt: currentVersion.updatedAt,
      },
      publishedVersion: {
        id: 'published-version-id',
        version: 2,
        checksum: 'published-checksum',
        message: 'Published update',
        action: WorkflowVersionAction.update,
        parentVersion: null,
        workflow: 'workflow-id',
        createdBy: actor.id,
        createdAt: publishedVersion.createdAt,
        updatedAt: publishedVersion.updatedAt,
      },
      currentVersionId: 'current-version-id',
      publishedVersionId: 'published-version-id',
      isPublished: true,
      isCurrentVersionPublished: false,
      hasUnpublishedChanges: true,
    });
    expect(result.currentVersion).not.toHaveProperty('definitionYml');
    expect(result.publishedVersion).not.toHaveProperty('definitionYml');
  });

  it('reduces the workflow creator to its id and name in every workflow summary', async () => {
    const workflow = {
      id: 'workflow-id',
      name: 'Support triage',
      type: WorkflowType.manual,
      currentVersion: { id: 'current-version-id', createdBy: actor.id },
      publishedVersion: null,
      createdBy: creator,
    };
    const workflowService = {
      create: jest.fn().mockResolvedValue({ id: 'workflow-id' }),
      updateOne: jest.fn().mockResolvedValue({ id: 'workflow-id' }),
      findOne: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        currentVersion: 'current-version-id',
      }),
      findOneAndPopulate: jest.fn().mockResolvedValue(workflow),
      findAndPopulate: jest.fn().mockResolvedValue([workflow]),
      count: jest.fn().mockResolvedValue(1),
    };
    const tools = buildWorkflowTools({ workflowService });
    const createdBy = { id: 'user-id', firstName: 'Ada', lastName: 'Lovelace' };
    const summaries = [
      await tools.createWorkflow({ name: 'Support triage' }, {}, request),
      await tools.updateWorkflow(
        { id: 'workflow-id', description: 'Triage' },
        {},
        request,
      ),
      await tools.publishWorkflow({ id: 'workflow-id' }),
      await tools.getWorkflow({ id: 'workflow-id' }),
      (
        await tools.searchWorkflows({
          limit: 20,
          skip: 0,
          sortBy: 'createdAt',
          sortDirection: 'DESC',
        })
      ).items[0],
    ];

    for (const summary of summaries) {
      expect(summary.createdBy).toEqual(createdBy);
      expect(summary.currentVersion?.createdBy).toBe(actor.id);
      expect(JSON.stringify(summary)).not.toContain(creator.resetToken);
      expect(JSON.stringify(summary)).not.toContain(creator.email);
    }
  });

  it('publishes the current workflow version', async () => {
    const publishedWorkflow = {
      id: 'workflow-id',
      currentVersion: { id: 'current-version-id' },
      publishedVersion: { id: 'current-version-id' },
    };
    const workflowService = {
      findOne: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        currentVersion: 'current-version-id',
      }),
      updateOne: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        currentVersion: 'current-version-id',
        publishedVersion: 'current-version-id',
      }),
      findOneAndPopulate: jest.fn().mockResolvedValue(publishedWorkflow),
    };
    const tools = buildWorkflowTools({ workflowService });

    await expect(tools.publishWorkflow({ id: 'workflow-id' })).resolves.toEqual(
      expect.objectContaining({
        id: 'workflow-id',
        currentVersion: { id: 'current-version-id' },
        publishedVersion: { id: 'current-version-id' },
        currentVersionId: 'current-version-id',
        publishedVersionId: 'current-version-id',
      }),
    );
    expect(workflowService.updateOne).toHaveBeenCalledWith('workflow-id', {
      publishedVersion: 'current-version-id',
    });
  });

  it('unpublishes the workflow without changing the current version', async () => {
    const currentWorkflow = {
      id: 'workflow-id',
      currentVersion: { id: 'current-version-id' },
      publishedVersion: { id: 'current-version-id' },
    };
    const unpublishedWorkflow = {
      ...currentWorkflow,
      publishedVersion: null,
    };
    const workflowService = {
      findOneAndPopulate: jest
        .fn()
        .mockResolvedValueOnce(currentWorkflow)
        .mockResolvedValueOnce(unpublishedWorkflow),
      updateOne: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        currentVersion: 'current-version-id',
        publishedVersion: null,
      }),
    };
    const tools = buildWorkflowTools({ workflowService });

    await expect(
      tools.unpublishWorkflow({ id: 'workflow-id' }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'workflow-id',
        currentVersion: { id: 'current-version-id' },
        publishedVersion: null,
        currentVersionId: 'current-version-id',
        publishedVersionId: null,
      }),
    );
    expect(workflowService.updateOne).toHaveBeenCalledWith('workflow-id', {
      publishedVersion: null,
    });
  });
});

describe('HexabotWorkflowMcpTools (TypeORM)', () => {
  let tools: HexabotWorkflowMcpTools;
  let workflowService: WorkflowService;
  const adminRequest = {
    hexabotUser: { ...actor, id: userFixtureIds.admin },
  } as HexabotMcpRequest;
  // `await_reply` is mocked below as a conversational-only action.
  const awaitReplyYml = [
    'defs:',
    '  ask:',
    '    kind: task',
    '    action: await_reply',
    'flow:',
    '  - do: ask',
    'outputs: {}',
  ].join('\n');

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        HexabotWorkflowMcpTools,
        HexabotWorkflowMcpHelper,
        WorkflowService,
        WorkflowVersionService,
        WorkflowRunService,
        WorkflowRunRepository,
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: {
            joinSockets: jest.fn(),
            broadcastWorkflowEvent: jest.fn(),
          },
        },
      ],
      typeorm: {
        fixtures: installUserFixturesTypeOrm,
      },
    });

    [tools, workflowService] = await testing.getMocks([
      HexabotWorkflowMcpTools,
      WorkflowService,
    ]);
  });

  beforeEach(() => {
    jest.spyOn(ActionService.prototype, 'getRegistry').mockReturnValue({
      await_reply: { workflowTypes: [WorkflowType.conversational] },
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates nothing when the definition YAML is invalid, so the same call can be retried', async () => {
    // Without a type, as the workflow gets the default one.
    const args = { name: 'Invalid YAML' };

    await expect(
      tools.createWorkflow(
        { ...args, definitionYml: 'defs: {}\nflow: 42\noutputs: {}\n' },
        {},
        adminRequest,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(
      await workflowService.findOne({ where: { name: args.name } }),
    ).toBeNull();

    const summary = await tools.createWorkflow(
      { ...args, definitionYml: 'defs: {}\nflow: []\noutputs: {}\n' },
      {},
      adminRequest,
    );

    expect(summary).toEqual(
      expect.objectContaining({
        type: WorkflowType.conversational,
        currentVersion: expect.objectContaining({ version: 1 }),
      }),
    );
  });

  it('creates nothing when the definition uses an action the workflow type cannot run', async () => {
    const name = 'Unsupported action';

    await expect(
      tools.createWorkflow(
        {
          name,
          type: WorkflowType.manual,
          definitionYml: awaitReplyYml,
        },
        {},
        adminRequest,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Actions not available in manual workflows: ask (await_reply)',
      ),
    );
    expect(await workflowService.findOne({ where: { name } })).toBeNull();
  });

  it('changes nothing when an update commits a definition the workflow type cannot run', async () => {
    const { id } = await workflowService.create({
      name: 'Manual workflow',
      description: 'Before',
      type: WorkflowType.manual,
      createdBy: userFixtureIds.admin,
    });
    const before = await workflowService.findOne(id);

    await expect(
      tools.updateWorkflow(
        { id, description: 'After', definitionYml: awaitReplyYml },
        {},
        adminRequest,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Actions not available in manual workflows: ask (await_reply)',
      ),
    );
    expect(await workflowService.findOne(id)).toEqual(before);
  });
});

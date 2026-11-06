/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

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

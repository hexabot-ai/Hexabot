/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { NotFoundException } from '@nestjs/common';

import { WorkflowType } from '@/workflow/types';

import type { HexabotMcpRequest } from '../types';

import { HexabotWorkflowRunMcpTools } from './workflow-run-mcp.tools';

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
  findOne: jest.fn(),
  validateManualInput: jest.fn(),
});
const buildWorkflowRunTools = (overrides: Record<string, unknown> = {}) => {
  const workflowService = overrides.workflowService ?? defaultWorkflowService();
  const workflowRunService = overrides.workflowRunService ?? ({} as any);
  const agenticService = overrides.agenticService ?? ({} as any);

  return new HexabotWorkflowRunMcpTools(
    workflowService as any,
    workflowRunService as any,
    agenticService as any,
  );
};

describe('HexabotWorkflowRunMcpTools', () => {
  it('returns the created workflow run summary for manual workflow execution', async () => {
    const run = { id: 'run-id', status: 'finished' };
    const workflowService = {
      findOne: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        type: WorkflowType.manual,
        inputSchema: { type: 'object', properties: {} },
      }),
      validateManualInput: jest.fn().mockReturnValue({ prompt: 'hello' }),
    };
    const agenticService = {
      handleEvent: jest.fn().mockResolvedValue(run),
    };
    const tools = buildWorkflowRunTools({ workflowService, agenticService });

    await expect(
      tools.runWorkflow(
        {
          workflowId: 'workflow-id',
          input: { prompt: 'hello' },
        },
        {},
        request,
      ),
    ).resolves.toEqual({ accepted: true, run });

    const [event] = agenticService.handleEvent.mock.calls[0];
    expect(event.getWorkflowId()).toBe('workflow-id');
    expect(event.getInitiator()).toEqual(actor);
    expect(workflowService.validateManualInput).toHaveBeenCalledWith(
      { prompt: 'hello' },
      { type: 'object', properties: {} },
    );
  });

  it('searches workflow runs without nested workflow YAML definitions or checkpoints', async () => {
    const run = {
      id: 'run-id',
      status: 'finished',
      checkpoint: { version: 1, waits: [] },
      workflowVersion: {
        id: 'version-id',
        version: 3,
        checksum: 'checksum',
        definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      },
    };
    const workflowRunService = {
      findAndPopulate: jest.fn().mockResolvedValue([run]),
      count: jest.fn().mockResolvedValue(1),
    };
    const tools = buildWorkflowRunTools({ workflowRunService });
    const result = await tools.searchWorkflowRuns({
      workflowId: '11111111-1111-4111-8111-111111111111',
      limit: 20,
      skip: 0,
      sortBy: 'createdAt',
      sortDirection: 'DESC',
    });

    expect(result).toEqual({
      items: [
        {
          id: 'run-id',
          status: 'finished',
          workflowVersion: {
            id: 'version-id',
            version: 3,
            checksum: 'checksum',
          },
        },
      ],
      total: 1,
      limit: 20,
      skip: 0,
    });
  });

  it('reads a workflow run without nested workflow YAML definitions or checkpoint', async () => {
    const run = {
      id: 'run-id',
      status: 'finished',
      checkpoint: { version: 1, waits: [] },
      workflowVersion: {
        id: 'version-id',
        version: 3,
        checksum: 'checksum',
        definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      },
    };
    const workflowRunService = {
      findOneAndPopulate: jest.fn().mockResolvedValue(run),
    };
    const tools = buildWorkflowRunTools({ workflowRunService });

    await expect(tools.getWorkflowRun({ id: 'run-id' })).resolves.toEqual({
      id: 'run-id',
      status: 'finished',
      workflowVersion: {
        id: 'version-id',
        version: 3,
        checksum: 'checksum',
      },
    });
  });

  it('returns workflow run debugging context with related runs and YAML, keeping only the inspected checkpoint', async () => {
    const run = {
      id: 'run-id',
      status: 'failed',
      workflow: {
        id: 'workflow-id',
        name: 'Support triage',
        type: WorkflowType.manual,
      },
      workflowVersion: {
        id: 'version-id',
        version: 3,
        checksum: 'checksum',
        definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      },
      parentRun: { id: 'parent-run-id' },
      stepLog: {
        send_reply: {
          id: 'send_reply',
          name: 'Send reply',
          action: 'send_message',
          status: 'failed',
          error: { message: 'Template is missing' },
        },
      },
      error: 'Template is missing',
      duration: 125,
      checkpoint: { version: 1, waits: [] },
      createdAt: '2026-05-08T10:00:00.000Z',
      updatedAt: '2026-05-08T10:00:01.000Z',
    };
    const parentRun = {
      id: 'parent-run-id',
      status: 'suspended',
      checkpoint: { version: 1, waits: [] },
      workflowVersion: {
        id: 'parent-version-id',
        definitionYml: 'parent-yaml',
      },
    };
    const childRun = {
      id: 'child-run-id',
      status: 'finished',
      checkpoint: null,
      workflowVersion: {
        id: 'child-version-id',
        definitionYml: 'child-yaml',
      },
    };
    const workflowRunService = {
      findOneAndPopulate: jest.fn().mockImplementation((id: string) => {
        if (id === 'run-id') {
          return Promise.resolve(run);
        }
        if (id === 'parent-run-id') {
          return Promise.resolve(parentRun);
        }

        return Promise.resolve(null);
      }),
      findAndPopulate: jest.fn().mockResolvedValue([childRun]),
      count: jest.fn().mockResolvedValue(1),
    };
    const tools = buildWorkflowRunTools({ workflowRunService });

    await expect(
      tools.debugWorkflowRun({
        id: 'run-id',
        childRunsLimit: 5,
      }),
    ).resolves.toEqual({
      run: {
        ...run,
        workflowVersion: {
          id: 'version-id',
          version: 3,
          checksum: 'checksum',
        },
      },
      workflowDefinitionYml: run.workflowVersion.definitionYml,
      relatedRuns: {
        parent: {
          id: 'parent-run-id',
          status: 'suspended',
          workflowVersion: {
            id: 'parent-version-id',
          },
        },
        children: [
          {
            id: 'child-run-id',
            status: 'finished',
            workflowVersion: {
              id: 'child-version-id',
            },
          },
        ],
        childRunTotal: 1,
        childRunsLimit: 5,
      },
      summary: expect.objectContaining({
        id: 'run-id',
        status: 'failed',
        workflow: {
          id: 'workflow-id',
          name: 'Support triage',
          type: WorkflowType.manual,
        },
        workflowVersion: {
          id: 'version-id',
          version: 3,
          checksum: 'checksum',
        },
        error: 'Template is missing',
        duration: 125,
        stepStatusCounts: { failed: 1 },
        failedSteps: [
          {
            id: 'send_reply',
            name: 'Send reply',
            action: 'send_message',
            status: 'failed',
            error: { message: 'Template is missing' },
            reason: null,
          },
        ],
        childRunTotal: 1,
      }),
    });

    expect(workflowRunService.findAndPopulate).toHaveBeenCalledWith({
      where: { parentRun: { id: 'run-id' } },
      order: { createdAt: 'ASC' },
      take: 5,
    });
    expect(workflowRunService.count).toHaveBeenCalledWith({
      where: { parentRun: { id: 'run-id' } },
    });
  });

  it('can inspect a workflow run without related runs or YAML', async () => {
    const run = {
      id: 'run-id',
      status: 'suspended',
      workflow: {
        id: 'workflow-id',
        name: 'Manual workflow',
        type: WorkflowType.manual,
      },
      workflowVersion: {
        id: 'version-id',
        version: 2,
        checksum: 'checksum',
        definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      },
      parentRun: null,
      stepLog: null,
      checkpoint: {
        version: 1,
        waits: [
          {
            waitId: 'await_reply@key:reply',
            step: { id: 'await_reply', name: 'await_reply', type: 'task' },
            suspendKey: 'key:reply',
            reason: 'Waiting for user',
          },
          {
            waitId: 'call_child@index:1',
            step: { id: 'call_child', name: 'call_child', type: 'task' },
            suspendKey: 'index:1',
            reason: 'awaiting_child_workflow',
          },
        ],
      },
    };
    const workflowRunService = {
      findOneAndPopulate: jest.fn().mockResolvedValue(run),
      findAndPopulate: jest.fn(),
      count: jest.fn(),
    };
    const tools = buildWorkflowRunTools({ workflowRunService });
    const result = await tools.debugWorkflowRun({
      id: 'run-id',
      includeRelatedRuns: false,
      includeWorkflowDefinition: false,
    });

    expect(result).not.toHaveProperty('workflowDefinitionYml');
    expect((result.run as any).workflowVersion).toEqual({
      id: 'version-id',
      version: 2,
      checksum: 'checksum',
    });
    expect(result).toEqual(
      expect.objectContaining({
        run: expect.objectContaining({
          id: 'run-id',
          workflowVersion: {
            id: 'version-id',
            version: 2,
            checksum: 'checksum',
          },
        }),
        relatedRuns: {
          parent: null,
          children: [],
          childRunTotal: 0,
          childRunsLimit: 0,
        },
        summary: expect.objectContaining({
          status: 'suspended',
          suspension: {
            waits: [
              {
                waitId: 'await_reply@key:reply',
                step: 'await_reply',
                reason: 'Waiting for user',
                suspendKey: 'key:reply',
              },
              {
                waitId: 'call_child@index:1',
                step: 'call_child',
                reason: 'awaiting_child_workflow',
                suspendKey: 'index:1',
              },
            ],
          },
        }),
      }),
    );
    expect(workflowRunService.findAndPopulate).not.toHaveBeenCalled();
    expect(workflowRunService.count).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when a workflow run debug target is missing', async () => {
    const workflowRunService = {
      findOneAndPopulate: jest.fn().mockResolvedValue(null),
    };
    const tools = buildWorkflowRunTools({ workflowRunService });

    await expect(
      tools.debugWorkflowRun({ id: 'missing-run-id' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ManualWorkflowContext } from '@/workflow/contexts/manual-workflow.context';
import { ManualEventWrapper } from '@/workflow/lib/trigger-event-wrapper';
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
const triggeringUser = {
  ...actor,
  firstName: 'Ada',
  lastName: 'Lovelace',
  sendEmail: false,
  resetCount: 1,
  resetToken: '$2a$10$pendingPasswordResetTokenHash',
  provider: { strategy: 'local' },
};
const defaultWorkflowService = () => ({
  findOneAndPopulate: jest.fn().mockResolvedValue({ id: 'workflow-id' }),
  findOne: jest.fn(),
  validateManualInput: jest.fn(),
});
const buildWorkflowRunTools = (overrides: Record<string, unknown> = {}) => {
  const workflowService = overrides.workflowService ?? defaultWorkflowService();
  const workflowRunService = overrides.workflowRunService ?? ({} as any);
  const webhookTriggerService = overrides.webhookTriggerService ?? ({} as any);

  return new HexabotWorkflowRunMcpTools(
    workflowService as any,
    workflowRunService as any,
    webhookTriggerService as any,
  );
};

describe('HexabotWorkflowRunMcpTools', () => {
  it('returns the created workflow run summary for manual workflow execution', async () => {
    const run = { id: 'run-id', status: 'finished' };
    const workflow = {
      id: 'workflow-id',
      type: WorkflowType.manual,
      inputSchema: { type: 'object', properties: {} },
    };
    const workflowService = {
      findOneAndPopulate: jest.fn().mockResolvedValue(workflow),
      validateManualInput: jest.fn().mockReturnValue({ prompt: 'hello' }),
    };
    const webhookTriggerService = {
      dispatchTriggerEvent: jest.fn().mockResolvedValue(run),
    };
    const tools = buildWorkflowRunTools({
      workflowService,
      webhookTriggerService,
    });

    await expect(
      tools.runWorkflow(
        {
          workflowId: 'workflow-id',
          input: { prompt: 'hello' },
        },
        {},
        request,
      ),
    ).resolves.toEqual({
      accepted: true,
      inProgress: false,
      run: { ...run, openWaits: [] },
    });

    const [workflowArg, event, initiatorId, options] =
      webhookTriggerService.dispatchTriggerEvent.mock.calls[0];
    expect(workflowArg).toBe(workflow);
    expect(event.buildInput()).toEqual({ prompt: 'hello' });
    expect(initiatorId).toBe(actor.id);
    expect(options).toEqual({ wait: true, waitTimeoutMs: 30_000 });
    expect(workflowService.validateManualInput).toHaveBeenCalledWith(
      { prompt: 'hello' },
      { type: 'object', properties: {} },
    );
  });

  it.each([
    [{ wait: false }, { wait: false, waitTimeoutMs: 30_000 }, 'idle'],
    [
      { waitTimeoutSeconds: 5 },
      { wait: true, waitTimeoutMs: 5_000 },
      'running',
    ],
  ])(
    'returns a run still in progress with its id (%j)',
    async (waitArgs, dispatchOptions, status) => {
      const run = { id: 'run-id', status };
      const webhookTriggerService = {
        dispatchTriggerEvent: jest.fn().mockResolvedValue(run),
      };
      const tools = buildWorkflowRunTools({
        workflowService: {
          findOneAndPopulate: jest.fn().mockResolvedValue({
            id: 'workflow-id',
            type: WorkflowType.scheduled,
            schedule: '0 * * * *',
          }),
        },
        webhookTriggerService,
      });

      await expect(
        tools.runWorkflow(
          { workflowId: 'workflow-id', input: {}, ...waitArgs },
          {},
          request,
        ),
      ).resolves.toEqual({
        accepted: true,
        inProgress: true,
        run: { ...run, openWaits: [] },
      });
      expect(webhookTriggerService.dispatchTriggerEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'workflow-id' }),
        expect.anything(),
        actor.id,
        dispatchOptions,
      );
    },
  );

  it('summarizes the open waits of a run instead of returning its checkpoint and YAML', async () => {
    const wait = {
      waitId: 'review@index:1',
      step: { id: 'review', name: 'review', type: 'task' },
      suspendKey: 'index:1',
      reason: 'awaiting_approval',
      data: { message: 'Refund 42 EUR?' },
      accepts: { type: 'object' },
    };
    const run = {
      id: 'run-id',
      status: 'suspended',
      checkpoint: { version: 1, fingerprint: 'f', root: {}, waits: [wait] },
      workflowVersion: {
        id: 'version-id',
        definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      },
    };
    const workflowService = {
      findOneAndPopulate: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        type: WorkflowType.manual,
        inputSchema: { type: 'object', properties: {} },
      }),
      validateManualInput: jest.fn().mockReturnValue({}),
    };
    const webhookTriggerService = {
      dispatchTriggerEvent: jest.fn().mockResolvedValue(run),
    };
    const tools = buildWorkflowRunTools({
      workflowService,
      webhookTriggerService,
    });

    await expect(
      tools.runWorkflow({ workflowId: 'workflow-id', input: {} }, {}, request),
    ).resolves.toEqual({
      accepted: true,
      inProgress: false,
      run: {
        id: 'run-id',
        status: 'suspended',
        workflowVersion: { id: 'version-id' },
        openWaits: [
          {
            waitId: 'review@index:1',
            reason: 'awaiting_approval',
            step: wait.step,
            data: { message: 'Refund 42 EUR?' },
          },
        ],
      },
    });
  });

  it('reports an input the suspended run refused instead of accepting it', async () => {
    const workflowService = {
      findOneAndPopulate: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        type: WorkflowType.manual,
        inputSchema: { type: 'object', properties: {} },
      }),
      validateManualInput: jest.fn().mockReturnValue({ quantity: 'ten' }),
    };
    const refusal = new UnprocessableEntityException({
      statusCode: 422,
      code: 'payload_rejected',
      message:
        'Resume payload for wait "ask" was rejected: quantity: Expected number',
      issues: ['quantity: Expected number'],
      runId: 'run-id',
    });
    const webhookTriggerService = {
      dispatchTriggerEvent: jest.fn().mockRejectedValue(refusal),
    };
    const tools = buildWorkflowRunTools({
      workflowService,
      webhookTriggerService,
    });

    await expect(
      tools.runWorkflow(
        { workflowId: 'workflow-id', input: { quantity: 'ten' } },
        {},
        request,
      ),
    ).rejects.toBe(refusal);
  });

  it('names what the input schema refused, and starts no run', async () => {
    const details = {
      formErrors: [],
      fieldErrors: {
        question: ['Invalid input: expected string, received undefined'],
      },
    };
    const workflowService = {
      findOneAndPopulate: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        type: WorkflowType.manual,
        inputSchema: {
          type: 'object',
          properties: { question: { type: 'string' } },
          required: ['question'],
        },
      }),
      validateManualInput: jest.fn().mockImplementation(() => {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Manual workflow input validation failed',
          details,
        });
      }),
    };
    const webhookTriggerService = { dispatchTriggerEvent: jest.fn() };
    const tools = buildWorkflowRunTools({
      workflowService,
      webhookTriggerService,
    });

    await expect(
      tools.runWorkflow({ workflowId: 'workflow-id', input: {} }, {}, request),
    ).rejects.toThrow(
      new BadRequestException(
        `Manual workflow input validation failed: ${JSON.stringify(details)}`,
      ),
    );
    expect(webhookTriggerService.dispatchTriggerEvent).not.toHaveBeenCalled();
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

  it('lists the runs waiting on an admin with their open admin waits', async () => {
    const approvalWait = {
      waitId: 'approve@index:1',
      step: { id: 'approve', name: 'approve', type: 'task' },
      suspendKey: 'index:1',
      reason: 'awaiting_approval',
      data: { message: 'Refund 42 EUR?' },
      accepts: { type: 'object' },
    };
    const run = {
      id: 'run-id',
      status: 'suspended',
      awaitingOperator: true,
      checkpoint: {
        version: 1,
        waits: [
          approvalWait,
          {
            waitId: 'ask@index:1',
            step: { id: 'ask', name: 'ask', type: 'task' },
            suspendKey: 'index:1',
            reason: 'awaiting_user_response',
          },
        ],
      },
      workflowVersion: {
        id: 'version-id',
        definitionYml: 'defs: {}\nflow: []\noutputs: {}\n',
      },
    };
    const workflowRunService = {
      findAndPopulate: jest.fn().mockResolvedValue([run]),
      count: jest.fn().mockResolvedValue(1),
      withAwaitingOperatorScope: jest.fn((options) => ({
        ...options,
        where: { ...options.where, scoped: true },
      })),
    };
    const tools = buildWorkflowRunTools({ workflowRunService });
    const result = await tools.listPendingWorkflowRuns({
      workflowId: '11111111-1111-4111-8111-111111111111',
      limit: 20,
      skip: 0,
      sortBy: 'suspendedAt',
      sortDirection: 'DESC',
    });

    expect(workflowRunService.findAndPopulate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workflow: { id: '11111111-1111-4111-8111-111111111111' },
          scoped: true,
        },
        order: { suspendedAt: 'DESC' },
      }),
    );
    expect(result).toEqual({
      items: [
        {
          id: 'run-id',
          status: 'suspended',
          awaitingOperator: true,
          workflowVersion: { id: 'version-id' },
          openWaits: [
            {
              waitId: 'approve@index:1',
              reason: 'awaiting_approval',
              step: approvalWait.step,
              data: { message: 'Refund 42 EUR?' },
            },
          ],
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

  it('reduces the user who triggered a run, and the copy its context keeps, to their id and name in every run tool', async () => {
    // The context a manual run persists keeps the initiator's whole record.
    const event = new ManualEventWrapper({}, triggeringUser.id);
    event.setInitiator(triggeringUser as any);
    const runtimeContext = new ManualWorkflowContext();
    runtimeContext.event = event;
    await runtimeContext.syncInitiatorState();
    const runContext: Record<string, unknown> = {
      ...runtimeContext.state,
      locale: 'en',
    };
    expect(runContext.initiator).toEqual(
      expect.objectContaining({ resetToken: triggeringUser.resetToken }),
    );
    const run = {
      id: 'run-id',
      status: 'finished',
      workflow: { id: 'workflow-id', createdBy: actor.id },
      triggeredBy: triggeringUser,
      context: runContext,
      parentRun: {
        id: 'parent-run-id',
        triggeredBy: triggeringUser.id,
        context: runContext,
      },
      checkpoint: null,
    };
    const parentRun = { ...run, id: 'parent-run-id', parentRun: null };
    const workflowService = {
      findOneAndPopulate: jest.fn().mockResolvedValue({
        id: 'workflow-id',
        type: WorkflowType.manual,
        inputSchema: {},
      }),
      validateManualInput: jest.fn().mockReturnValue({}),
    };
    const workflowRunService = {
      findOneAndPopulate: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === 'parent-run-id' ? parentRun : run),
        ),
      findAndPopulate: jest.fn().mockResolvedValue([run]),
      count: jest.fn().mockResolvedValue(1),
      withAwaitingOperatorScope: jest.fn((options) => options),
    };
    const webhookTriggerService = {
      dispatchTriggerEvent: jest.fn().mockResolvedValue(run),
    };
    const tools = buildWorkflowRunTools({
      workflowService,
      workflowRunService,
      webhookTriggerService,
    });
    const pagination = {
      limit: 20,
      skip: 0,
      sortBy: 'createdAt',
      sortDirection: 'DESC' as const,
    };
    const triggeredBy = {
      id: 'user-id',
      firstName: 'Ada',
      lastName: 'Lovelace',
    };
    const context = { ...runContext, initiator: triggeredBy };
    const outputs = [
      await tools.runWorkflow(
        { workflowId: 'workflow-id', input: {} },
        {},
        request,
      ),
      await tools.searchWorkflowRuns(pagination),
      await tools.listPendingWorkflowRuns(pagination),
      await tools.getWorkflowRun({ id: 'run-id' }),
      await tools.debugWorkflowRun({ id: 'run-id' }),
    ];

    expect(outputs).toEqual([
      expect.objectContaining({
        run: expect.objectContaining({ triggeredBy, context }),
      }),
      expect.objectContaining({
        items: [expect.objectContaining({ triggeredBy, context })],
      }),
      expect.objectContaining({
        items: [expect.objectContaining({ triggeredBy, context })],
      }),
      expect.objectContaining({
        triggeredBy,
        context,
        parentRun: {
          id: 'parent-run-id',
          triggeredBy: triggeringUser.id,
          context,
        },
      }),
      expect.objectContaining({
        run: expect.objectContaining({ triggeredBy, context }),
        relatedRuns: expect.objectContaining({
          parent: expect.objectContaining({ triggeredBy, context }),
          children: [expect.objectContaining({ triggeredBy, context })],
        }),
      }),
    ]);
    for (const output of outputs) {
      expect(JSON.stringify(output)).not.toContain(triggeringUser.resetToken);
      expect(JSON.stringify(output)).not.toContain(triggeringUser.email);
    }
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

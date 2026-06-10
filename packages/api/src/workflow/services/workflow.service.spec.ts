/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  type StepExecutionRecord,
  WorkflowDefinition,
  Workflow as WorkflowHelper,
} from '@hexabot-ai/agentic';
import { Workflow } from '@hexabot-ai/types';
import { BadRequestException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { JSONSchema7 as JsonSchema } from 'json-schema';

import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import {
  conversationalWorkflowInputJsonSchema,
  scheduledWorkflowInputJsonSchema,
} from '@/workflow/schemas/workflow-input-schemas';

import { WorkflowUpdateDto } from '../dto/workflow.dto';
import { WorkflowRunRepository } from '../repositories/workflow-run.repository';
import { WorkflowRepository } from '../repositories/workflow.repository';
import { WorkflowType, WorkflowVersionAction } from '../types';

import { WorkflowRunService } from './workflow-run.service';
import { WorkflowVersionService } from './workflow-version.service';
import { WorkflowService } from './workflow.service';

describe('WorkflowService (TypeORM)', () => {
  let module: TestingModule;
  let workflowService: WorkflowService;
  let workflowVersionService: WorkflowVersionService;
  let workflowRunService: WorkflowRunService;
  let workflowRepository: WorkflowRepository;
  let workflow: Workflow;
  let definitionYml: string;
  let counter = 0;
  let creatorId: string;
  const gatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  };
  const buildWorkflowDefinition = (): {
    metadata: { name: string; description: string };
    definition: WorkflowDefinition;
  } => {
    return {
      metadata: {
        name: `Test workflow ${++counter}`,
        description: 'Test workflow definition',
      },
      definition: {
        defs: {
          greet: { kind: 'task', action: 'greet' },
        },
        flow: [{ do: 'greet' }],
        outputs: { result: '=1' },
      },
    };
  };
  const createWorkflowForType = async (
    type: WorkflowType,
  ): Promise<Workflow> => {
    if (type === WorkflowType.conversational) {
      return workflow;
    }

    return await workflowService.create({
      name: `${type}_workflow_${++counter}`,
      description: `Workflow event broadcast test for ${type}`,
      type,
      schedule: type === WorkflowType.scheduled ? '*/10 * * * * *' : null,
      createdBy: creatorId,
    });
  };
  const createWorkflowRun = async (
    targetWorkflow: Workflow,
    context: Record<string, unknown> | null = {
      initiatorId: creatorId,
      workflowId: targetWorkflow.id,
      threadId: 'thread-1',
    },
  ) => {
    return await workflowRunService.create({
      workflow: targetWorkflow.id,
      triggeredBy: creatorId,
      input: {},
      context,
    });
  };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WorkflowService,
        WorkflowVersionService,
        WorkflowRunService,
        WorkflowRunRepository,
        { provide: WEBSOCKET_GATEWAY, useValue: gatewayMock },
      ],
      typeorm: {
        fixtures: installUserFixturesTypeOrm,
      },
    });

    module = testing.module;
    [
      workflowService,
      workflowVersionService,
      workflowRunService,
      workflowRepository,
    ] = await testing.getMocks([
      WorkflowService,
      WorkflowVersionService,
      WorkflowRunService,
      WorkflowRepository,
    ]);
  });

  beforeEach(async () => {
    await workflowRepository.deleteMany();
    creatorId = userFixtureIds.admin;

    const { metadata, definition } = buildWorkflowDefinition();
    workflow = await workflowService.create({
      name: metadata.name,
      description: metadata.description,
      type: WorkflowType.conversational,
      schedule: null,
      createdBy: creatorId,
    });

    definitionYml = WorkflowHelper.stringifyDefinition(definition);
    const version = await workflowVersionService.commit({
      action: WorkflowVersionAction.create,
      definitionYml,
      workflow: workflow.id,
      createdBy: creatorId,
    });

    await workflowService.updateOne(workflow.id, {
      currentVersion: version.id,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  it('creates workflows and returns stored definitions', async () => {
    const stored = await workflowService.findOne(workflow.id);

    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      type: WorkflowType.conversational,
      schedule: null,
      inputSchema: conversationalWorkflowInputJsonSchema,
    });
  });

  it('serializes YAML from definitions before persistence', async () => {
    const entity = await workflowService.findOneAndPopulate({
      where: { id: workflow.id },
    });

    expect(entity?.definitionYml).toBe(definitionYml);
  });

  it('enforces unique name', async () => {
    const duplicatePayload = {
      name: workflow.name,
      description: workflow.description ?? undefined,
      type: WorkflowType.conversational,
      schedule: null,
      createdBy: creatorId,
    };

    await expect(workflowService.create(duplicatePayload)).rejects.toThrow();
  });

  it('keeps the fixed conversational input schema on create', async () => {
    const customSchema: JsonSchema = {
      type: 'object',
      properties: {
        custom: { type: 'string' },
      },
    };
    const created = await workflowService.create({
      name: `workflow_with_custom_schema_${Date.now()}`,
      description: 'Should still use fixed conversational schema',
      type: WorkflowType.conversational,
      schedule: null,
      inputSchema: customSchema,
      createdBy: creatorId,
    });

    expect(created.inputSchema).toEqual(conversationalWorkflowInputJsonSchema);
  });

  it('allows custom manual schema updates', async () => {
    const manualSchema: JsonSchema = {
      type: 'object',
      properties: {
        amount: { type: 'number' },
      },
      required: ['amount'],
    };
    const created = await workflowService.create({
      name: `manual_workflow_${Date.now()}`,
      description: 'Manual workflow schema test',
      type: WorkflowType.manual,
      inputSchema: manualSchema,
      schedule: null,
      createdBy: creatorId,
    });

    expect(created.inputSchema).toEqual(manualSchema);

    const updatedManual = await workflowService.updateOne(created.id, {
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
        },
        required: ['city'],
      },
    });
    expect(updatedManual.inputSchema).toEqual({
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
    });
  });

  it('rejects workflow type changes after creation', async () => {
    const scheduled = await workflowService.create({
      name: `scheduled_to_manual_${Date.now()}`,
      description: 'Switch scheduled workflow to manual',
      type: WorkflowType.scheduled,
      schedule: '*/10 * * * * *',
      createdBy: creatorId,
    });

    expect(scheduled.inputSchema).toEqual(scheduledWorkflowInputJsonSchema);

    await expect(
      workflowService.updateOne(scheduled.id, {
        type: WorkflowType.manual,
        schedule: null,
      } as WorkflowUpdateDto & { type: WorkflowType }),
    ).rejects.toThrow(
      new BadRequestException('Workflow type cannot be changed once created'),
    );
  });

  it('returns the latest workflow when one exists', async () => {
    const picked = await workflowService.pickWorkflow();

    expect(picked?.id).toBe(workflow.id);
    expect(picked?.name).toBe(workflow.name);
  });

  it('returns null when no workflows exist', async () => {
    await workflowRepository.deleteMany();

    const picked = await workflowService.pickWorkflow();

    expect(picked).toBeNull();
  });

  describe('workflow execution websocket events', () => {
    it.each([
      WorkflowType.conversational,
      WorkflowType.manual,
      WorkflowType.scheduled,
    ])('broadcasts execution events for %s workflows', async (workflowType) => {
      const targetWorkflow = await createWorkflowForType(workflowType);
      const run = await createWorkflowRun(targetWorkflow);

      await workflowService.sendWorkflowStart({ runId: run.id });

      expect(gatewayMock.broadcastWorkflowEvent).toHaveBeenCalledTimes(1);
      expect(gatewayMock.broadcastWorkflowEvent).toHaveBeenCalledWith({
        runId: run.id,
        t: expect.any(Number),
        workflowRun: expect.objectContaining({
          id: run.id,
          workflow: targetWorkflow.id,
        }),
        workflowId: targetWorkflow.id,
        initiatorId: creatorId,
        threadId: 'thread-1',
        workflowEvent: 'workflow:start',
      });
    });

    it.each([WorkflowType.manual, WorkflowType.scheduled])(
      'broadcasts step execution records for %s workflow events',
      async (workflowType) => {
        const targetWorkflow = await createWorkflowForType(workflowType);
        const run = await createWorkflowRun(targetWorkflow);
        const step = {
          id: '0:greet',
          name: 'greet',
          type: StepType.Task,
        };
        const stepExecution: StepExecutionRecord = {
          ...step,
          action: 'greet',
          status: 'running',
          startedAt: 1700000000000,
          input: { name: 'Ada' },
        };

        await workflowService.sendWorkflowStepStart({
          runId: run.id,
          step,
          stepExecution,
        });

        expect(gatewayMock.broadcastWorkflowEvent).toHaveBeenCalledTimes(1);
        expect(gatewayMock.broadcastWorkflowEvent).toHaveBeenCalledWith({
          runId: run.id,
          step,
          stepExecution,
          t: expect.any(Number),
          workflowRun: expect.objectContaining({
            id: run.id,
            workflow: targetWorkflow.id,
          }),
          workflowId: targetWorkflow.id,
          initiatorId: creatorId,
          threadId: 'thread-1',
          workflowEvent: 'step:start',
        });
      },
    );

    it('broadcasts cancelled step events', async () => {
      const targetWorkflow = await createWorkflowForType(WorkflowType.manual);
      const run = await createWorkflowRun(targetWorkflow);
      const step = {
        id: '0:slow_branch',
        name: 'slow_branch',
        type: StepType.Task,
      };
      const error = new Error('Parallel wait_any branch lost the race.');
      const stepExecution: StepExecutionRecord = {
        ...step,
        action: 'slow_branch',
        status: 'cancelled',
        endedAt: 1700000000000,
        error: { message: error.message },
      };

      await workflowService.sendWorkflowStepCancelled({
        runId: run.id,
        step,
        stepExecution,
        error,
      });

      expect(gatewayMock.broadcastWorkflowEvent).toHaveBeenCalledTimes(1);
      expect(gatewayMock.broadcastWorkflowEvent).toHaveBeenCalledWith({
        runId: run.id,
        step,
        stepExecution,
        error,
        t: expect.any(Number),
        workflowRun: expect.objectContaining({
          id: run.id,
          workflow: targetWorkflow.id,
        }),
        workflowId: targetWorkflow.id,
        initiatorId: creatorId,
        threadId: 'thread-1',
        workflowEvent: 'step:cancelled',
      });
    });

    it('does not broadcast when the workflow event has no run id', async () => {
      await workflowService.sendWorkflowStart({});

      expect(gatewayMock.broadcastWorkflowEvent).not.toHaveBeenCalled();
    });

    it.each([
      ['context is missing', null],
      ['initiatorId is missing', { workflowId: 'workflow-id' }],
      ['workflowId is missing', { initiatorId: 'initiator-id' }],
    ])('does not broadcast when run %s', async (_label, context) => {
      const run = await createWorkflowRun(workflow, context);

      await workflowService.sendWorkflowStart({ runId: run.id });

      expect(gatewayMock.broadcastWorkflowEvent).not.toHaveBeenCalled();
    });

    it('does not broadcast when the context workflow id does not resolve', async () => {
      const run = await createWorkflowRun(workflow, {
        initiatorId: creatorId,
        workflowId: userFixtureIds.admin,
      });

      await workflowService.sendWorkflowStart({ runId: run.id });

      expect(gatewayMock.broadcastWorkflowEvent).not.toHaveBeenCalled();
    });
  });

  it('validates manual input with the provided schema', () => {
    const manualSchema: JsonSchema = {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
      },
      required: ['customerId'],
      additionalProperties: false,
    };
    const input = { customerId: 'cust-42' };
    const parsed = workflowService.validateManualInput(input, manualSchema);

    expect(parsed).toEqual(input);
  });

  it('throws when manual input does not match the provided schema', () => {
    const manualSchema: JsonSchema = {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
      },
      required: ['customerId'],
      additionalProperties: false,
    };

    let thrown: unknown;
    try {
      workflowService.validateManualInput({ customerId: 42 }, manualSchema);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    const response = (thrown as BadRequestException).getResponse() as {
      message?: string;
      details?: {
        fieldErrors?: Record<string, string[]>;
      };
    };
    expect(response.message).toEqual('Manual workflow input validation failed');
    expect(response.details?.fieldErrors?.customerId).toBeDefined();
  });

  it('throws when the manual input schema is not valid JSON Schema', () => {
    const invalidSchema = { type: 'wat' } as unknown as JsonSchema;

    let thrown: unknown;
    try {
      workflowService.validateManualInput({}, invalidSchema);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    const response = (thrown as BadRequestException).getResponse() as {
      message?: string;
      details?: {
        schema?: string;
      };
    };
    expect(response.message).toEqual('Manual workflow input validation failed');
    expect(response.details?.schema).toEqual(
      'Workflow input schema is not valid.',
    );
  });
});

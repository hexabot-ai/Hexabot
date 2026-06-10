/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Workflow as AgenticWorkflow,
  ExecutionState,
  StepExecutionRecord,
  StepType,
  WorkflowRunner,
  WorkflowSnapshot,
} from '@hexabot-ai/agentic';
import type { User, WorkflowRunFull, WorkflowFull } from '@hexabot-ai/types';
import { ModuleRef } from '@nestjs/core';
import { TestingModule } from '@nestjs/testing';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { I18nService } from '@/i18n/services/i18n.service';
import {
  installMessagingWorkflowFixturesTypeOrm,
  messagingWorkflowDefinition,
} from '@/utils/test/fixtures/workflow';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import { WorkflowContextFactory } from '@/workflow/contexts/workflow-context-factory';
import { WorkflowRunOrmEntity } from '@/workflow/entities/workflow-run.entity';
import { WorkflowVersionOrmEntity } from '@/workflow/entities/workflow-version.entity';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { ManualEventWrapper } from '@/workflow/lib/trigger-event-wrapper';
import { WorkflowRunRepository } from '@/workflow/repositories/workflow-run.repository';
import { WorkflowVersionRepository } from '@/workflow/repositories/workflow-version.repository';
import { WorkflowRepository } from '@/workflow/repositories/workflow.repository';
import { WorkflowType, WorkflowVersionAction } from '@/workflow/types';

import { AgenticService } from './agentic.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowVersionService } from './workflow-version.service';
import { WorkflowService } from './workflow.service';

const actionServiceMock = {
  getRegistry: jest.fn(),
};
const runtimeBindingsServiceMock = {
  getRegistry: jest.fn(),
};
const workflowContextFactoryMock = {
  create: jest.fn(),
};
const i18nServiceMock = {
  t: jest.fn(
    (key: string, options?: Record<string, unknown>) =>
      options?.defaultValue ?? key,
  ),
};
const moduleRefMock: Partial<ModuleRef> = {};
const websocketGatewayMock = {
  joinSockets: jest.fn(),
  broadcastWorkflowEvent: jest.fn(),
};
const buildRunnerMock = ({
  startResult,
  resumeResult,
  state,
  snapshot,
  stepLog,
  startError,
  resumeError,
}: {
  startResult?: Parameters<WorkflowRunner['start']>[0] extends never
    ? never
    : Awaited<ReturnType<WorkflowRunner['start']>>;
  resumeResult?: Parameters<WorkflowRunner['resume']>[0] extends never
    ? never
    : Awaited<ReturnType<WorkflowRunner['resume']>>;
  state: ExecutionState;
  snapshot: WorkflowSnapshot;
  stepLog?: Record<string, StepExecutionRecord>;
  startError?: Error;
  resumeError?: Error;
}): jest.Mocked<WorkflowRunner> =>
  ({
    start: jest.fn(async () => {
      if (startError) {
        throw startError;
      }

      return startResult as Awaited<ReturnType<WorkflowRunner['start']>>;
    }),
    resume: jest.fn(async () => {
      if (resumeError) {
        throw resumeError;
      }

      return resumeResult as Awaited<ReturnType<WorkflowRunner['resume']>>;
    }),
    getState: jest.fn(() => state),
    getSnapshot: jest.fn(() => snapshot),
    getStepLog: jest.fn(() => stepLog ?? {}),
  }) as unknown as jest.Mocked<WorkflowRunner>;
const buildWorkflowInstance = (runner: jest.Mocked<WorkflowRunner>) =>
  ({
    buildAsyncRunner: jest.fn(async () => runner),
    buildRunnerFromState: jest.fn(async () => runner),
  }) as unknown as AgenticWorkflow;

describe('AgenticService (TypeORM)', () => {
  let module: TestingModule;
  let agenticService: AgenticService;
  let workflowService: WorkflowService;
  let workflowVersionService: WorkflowVersionService;
  let workflowRunService: WorkflowRunService;
  let workflow: WorkflowFull;
  let initiator: User;
  let workflowVersionId: string | null;
  let workflowCounter = 0;

  const resolveWorkflow = async (): Promise<WorkflowFull> => {
    const latest = await workflowService.findOneAndPopulate({
      where: { name: 'messaging_workflow_fixture' },
    });

    if (!latest) {
      throw new Error('Expected workflow fixtures to be available');
    }

    return latest as WorkflowFull;
  };
  const createWorkflowWithDefinition = async (
    type = WorkflowType.conversational,
  ): Promise<WorkflowFull> => {
    const created = await workflowService.create({
      name: `call_workflow_child_${++workflowCounter}`,
      description: 'Child workflow used by call_workflow tests',
      type,
      schedule: type === WorkflowType.scheduled ? '*/10 * * * * *' : null,
      createdBy: initiator.id,
    });

    await workflowVersionService.commit({
      workflow: created.id,
      definitionYml: AgenticWorkflow.stringifyDefinition(
        messagingWorkflowDefinition,
      ),
      action: WorkflowVersionAction.create,
      createdBy: initiator.id,
    });

    const populated = await workflowService.findOneAndPopulate(created.id);
    if (!populated) {
      throw new Error(`Expected workflow ${created.id} to be available`);
    }

    return populated as WorkflowFull;
  };
  const createEvent = (input: Record<string, unknown> = {}) => {
    const event = new ManualEventWrapper(input, initiator.id);
    event.setInitiator(initiator as any);

    return event;
  };

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        AgenticService,
        WorkflowService,
        WorkflowRepository,
        WorkflowVersionService,
        WorkflowVersionRepository,
        WorkflowRunService,
        WorkflowRunRepository,
        { provide: ActionService, useValue: actionServiceMock },
        {
          provide: RuntimeBindingsService,
          useValue: runtimeBindingsServiceMock,
        },
        {
          provide: WorkflowContextFactory,
          useValue: workflowContextFactoryMock,
        },
        { provide: I18nService, useValue: i18nServiceMock },
        { provide: ModuleRef, useValue: moduleRefMock },
        { provide: WEBSOCKET_GATEWAY, useValue: websocketGatewayMock },
      ],
      typeorm: {
        entities: [
          WorkflowOrmEntity,
          WorkflowVersionOrmEntity,
          WorkflowRunOrmEntity,
        ],
        fixtures: [installMessagingWorkflowFixturesTypeOrm],
      },
    });

    module = testing.module;
    [
      agenticService,
      workflowService,
      workflowVersionService,
      workflowRunService,
    ] = await testing.getMocks([
      AgenticService,
      WorkflowService,
      WorkflowVersionService,
      WorkflowRunService,
    ]);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await workflowRunService.deleteMany();
    workflow = await resolveWorkflow();
    workflowVersionId = workflow.currentVersion?.id ?? null;
    initiator = workflow.createdBy as User;
    actionServiceMock.getRegistry.mockReturnValue({});
    runtimeBindingsServiceMock.getRegistry.mockReturnValue({});
    workflowContextFactoryMock.create.mockResolvedValue({
      state: {},
      event: undefined,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  describe('handleEvent', () => {
    it('starts a new workflow run and persists a finished result', async () => {
      const event = createEvent({ text: 'hello' });
      const runtimeContext = {
        state: { locale: initiator.language, channel: 'web', session: 1 },
        event,
      } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
      const runnerState: ExecutionState = {
        input: { merged: true },
        output: { fromState: true },
        iterationStack: [0],
        iteration: { item: 'root', index: 0 },
        accumulator: { total: 3 },
      };
      const runnerSnapshot: WorkflowSnapshot = {
        status: 'finished',
        actions: {},
      };
      const stepLog: Record<string, StepExecutionRecord> = {
        greet_user: {
          id: 'greet_user',
          name: 'greet_user',
          action: 'greet_action',
          status: 'completed',
          startedAt: 1700,
          endedAt: 1750,
          input: { text: 'hello' },
          output: { message: 'hi' },
        },
      };
      const runner = buildRunnerMock({
        startResult: {
          status: 'finished',
          output: { result: 'ok' },
          snapshot: runnerSnapshot,
        },
        state: runnerState,
        snapshot: runnerSnapshot,
        stepLog,
      });
      const workflowInstance = buildWorkflowInstance(runner);
      const fromDefinitionSpy = jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);

      await agenticService.handleEvent(event);

      const [storedRun] = (await workflowRunService.findAndPopulate({
        order: { createdAt: 'DESC' },
        take: 1,
      })) as WorkflowRunFull[];

      expect(actionServiceMock.getRegistry).toHaveBeenCalledTimes(1);
      expect(fromDefinitionSpy).toHaveBeenCalledWith(
        messagingWorkflowDefinition,
        expect.objectContaining({
          actions: expect.any(Object),
          bindingKinds: expect.any(Object),
          jsonataFunctions: expect.any(Object),
        }),
      );
      expect(workflowInstance.buildAsyncRunner).toHaveBeenCalledWith({
        runId: storedRun.id,
      });
      expect(runner.start).toHaveBeenCalledWith({
        inputData: event.buildInput(),
        context: runtimeContext,
      });
      expect(workflowContextFactoryMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: storedRun.id }),
        event,
        messagingWorkflowDefinition,
      );
      expect(storedRun.status).toBe('finished');
      expect(storedRun.output).toEqual({ result: 'ok' });
      expect(storedRun.input).toEqual(runnerState.input);
      expect(storedRun.context).toEqual(runtimeContext.state);
      expect(storedRun.stepLog).toEqual(stepLog);
      expect(storedRun.workflowVersion?.id ?? null).toBe(workflowVersionId);
      expect(storedRun.metadata).toEqual(
        expect.objectContaining({
          trigger: event.triggerType,
          initiated_by: initiator.id,
          state: {
            iteration: runnerState.iteration,
            accumulator: runnerState.accumulator,
            iterationStack: runnerState.iterationStack,
          },
        }),
      );
    });

    it('targets an explicit workflow id and scopes suspended lookup', async () => {
      const event = createEvent({ text: 'targeted' });
      const runtimeContext = {
        state: { locale: initiator.language, targeted: true },
        event,
      } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
      const runnerState: ExecutionState = {
        input: { text: 'targeted' },
        output: { targeted: true },
        iterationStack: [0],
      };
      const runnerSnapshot: WorkflowSnapshot = {
        status: 'finished',
        actions: {},
      };
      const runner = buildRunnerMock({
        startResult: {
          status: 'finished',
          output: { targeted: true },
          snapshot: runnerSnapshot,
        },
        state: runnerState,
        snapshot: runnerSnapshot,
      });
      const workflowInstance = buildWorkflowInstance(runner);
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);
      const findSuspendedSpy = jest.spyOn(
        workflowRunService,
        'findSuspendedRunByInitiator',
      );
      const pickWorkflowSpy = jest.spyOn(workflowService, 'pickWorkflow');
      const findOneAndPopulateSpy = jest.spyOn(
        workflowService,
        'findOneAndPopulate',
      );

      event.setWorkflowId(workflow.id);
      await agenticService.handleEvent(event);

      expect(findSuspendedSpy).toHaveBeenCalledWith(
        initiator.id,
        undefined,
        workflow.id,
      );
      expect(pickWorkflowSpy).not.toHaveBeenCalled();
      expect(findOneAndPopulateSpy.mock.calls[0]?.[0]).toBe(workflow.id);
      expect(workflowInstance.buildAsyncRunner).toHaveBeenCalled();
    });

    it('scopes suspended run lookup by thread id when provided', async () => {
      const event = createEvent({ text: 'threaded resume' });
      const runWorkflowSpy = jest
        .spyOn(agenticService as any, 'runWorkflow')
        .mockResolvedValue({
          run: { id: 'run-threaded' } as WorkflowRunFull,
          result: {
            status: 'finished',
            output: {},
            snapshot: { status: 'finished', actions: {} },
          },
        });
      const findSuspendedSpy = jest
        .spyOn(workflowRunService, 'findSuspendedRunByInitiator')
        .mockResolvedValue({
          id: 'run-threaded',
          workflow: { id: workflow.id },
          triggeredBy: { id: initiator.id },
          status: 'suspended',
        } as unknown as WorkflowRunFull);
      const threadId = 'thread-42';

      event.setThreadId(threadId);
      await agenticService.handleEvent(event);

      expect(findSuspendedSpy).toHaveBeenCalledWith(
        initiator.id,
        threadId,
        undefined,
      );
      expect(runWorkflowSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'resume',
        }),
      );
      runWorkflowSpy.mockRestore();
      findSuspendedSpy.mockRestore();
    });

    it('resumes a suspended run and records suspension details', async () => {
      const baseRun = await workflowRunService.create({
        workflow: workflow.id,
        workflowVersion: workflowVersionId,
        triggeredBy: initiator.id,
        status: 'suspended',
        input: { original: true },
        output: { saved: true },
        context: { saved: true },
        snapshot: { status: 'suspended', actions: {} },
        metadata: {
          state: {
            iteration: { item: 'loop', index: 0 },
            accumulator: { total: 2 },
            iterationStack: [0],
          },
        },
        suspendedStep: 'wait_input',
        suspensionReason: 'waiting',
        suspensionData: { previous: true },
        suspensionStepExecId: 'wait_input#3',
        suspensionIndex: 2,
        suspensionKey: 'index:2',
        suspensionAwaitResults: {
          'index:1': { message: 'first answer' },
        },
        stepLog: {
          wait_input: {
            id: 'wait_input',
            name: 'wait_input',
            action: 'wait_input_action',
            status: 'suspended',
            reason: 'waiting',
          },
        },
      });
      const event = createEvent({ latest: 'payload' });
      const runtimeContext = {
        state: { saved: true, resumed: true },
        event,
      } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
      const runnerState: ExecutionState = {
        input: { original: true },
        output: { next: 'output' },
        iterationStack: [0],
        iteration: { item: 'loop', index: 0 },
        accumulator: { total: 2 },
      };
      const runnerSnapshot: WorkflowSnapshot = {
        status: 'suspended',
        actions: {},
      };
      const stepLog: Record<string, StepExecutionRecord> = {
        prompt_user: {
          id: 'prompt_user',
          name: 'prompt_user',
          action: 'prompt_action',
          status: 'suspended',
          startedAt: 1800,
          reason: 'needs input',
        },
      };
      const resumeResult = {
        status: 'suspended' as const,
        step: { id: 'prompt_user', name: 'prompt_user', type: StepType.Task },
        reason: 'needs input',
        data: { prompt: true },
        stepExecId: 'prompt_user#1',
        suspendIndex: 1,
        suspendKey: 'key:await-user-input',
        awaitResults: {},
        snapshot: runnerSnapshot,
      };
      const runner = buildRunnerMock({
        resumeResult,
        state: runnerState,
        snapshot: runnerSnapshot,
        stepLog,
      });
      const workflowInstance = buildWorkflowInstance(runner);
      const fromDefinitionSpy = jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);

      await agenticService.handleEvent(event);

      const [updatedRun] = (await workflowRunService.findAndPopulate({
        order: { createdAt: 'DESC' },
        take: 1,
      })) as WorkflowRunFull[];

      expect(fromDefinitionSpy).toHaveBeenCalledTimes(1);
      expect(workflowInstance.buildRunnerFromState).toHaveBeenCalledWith({
        state: {
          input: { original: true },
          output: { saved: true },
          iterationStack: [0],
          iteration: { item: 'loop', index: 0 },
          accumulator: { total: 2 },
        },
        context: runtimeContext,
        snapshot: baseRun.snapshot ?? { status: baseRun.status, actions: {} },
        suspension: {
          stepId: baseRun.suspendedStep,
          reason: baseRun.suspensionReason,
          data: baseRun.suspensionData ?? undefined,
          stepExecId: baseRun.suspensionStepExecId ?? undefined,
          suspendIndex: baseRun.suspensionIndex ?? undefined,
          suspendKey: baseRun.suspensionKey ?? undefined,
          awaitResults: baseRun.suspensionAwaitResults ?? undefined,
        },
        runId: baseRun.id,
        lastResumeData: event.buildInput(),
      });
      expect(runner.resume).toHaveBeenCalledWith({
        resumeData: event.buildInput(),
      });
      expect(updatedRun.status).toBe('suspended');
      expect(updatedRun.suspendedStep).toBe(resumeResult.step.id);
      expect(updatedRun.suspensionReason).toBe(resumeResult.reason);
      expect(updatedRun.suspensionStepExecId).toBe(resumeResult.stepExecId);
      expect(updatedRun.suspensionIndex).toBe(resumeResult.suspendIndex);
      expect(updatedRun.suspensionKey).toBe(resumeResult.suspendKey);
      expect(updatedRun.suspensionAwaitResults).toEqual(
        resumeResult.awaitResults,
      );
      expect(updatedRun.lastResumeData).toEqual(event.buildInput());
      expect(updatedRun.input).toEqual({ original: true });
      expect(updatedRun.output).toEqual(runnerState.output);
      expect(updatedRun.context).toEqual(runtimeContext.state);
      expect(updatedRun.stepLog).toEqual(
        expect.objectContaining({
          wait_input: {
            id: 'wait_input',
            name: 'wait_input',
            action: 'wait_input_action',
            status: 'suspended',
            reason: 'waiting',
          },
          prompt_user: {
            id: 'prompt_user',
            name: 'prompt_user',
            action: 'prompt_action',
            status: 'suspended',
            startedAt: 1800,
            reason: 'needs input',
          },
        }),
      );
      expect(updatedRun.workflowVersion?.id ?? null).toBe(workflowVersionId);
      expect(updatedRun.metadata).toEqual({
        state: {
          iteration: runnerState.iteration,
          accumulator: runnerState.accumulator,
          iterationStack: runnerState.iterationStack,
        },
      });
    });

    it('marks a workflow run as failed when the runner throws', async () => {
      const event = createEvent({ fail: true });
      const runtimeContext = { state: { failed: true }, event } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
      const runnerState: ExecutionState = {
        input: { failing: true },
        output: { partial: true },
        iterationStack: [],
      };
      const runnerSnapshot: WorkflowSnapshot = {
        status: 'running',
        actions: {},
      };
      const stepLog: Record<string, StepExecutionRecord> = {
        do_work: {
          id: 'do_work',
          name: 'do_work',
          action: 'do_work_action',
          status: 'failed',
          startedAt: 2100,
          endedAt: 2150,
          error: { message: 'runner-crash' },
        },
      };
      const failure = new Error('runner-crash');
      const runner = buildRunnerMock({
        startError: failure,
        state: runnerState,
        snapshot: runnerSnapshot,
        stepLog,
      });
      const workflowInstance = buildWorkflowInstance(runner);
      const fromDefinitionSpy = jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);

      await expect(agenticService.handleEvent(event)).resolves.toBeNull();

      const [failedRun] = (await workflowRunService.findAndPopulate({
        order: { createdAt: 'DESC' },
        take: 1,
      })) as WorkflowRunFull[];

      expect(fromDefinitionSpy).toHaveBeenCalledTimes(1);
      expect(runner.start).toHaveBeenCalled();
      expect(failedRun.status).toBe('failed');
      expect(failedRun.error).toBe(failure.message);
      expect(failedRun.snapshot).toEqual(runnerSnapshot);
      expect(failedRun.output).toEqual(runnerState.output);
      expect(failedRun.context).toEqual(runtimeContext.state);
      expect(failedRun.stepLog).toEqual(stepLog);
      expect(failedRun.workflowVersion?.id ?? null).toBe(workflowVersionId);
      expect(failedRun.metadata).toEqual(
        expect.objectContaining({
          trigger: event.triggerType,
          initiated_by: initiator.id,
          state: {
            iteration: runnerState.iteration,
            accumulator: runnerState.accumulator,
            iterationStack: runnerState.iterationStack,
          },
        }),
      );
    });
  });

  describe('callWorkflow', () => {
    const createParentRun = async (parentRun?: string | null) => {
      const run = await workflowRunService.create({
        workflow: workflow.id,
        workflowVersion: workflowVersionId,
        triggeredBy: initiator.id,
        parentRun: parentRun ?? null,
        status: 'running',
        input: { parent: true },
      });
      const populated = await workflowRunService.findOneAndPopulate(run.id);
      if (!populated) {
        throw new Error(`Expected workflow run ${run.id} to be available`);
      }

      return populated;
    };

    it('starts a child workflow run and returns its finished output', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createParentRun();
      const event = createEvent({ text: 'call child' });
      const runtimeContext = { state: { child: true }, event } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
      const runnerSnapshot: WorkflowSnapshot = {
        status: 'finished',
        actions: {},
      };
      const runner = buildRunnerMock({
        startResult: {
          status: 'finished',
          output: { child: 'done' },
          snapshot: runnerSnapshot,
        },
        state: {
          input: { from: 'parent' },
          output: { child: 'done' },
          iterationStack: [],
        },
        snapshot: runnerSnapshot,
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      const result = await agenticService.callWorkflow({
        workflowId: childWorkflow.id,
        input: { from: 'parent' },
        parentContext: {
          workflowRunId: parentRun.id,
          event,
        } as any,
      });
      const [childRun] = (await workflowRunService.findAndPopulate({
        where: { workflow: { id: childWorkflow.id } },
        order: { createdAt: 'DESC' },
        take: 1,
      })) as WorkflowRunFull[];

      expect(result).toEqual({
        status: 'finished',
        workflow_id: childWorkflow.id,
        workflow_run_id: childRun.id,
        output: { child: 'done' },
      });
      expect(childRun.parentRun?.id).toBe(parentRun.id);
      expect(childRun.input).toEqual({ from: 'parent' });
      expect(runner.start).toHaveBeenCalledWith({
        inputData: { from: 'parent' },
        context: runtimeContext,
      });
    });

    it('resumes a suspended child leaf before unwinding the parent run', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createParentRun();
      const event = createEvent({ text: 'resume child' });
      const runtimeContext = { state: { resumed: true }, event } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
      const suspendedSnapshot: WorkflowSnapshot = {
        status: 'suspended',
        actions: {},
      };
      const finishedSnapshot: WorkflowSnapshot = {
        status: 'finished',
        actions: {},
      };
      const childStartRunner = buildRunnerMock({
        startResult: {
          status: 'suspended',
          step: { id: 'wait_child', name: 'wait_child', type: StepType.Task },
          reason: 'waiting for child input',
          snapshot: suspendedSnapshot,
        },
        state: {
          input: { original: true },
          output: { partial: true },
          iterationStack: [],
        },
        snapshot: suspendedSnapshot,
      });
      const childResumeRunner = buildRunnerMock({
        resumeResult: {
          status: 'finished',
          output: { child: 'done' },
          snapshot: finishedSnapshot,
        },
        state: {
          input: { original: true },
          output: { child: 'done' },
          iterationStack: [],
        },
        snapshot: finishedSnapshot,
      });
      const parentResumeRunner = buildRunnerMock({
        resumeResult: {
          status: 'finished',
          output: { parent: 'done' },
          snapshot: finishedSnapshot,
        },
        state: {
          input: { parent: true },
          output: { parent: 'done' },
          iterationStack: [],
        },
        snapshot: finishedSnapshot,
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(buildWorkflowInstance(childStartRunner))
        .mockReturnValueOnce(buildWorkflowInstance(childResumeRunner))
        .mockReturnValueOnce(buildWorkflowInstance(parentResumeRunner));

      const suspendedResult = await agenticService.callWorkflow({
        workflowId: childWorkflow.id,
        input: { original: true },
        parentContext: {
          workflowRunId: parentRun.id,
          event,
        } as any,
      });
      const [childRun] = (await workflowRunService.findAndPopulate({
        where: { workflow: { id: childWorkflow.id } },
        order: { createdAt: 'DESC' },
        take: 1,
      })) as WorkflowRunFull[];
      await workflowRunService.markSuspended(parentRun.id, {
        stepId: 'call_child',
        reason: 'awaiting_child_workflow',
        data: {
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
        },
        snapshot: suspendedSnapshot,
        context: { parent: true },
      });

      await expect(agenticService.handleEvent(event)).resolves.toEqual(
        expect.objectContaining({
          id: childRun.id,
          status: 'finished',
        }),
      );

      const updatedChild = await workflowRunService.findOneAndPopulate(
        childRun.id,
      );
      const updatedParent = await workflowRunService.findOneAndPopulate(
        parentRun.id,
      );
      const childOutput = {
        status: 'finished',
        workflow_id: childWorkflow.id,
        workflow_run_id: childRun.id,
        output: { child: 'done' },
      };

      expect(suspendedResult).toEqual({
        status: 'suspended',
        workflow_id: childWorkflow.id,
        workflow_run_id: childRun.id,
      });
      expect(updatedChild?.status).toBe('finished');
      expect(updatedParent?.status).toBe('finished');
      expect(updatedParent?.output).toEqual({ parent: 'done' });
      expect(parentResumeRunner.resume).toHaveBeenCalledWith({
        resumeData: childOutput,
      });
    });

    it('resumes the parent with a failed child payload and persists parent failure', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await workflowRunService.create({
        workflow: workflow.id,
        workflowVersion: workflowVersionId,
        triggeredBy: initiator.id,
        status: 'suspended',
        input: { parent: true },
        output: { before: true },
        context: { parent: true },
        snapshot: { status: 'suspended', actions: {} },
        suspendedStep: 'call_child',
        suspensionReason: 'awaiting_child_workflow',
      });
      const childRun = await workflowRunService.create({
        workflow: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        triggeredBy: initiator.id,
        parentRun: parentRun.id,
        status: 'suspended',
        input: { child: true },
        output: { partial: true },
        context: { child: true },
        snapshot: { status: 'suspended', actions: {} },
        suspendedStep: 'wait_child',
        suspensionReason: 'waiting',
      });
      const event = createEvent({ text: 'fail child' });
      const runtimeContext = { state: { failed: true }, event } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
      const failedSnapshot: WorkflowSnapshot = {
        status: 'failed',
        actions: {},
      };
      const childResumeRunner = buildRunnerMock({
        resumeResult: {
          status: 'failed',
          error: new Error('child failed'),
          snapshot: failedSnapshot,
        },
        state: {
          input: { child: true },
          output: { partial: true },
          iterationStack: [],
        },
        snapshot: failedSnapshot,
      });
      const parentResumeRunner = buildRunnerMock({
        resumeError: new Error('child failed'),
        state: {
          input: { parent: true },
          output: { before: true },
          iterationStack: [],
        },
        snapshot: failedSnapshot,
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(buildWorkflowInstance(childResumeRunner))
        .mockReturnValueOnce(buildWorkflowInstance(parentResumeRunner));

      await expect(agenticService.handleEvent(event)).resolves.toBeNull();

      const updatedChild = await workflowRunService.findOneAndPopulate(
        childRun.id,
      );
      const updatedParent = await workflowRunService.findOneAndPopulate(
        parentRun.id,
      );

      expect(updatedChild?.status).toBe('failed');
      expect(updatedChild?.error).toBe('child failed');
      expect(updatedParent?.status).toBe('failed');
      expect(updatedParent?.error).toBe('child failed');
      expect(parentResumeRunner.resume).toHaveBeenCalledWith({
        resumeData: {
          status: 'failed',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
          error: 'child failed',
        },
      });
    });

    it('rejects calls to workflows with a different workflow type', async () => {
      const childWorkflow = await createWorkflowWithDefinition(
        WorkflowType.manual,
      );
      const parentRun = await createParentRun();
      const event = createEvent({ text: 'wrong type' });

      await expect(
        agenticService.callWorkflow({
          workflowId: childWorkflow.id,
          parentContext: {
            workflowRunId: parentRun.id,
            event,
          } as any,
        }),
      ).rejects.toThrow('cannot be called from a "conversational" workflow');
    });

    it('rejects active call-stack cycles', async () => {
      const parentRun = await createParentRun();
      const event = createEvent({ text: 'cycle' });

      await expect(
        agenticService.callWorkflow({
          workflowId: workflow.id,
          parentContext: {
            workflowRunId: parentRun.id,
            event,
          } as any,
        }),
      ).rejects.toThrow('Workflow call cycle detected');
    });

    it('rejects workflow call stacks deeper than the configured limit', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const event = createEvent({ text: 'too deep' });
      let parentRunId: string | null = null;

      for (let i = 0; i < 10; i += 1) {
        const run = await workflowRunService.create({
          workflow: workflow.id,
          workflowVersion: workflowVersionId,
          triggeredBy: initiator.id,
          parentRun: parentRunId,
          status: 'running',
          input: { depth: i },
        });
        parentRunId = run.id;
      }

      await expect(
        agenticService.callWorkflow({
          workflowId: childWorkflow.id,
          parentContext: {
            workflowRunId: parentRunId,
            event,
          } as any,
        }),
      ).rejects.toThrow('Workflow call stack depth cannot exceed 10');
    });
  });
});

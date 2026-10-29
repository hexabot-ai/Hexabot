/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Workflow as AgenticWorkflow,
  BaseWorkflowContext,
  defineAction,
  ExecutionState,
  StepExecutionRecord,
  StepType,
  WaitInfo,
  WorkflowCheckpoint,
  WorkflowCheckpointInvalidError,
  WorkflowDefinitionDriftError,
  WorkflowResumeRejectedError,
  WorkflowRunner,
  WorkflowSnapshot,
  WorkflowWaitNotFoundError,
} from '@hexabot-ai/agentic';
import type { User, WorkflowRunFull, WorkflowFull } from '@hexabot-ai/types';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { I18nService } from '@/i18n/services/i18n.service';
import {
  installMessagingWorkflowFixturesTypeOrm,
  messagingWorkflowDefinition,
} from '@/utils/test/fixtures/workflow';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import { WorkflowContextFactory } from '@/workflow/contexts/workflow-context-factory';
import { WorkflowRunOrmEntity } from '@/workflow/entities/workflow-run.entity';
import { WorkflowVersionOrmEntity } from '@/workflow/entities/workflow-version.entity';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { failedValues, suspendedValues } from '@/workflow/lib/run-lease';
import { ManualEventWrapper } from '@/workflow/lib/trigger-event-wrapper';
import { WorkflowRunRepository } from '@/workflow/repositories/workflow-run.repository';
import { WorkflowVersionRepository } from '@/workflow/repositories/workflow-version.repository';
import { WorkflowRepository } from '@/workflow/repositories/workflow.repository';
import {
  AWAITING_APPROVAL_REASON,
  AWAITING_CHILD_WORKFLOW_REASON,
  WorkflowType,
  WorkflowVersionAction,
} from '@/workflow/types';

import { AgenticService, WorkflowRunClaimLostError } from './agentic.service';
import { WorkflowCallStackService } from './workflow-call-stack.service';
import { WorkflowCompiler } from './workflow-compiler.service';
import { WorkflowEventRestorer } from './workflow-event-restorer.service';
import { WorkflowJobs } from './workflow-jobs.service';
import { WorkflowRunExecutor } from './workflow-run-executor.service';
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
const eventRestorerMock = { restore: jest.fn() };
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
  startResult?: Awaited<ReturnType<WorkflowRunner['start']>>;
  resumeResult?: Awaited<ReturnType<WorkflowRunner['resume']>>;
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
/**
 * Mirror `Workflow.validateCheckpoint`: a missing checkpoint cannot resume,
 * and `refusal` refuses the payload checked before the run is claimed.
 */
const validateCheckpointMock = (refusal?: Error) =>
  jest.fn((checkpoint: unknown, options?: { resumeData?: unknown }) => {
    if (checkpoint === null || checkpoint === undefined) {
      return {
        ok: false,
        error: new WorkflowCheckpointInvalidError(
          'missing',
          'No checkpoint was persisted for this run.',
        ),
      };
    }

    if (refusal && options && 'resumeData' in options) {
      return { ok: false, error: refusal };
    }

    return { ok: true, checkpoint };
  });
const buildWorkflowInstance = (
  runner: jest.Mocked<WorkflowRunner>,
  overrides: {
    validateCheckpoint?: jest.Mock;
    buildRunnerFromCheckpoint?: jest.Mock;
  } = {},
) =>
  ({
    buildAsyncRunner: jest.fn(async () => runner),
    buildRunnerFromCheckpoint:
      overrides.buildRunnerFromCheckpoint ?? jest.fn(() => runner),
    validateCheckpoint:
      overrides.validateCheckpoint ?? validateCheckpointMock(),
  }) as unknown as AgenticWorkflow;
const buildWait = (overrides: Partial<WaitInfo> = {}): WaitInfo => ({
  waitId: 'wait_input@index:1',
  step: { id: 'wait_input', name: 'wait_input', type: StepType.Task },
  suspendKey: 'index:1',
  reason: 'awaiting_user_response',
  data: null,
  ...overrides,
});
const buildChildWait = (
  stepId: string,
  childWorkflowId: string,
  childRunId: string,
): WaitInfo =>
  buildWait({
    waitId: `${stepId}@index:1`,
    step: { id: stepId, name: stepId, type: StepType.Task },
    reason: AWAITING_CHILD_WORKFLOW_REASON,
    data: { workflow_id: childWorkflowId, workflow_run_id: childRunId },
  });
const buildApprovalWait = (stepId = 'approve'): WaitInfo =>
  buildWait({
    waitId: `${stepId}@index:1`,
    step: { id: stepId, name: stepId, type: StepType.Task },
    reason: AWAITING_APPROVAL_REASON,
    data: { message: 'Refund 42 EUR?', details: null },
  });
const buildCheckpoint = (
  waits: WaitInfo[],
  output: Record<string, unknown> = {},
): WorkflowCheckpoint => ({
  version: 1,
  fingerprint: 'fingerprint',
  input: {},
  output,
  root: {
    kind: 'sequence',
    index: 0,
    child: {
      kind: 'task',
      stepId: waits[0].step.id,
      inputs: {},
      awaitResults: {},
      wait: waits[0],
    },
  },
  waits,
});
const suspendedSnapshot: WorkflowSnapshot = {
  status: 'suspended',
  actions: {},
};
const finishedSnapshot: WorkflowSnapshot = {
  status: 'finished',
  actions: {},
};
const failedSnapshot: WorkflowSnapshot = {
  status: 'failed',
  actions: {},
};
const suspendedResult = (
  waits: WaitInfo[],
  output: Record<string, unknown> = {},
) => ({
  status: 'suspended' as const,
  waits,
  checkpoint: buildCheckpoint(waits, output),
  snapshot: suspendedSnapshot,
});
const finishedRunner = (output: Record<string, unknown>) =>
  buildRunnerMock({
    startResult: { status: 'finished', output, snapshot: finishedSnapshot },
    resumeResult: { status: 'finished', output, snapshot: finishedSnapshot },
    state: { input: {}, output, iterationStack: [] },
    snapshot: finishedSnapshot,
  });
class TestRuntimeContext extends BaseWorkflowContext {
  public eventEmitter = { emit: jest.fn(), on: jest.fn() };
}

describe('AgenticService (TypeORM)', () => {
  let agenticService: AgenticService;
  let callStack: WorkflowCallStackService;
  let jobs: WorkflowJobs;
  let workflowService: WorkflowService;
  let workflowVersionService: WorkflowVersionService;
  let workflowRunService: WorkflowRunService;
  let eventEmitter: EventEmitter2;
  let dataSource: DataSource;
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
  const createSuspendedRun = async ({
    checkpoint,
    workflowId = workflow.id,
    workflowVersion = workflowVersionId,
    parentRun = null,
    ...rest
  }: {
    checkpoint: WorkflowCheckpoint | null;
    workflowId?: string;
    workflowVersion?: string | null;
    parentRun?: string | null;
    context?: Record<string, unknown>;
    stepLog?: Record<string, StepExecutionRecord>;
  }) => {
    const run = await workflowRunService.create({
      workflow: workflowId,
      workflowVersion,
      triggeredBy: initiator.id,
      parentRun,
      status: 'suspended',
      input: { original: true },
      output: { saved: true },
      context: { saved: true },
      snapshot: suspendedSnapshot,
      checkpoint,
      suspendedAt: new Date('2026-01-01T10:00:00.000Z'),
      ...rest,
    });
    const populated = await workflowRunService.findOneAndPopulate(run.id);
    if (!populated) {
      throw new Error(`Expected workflow run ${run.id} to be available`);
    }

    return populated;
  };
  const countRuns = async () => (await workflowRunService.find({})).length;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        AgenticService,
        WorkflowRunExecutor,
        WorkflowCallStackService,
        WorkflowJobs,
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
        { provide: WorkflowEventRestorer, useValue: eventRestorerMock },
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

    dataSource = testing.module.get(DataSource);
    [
      agenticService,
      callStack,
      jobs,
      workflowService,
      workflowVersionService,
      workflowRunService,
      eventEmitter,
    ] = await testing.getMocks([
      AgenticService,
      WorkflowCallStackService,
      WorkflowJobs,
      WorkflowService,
      WorkflowVersionService,
      WorkflowRunService,
      EventEmitter2,
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
    eventRestorerMock.restore.mockImplementation(async () => createEvent());
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
        iterationStack: [],
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
      expect(storedRun.checkpoint).toBeNull();
      expect(storedRun.metadata).toEqual(
        expect.objectContaining({
          trigger: event.triggerType,
          initiated_by: initiator.id,
        }),
      );
      expect(storedRun.metadata).not.toHaveProperty('state');
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
        iterationStack: [],
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
        { skipBlockedOnOperator: true },
      );
      expect(pickWorkflowSpy).not.toHaveBeenCalled();
      expect(findOneAndPopulateSpy.mock.calls[0]?.[0]).toBe(workflow.id);
      expect(workflowInstance.buildAsyncRunner).toHaveBeenCalled();
    });

    it('scopes suspended run lookup by thread id when provided', async () => {
      const event = createEvent({ text: 'threaded resume' });
      // The run pins no definition, so the event tries to claim it to fail
      // it; another caller claimed it first.
      const claimSpy = jest
        .spyOn(workflowRunService, 'claimSuspended')
        .mockResolvedValue(null);
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
      await expect(agenticService.handleEvent(event)).resolves.toEqual(
        expect.objectContaining({ id: 'run-threaded' }),
      );

      expect(findSuspendedSpy).toHaveBeenCalledWith(
        initiator.id,
        threadId,
        undefined,
        { skipBlockedOnOperator: true },
      );
      expect(claimSpy).toHaveBeenCalledWith('run-threaded', null);
      expect(await countRuns()).toBe(0);
    });

    it('resumes a suspended run from its checkpoint and persists the next suspension', async () => {
      const wait = buildWait();
      const checkpoint = buildCheckpoint([wait], { saved: true });
      const baseRun = await createSuspendedRun({
        checkpoint,
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
      const nextWait = buildWait({
        waitId: 'prompt_user@key:await-user-input',
        step: { id: 'prompt_user', name: 'prompt_user', type: StepType.Task },
        suspendKey: 'key:await-user-input',
        reason: 'needs input',
        data: { prompt: true },
      });
      const resumeResult = suspendedResult([nextWait], { next: 'output' });
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
      const runner = buildRunnerMock({
        resumeResult,
        state: {
          input: { original: true },
          output: { next: 'output' },
          iterationStack: [],
        },
        snapshot: suspendedSnapshot,
        stepLog,
      });
      const workflowInstance = buildWorkflowInstance(runner);
      const fromDefinitionSpy = jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);

      await agenticService.handleEvent(event);

      const updatedRun = await workflowRunService.findOneAndPopulate(
        baseRun.id,
      );

      expect(fromDefinitionSpy).toHaveBeenCalledTimes(1);
      expect(workflowInstance.validateCheckpoint).toHaveBeenNthCalledWith(
        1,
        checkpoint,
      );
      expect(workflowInstance.validateCheckpoint).toHaveBeenNthCalledWith(
        2,
        checkpoint,
        { waitId: wait.waitId, resumeData: event.buildInput() },
      );
      expect(workflowInstance.buildRunnerFromCheckpoint).toHaveBeenCalledWith({
        checkpoint,
        context: runtimeContext,
        snapshot: suspendedSnapshot,
        runId: baseRun.id,
      });
      expect(runner.resume).toHaveBeenCalledWith({
        waitId: wait.waitId,
        resumeData: event.buildInput(),
      });
      expect(updatedRun?.status).toBe('suspended');
      expect(updatedRun?.checkpoint).toEqual(resumeResult.checkpoint);
      expect(updatedRun?.suspendedAt?.getTime()).not.toBe(
        baseRun.suspendedAt?.getTime(),
      );
      expect(updatedRun?.input).toEqual({ original: true });
      expect(updatedRun?.output).toEqual({ next: 'output' });
      expect(updatedRun?.context).toEqual(runtimeContext.state);
      expect(updatedRun?.stepLog).toEqual(
        expect.objectContaining({
          wait_input: expect.objectContaining({ status: 'suspended' }),
          prompt_user: stepLog.prompt_user,
        }),
      );
      expect(updatedRun?.metadata ?? {}).not.toHaveProperty('state');
    });

    it('resolves the first open wait that an event can resolve', async () => {
      const childWait = buildChildWait(
        'call_child',
        workflow.id,
        '33333333-3333-4333-8333-333333333333',
      );
      const replyWait = buildWait();
      const baseRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([childWait, replyWait]),
      });
      const event = createEvent({ text: 'reply' });
      const runner = finishedRunner({ done: true });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      await agenticService.handleEvent(event);

      expect(runner.resume).toHaveBeenCalledWith({
        waitId: replyWait.waitId,
        resumeData: event.buildInput(),
      });
      expect((await workflowRunService.findOne(baseRun.id))?.status).toBe(
        'finished',
      );
    });

    it('leaves a run that only waits on a child run untouched', async () => {
      const baseRun = await createSuspendedRun({ checkpoint: null });
      // A child still in flight, outside the initiator's runs, so the event
      // targets the parent.
      const childRun = await workflowRunService.create({
        workflow: workflow.id,
        workflowVersion: workflowVersionId,
        triggeredBy: null,
        parentRun: baseRun.id,
        status: 'running',
      });
      const childWait = buildChildWait('call_child', workflow.id, childRun.id);
      await workflowRunService.updateOne(baseRun.id, {
        checkpoint: buildCheckpoint([childWait]),
      });
      const runner = finishedRunner({ done: true });
      const workflowInstance = buildWorkflowInstance(runner);
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);

      await expect(
        agenticService.handleEvent(createEvent({ text: 'reply' })),
      ).resolves.toEqual(
        expect.objectContaining({ id: baseRun.id, status: 'suspended' }),
      );
      expect(workflowInstance.buildRunnerFromCheckpoint).not.toHaveBeenCalled();
      expect(runner.start).not.toHaveBeenCalled();
      expect(await countRuns()).toBe(2);
    });

    it('fails the call of a run waiting on a child run that was deleted', async () => {
      const deletedRunId = '33333333-3333-4333-8333-333333333333';
      const childWait = buildChildWait('call_child', workflow.id, deletedRunId);
      const baseRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([childWait]),
      });
      const runner = finishedRunner({ done: true });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      await expect(
        agenticService.handleEvent(createEvent({ text: 'reply' })),
      ).resolves.toEqual(
        expect.objectContaining({ id: baseRun.id, status: 'finished' }),
      );
      expect(runner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'failed',
          workflow_id: workflow.id,
          workflow_run_id: deletedRunId,
          error: `Called workflow run ${deletedRunId} was deleted`,
        },
      });
      expect(await countRuns()).toBe(1);
    });

    it('refuses a payload the wait does not accept before claiming the run', async () => {
      const wait = buildWait();
      const baseRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([wait]),
      });
      const runner = finishedRunner({ done: true });
      const refusal = new WorkflowResumeRejectedError('Payload refused', {
        issues: ['text: Required'],
      });
      const workflowInstance = buildWorkflowInstance(runner, {
        validateCheckpoint: validateCheckpointMock(refusal),
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);
      const claimSpy = jest.spyOn(workflowRunService, 'claimSuspended');
      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      const event = createEvent({ unexpected: true });

      await expect(agenticService.handleEvent(event)).resolves.toEqual(
        expect.objectContaining({ id: baseRun.id, status: 'suspended' }),
      );
      // Reported as the runner reports the payloads its steps refuse.
      expect(emitSpy).toHaveBeenCalledWith('hook:workflow:resume_rejected', {
        runId: baseRun.id,
        wait,
        resumeData: event.buildInput(),
        error: refusal,
      });
      expect(claimSpy).not.toHaveBeenCalled();
      expect(workflowContextFactoryMock.create).not.toHaveBeenCalled();
      expect(workflowInstance.buildRunnerFromCheckpoint).not.toHaveBeenCalled();
      expect(runner.start).not.toHaveBeenCalled();
      expect(await countRuns()).toBe(1);
    });

    it('puts the run back on its wait when the resumed step refuses the payload', async () => {
      const wait = buildWait();
      const checkpoint = buildCheckpoint([wait]);
      const stepLog: Record<string, StepExecutionRecord> = {
        wait_input: {
          id: 'wait_input',
          name: 'wait_input',
          status: 'suspended',
        },
      };
      const baseRun = await createSuspendedRun({
        checkpoint,
        stepLog,
      });
      workflowContextFactoryMock.create.mockResolvedValue({
        state: { saved: true, touched: true },
      });
      const runner = buildRunnerMock({
        resumeResult: {
          ...suspendedResult([wait]),
          checkpoint,
          rejection: {
            waitId: wait.waitId,
            error: new WorkflowResumeRejectedError('Unknown order id'),
          },
        },
        state: { input: {}, output: {}, iterationStack: [] },
        snapshot: suspendedSnapshot,
        stepLog: {
          wait_input: {
            id: 'wait_input',
            name: 'wait_input',
            status: 'running',
          },
        },
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      await expect(
        agenticService.handleEvent(createEvent({ order: 'unknown' })),
      ).resolves.toEqual(
        expect.objectContaining({ id: baseRun.id, status: 'suspended' }),
      );

      const updatedRun = await workflowRunService.findOne(baseRun.id);
      expect(runner.resume).toHaveBeenCalled();
      expect(updatedRun?.status).toBe('suspended');
      expect(updatedRun?.checkpoint).toEqual(checkpoint);
      expect(updatedRun?.context).toEqual({ saved: true });
      expect(updatedRun?.stepLog).toEqual(stepLog);
      expect(updatedRun?.suspendedAt?.getTime()).toBe(
        baseRun.suspendedAt?.getTime(),
      );
      expect(await countRuns()).toBe(1);
    });

    it('does not resume a run another caller already claimed', async () => {
      await createSuspendedRun({ checkpoint: buildCheckpoint([buildWait()]) });
      const runner = finishedRunner({ done: true });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      const [first, second] = await Promise.all([
        agenticService.handleEvent(createEvent({ text: 'first' })),
        agenticService.handleEvent(createEvent({ text: 'second' })),
      ]);

      expect(runner.resume).toHaveBeenCalledTimes(1);
      expect(runner.start).not.toHaveBeenCalled();
      expect(await countRuns()).toBe(1);
      expect([first?.status, second?.status]).toEqual(
        expect.arrayContaining(['finished']),
      );
    });

    it.each([
      ['has no checkpoint', null, undefined],
      [
        'was suspended against another definition',
        buildCheckpoint([buildWait()]),
        jest.fn(() => ({
          ok: false,
          error: new WorkflowDefinitionDriftError('old', 'new'),
        })),
      ],
    ])(
      'fails a run that %s and starts a new one',
      async (_label, checkpoint, validateCheckpoint) => {
        const staleRun = await createSuspendedRun({ checkpoint });
        const staleInstance = buildWorkflowInstance(finishedRunner({}), {
          validateCheckpoint,
        });
        const freshRunner = finishedRunner({ fresh: true });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValueOnce(staleInstance)
          .mockReturnValueOnce(buildWorkflowInstance(freshRunner));

        const result = await agenticService.handleEvent(
          createEvent({ text: 'hello again' }),
        );
        const failedRun = await workflowRunService.findOne(staleRun.id);
        expect(failedRun?.status).toBe('failed');
        expect(failedRun?.error).toMatch(/^Cannot resume workflow run: /);
        expect(failedRun?.checkpoint).toBeNull();
        expect(staleInstance.buildRunnerFromCheckpoint).not.toHaveBeenCalled();
        expect(freshRunner.start).toHaveBeenCalledTimes(1);
        expect(result).toEqual(expect.objectContaining({ status: 'finished' }));
        expect(result?.id).not.toBe(staleRun.id);
      },
    );

    it('fails a run whose workflow version is gone and starts a new one', async () => {
      const staleRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
        workflowVersion: null,
      });
      const freshRunner = finishedRunner({ fresh: true });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(freshRunner));

      await agenticService.handleEvent(createEvent({ text: 'hello again' }));

      const failedRun = await workflowRunService.findOne(staleRun.id);
      expect(failedRun?.status).toBe('failed');
      expect(failedRun?.error).toBe(
        'Cannot resume workflow run: Workflow definition is required to run the workflow',
      );
      expect(freshRunner.resume).not.toHaveBeenCalled();
      expect(freshRunner.start).toHaveBeenCalledTimes(1);
    });

    it('keeps a run suspended when its definition no longer compiles', async () => {
      const checkpoint = buildCheckpoint([buildWait()]);
      const baseRun = await createSuspendedRun({ checkpoint });
      jest.spyOn(AgenticWorkflow, 'fromDefinition').mockImplementation(() => {
        throw new Error(
          'No action implementations provided for: wait_input_action',
        );
      });
      const claimSpy = jest.spyOn(workflowRunService, 'claimSuspended');

      await expect(
        agenticService.handleEvent(createEvent({ text: 'reply' })),
      ).resolves.toBeNull();

      const storedRun = await workflowRunService.findOne(baseRun.id);
      expect(claimSpy).not.toHaveBeenCalled();
      expect(storedRun?.status).toBe('suspended');
      expect(storedRun?.checkpoint).toEqual(checkpoint);
      expect(storedRun?.suspendedAt?.getTime()).toBe(
        baseRun.suspendedAt?.getTime(),
      );
      expect(await countRuns()).toBe(1);
    });

    it('fails a claimed run whose runner cannot be restored', async () => {
      const baseRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
      });
      const runner = finishedRunner({});
      jest.spyOn(AgenticWorkflow, 'fromDefinition').mockReturnValue(
        buildWorkflowInstance(runner, {
          buildRunnerFromCheckpoint: jest.fn(() => {
            throw new WorkflowCheckpointInvalidError(
              'structure',
              'Frame does not match the flow',
            );
          }),
        }),
      );

      await expect(
        agenticService.handleEvent(createEvent({ text: 'reply' })),
      ).resolves.toBeNull();

      const failedRun = await workflowRunService.findOne(baseRun.id);
      expect(failedRun?.status).toBe('failed');
      expect(failedRun?.error).toBe('Frame does not match the flow');
      expect(failedRun?.checkpoint).toBeNull();
      expect(runner.resume).not.toHaveBeenCalled();
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
      expect(failedRun.checkpoint).toBeNull();
      expect(failedRun.metadata).toEqual(
        expect.objectContaining({
          trigger: event.triggerType,
          initiated_by: initiator.id,
        }),
      );
      expect(failedRun.metadata).not.toHaveProperty('state');
    });

    it('ignores an event without initiator', async () => {
      const event = new ManualEventWrapper({ text: 'hi' }, initiator.id);
      const findSuspendedSpy = jest.spyOn(
        workflowRunService,
        'findSuspendedRunByInitiator',
      );

      await expect(agenticService.handleEvent(event)).resolves.toBeNull();
      await expect(agenticService.dispatchEvent(event)).resolves.toBeNull();
      expect(findSuspendedSpy).not.toHaveBeenCalled();
      expect(await countRuns()).toBe(0);
    });

    it('ignores an event when no workflow is available', async () => {
      jest.spyOn(workflowService, 'pickWorkflow').mockResolvedValue(null);

      await expect(
        agenticService.handleEvent(createEvent({ text: 'hi' })),
      ).resolves.toBeNull();
      expect(await countRuns()).toBe(0);
    });

    it('ignores an event whose workflow has no definition', async () => {
      const fromDefinitionSpy = jest.spyOn(AgenticWorkflow, 'fromDefinition');

      await expect(
        agenticService.handleEvent(createEvent({ text: 'hi' }), {
          workflow: {
            ...workflow,
            definition: null,
          } as unknown as WorkflowFull,
        }),
      ).resolves.toBeNull();
      expect(fromDefinitionSpy).not.toHaveBeenCalled();
      expect(await countRuns()).toBe(0);
    });

    it('keeps a run suspended when its wait cannot be checked against the payload', async () => {
      const checkpoint = buildCheckpoint([buildWait()]);
      const baseRun = await createSuspendedRun({ checkpoint });
      const runner = finishedRunner({ done: true });
      jest.spyOn(AgenticWorkflow, 'fromDefinition').mockReturnValue(
        buildWorkflowInstance(runner, {
          validateCheckpoint: jest.fn(
            (stored: unknown, options?: { waitId: string }) =>
              options
                ? {
                    ok: false,
                    error: new WorkflowWaitNotFoundError(options.waitId, []),
                  }
                : { ok: true, checkpoint: stored },
          ),
        }),
      );
      const claimSpy = jest.spyOn(workflowRunService, 'claimSuspended');

      await expect(
        agenticService.handleEvent(createEvent({ text: 'reply' })),
      ).resolves.toBeNull();

      const storedRun = await workflowRunService.findOne(baseRun.id);
      expect(claimSpy).not.toHaveBeenCalled();
      expect(runner.resume).not.toHaveBeenCalled();
      expect(storedRun?.status).toBe('suspended');
      expect(storedRun?.checkpoint).toEqual(checkpoint);
      expect(await countRuns()).toBe(1);
    });

    it('fails a new run whose pinned definition is missing', async () => {
      const runner = finishedRunner({});
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));
      jest
        .spyOn(WorkflowCompiler.prototype, 'compile')
        .mockReturnValueOnce(undefined);

      await expect(
        agenticService.handleEvent(createEvent({ text: 'hi' })),
      ).resolves.toBeNull();

      const [run] = await workflowRunService.find({});
      expect(run).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Workflow definition is required to run the workflow',
        }),
      );
      expect(runner.start).not.toHaveBeenCalled();
    });

    it('drops a new run whose claim was lost before its runner started', async () => {
      const runner = finishedRunner({});
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));
      jest
        .spyOn(workflowRunService.repository, 'updateClaimed')
        .mockResolvedValueOnce(false);
      const persistCrashSpy = jest.spyOn(workflowRunService, 'persistCrash');

      await expect(
        agenticService.handleEvent(createEvent({ text: 'hi' })),
      ).resolves.toBeNull();

      const [run] = await workflowRunService.find({});
      // Nothing is written: whoever took the run over settles it.
      expect(run.status).toBe('idle');
      expect(runner.start).not.toHaveBeenCalled();
      expect(persistCrashSpy).not.toHaveBeenCalled();
    });
  });

  describe('with the agentic runner', () => {
    const askReply = defineAction({
      name: 'ask_reply',
      inputSchema: z.object({}),
      outputSchema: z.object({ text: z.string() }),
      execute: async ({ context }) =>
        await context.workflow.suspend({
          reason: 'awaiting_user_response',
          accepts: z.object({ text: z.string() }),
        }),
    });

    it('resumes a run from its persisted checkpoint in a fresh context', async () => {
      actionServiceMock.getRegistry.mockReturnValue({ ask_reply: askReply });
      // Every resume hydrates a brand-new context, as after a restart.
      workflowContextFactoryMock.create.mockImplementation(
        async () => new TestRuntimeContext({}),
      );
      const created = await workflowService.create({
        name: `ask_reply_${++workflowCounter}`,
        description: 'Suspends until a reply arrives',
        type: WorkflowType.conversational,
        schedule: null,
        createdBy: initiator.id,
      });
      await workflowVersionService.commit({
        workflow: created.id,
        definitionYml: AgenticWorkflow.stringifyDefinition({
          defs: { ask: { kind: 'task', action: 'ask_reply' } },
          flow: [{ do: 'ask' }],
          outputs: { reply: '=$output.ask.text' },
        }),
        action: WorkflowVersionAction.create,
        createdBy: initiator.id,
      });
      const send = async (input: Record<string, unknown>) => {
        const event = createEvent(input);
        event.setWorkflowId(created.id);

        return await agenticService.handleEvent(event);
      };
      const suspended = await send({ start: true });
      const persisted = await workflowRunService.findOne(suspended!.id);
      const checkpoint = persisted?.checkpoint as WorkflowCheckpoint;

      expect(persisted?.status).toBe('suspended');
      expect(checkpoint.waits).toEqual([
        expect.objectContaining({
          reason: 'awaiting_user_response',
          accepts: expect.objectContaining({ type: 'object' }),
        }),
      ]);

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      const refused = await send({ text: 42 });

      expect(refused).toEqual(
        expect.objectContaining({ id: suspended!.id, status: 'suspended' }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        'hook:workflow:resume_rejected',
        expect.objectContaining({
          runId: suspended!.id,
          wait: checkpoint.waits[0],
          error: expect.any(WorkflowResumeRejectedError),
        }),
      );
      expect(
        (await workflowRunService.findOne(suspended!.id))?.checkpoint,
      ).toEqual(checkpoint);

      const finished = await send({ text: 'hello' });

      expect(finished).toEqual(
        expect.objectContaining({
          id: suspended!.id,
          status: 'finished',
          output: { reply: 'hello' },
          checkpoint: null,
        }),
      );
      expect(await countRuns()).toBe(1);
    });
  });

  describe('operator waits', () => {
    const approval = {
      decision: 'approved',
      decided_by: { id: 'admin-1', name: 'Jane Doe' },
      decided_at: '2026-01-02T10:00:00.000Z',
    };
    /** An event of a conversational trigger, as a channel would send. */
    const createConversationalEvent = (input: Record<string, unknown>) => {
      const event = createEvent(input);
      Object.defineProperty(event, 'triggerType', {
        value: WorkflowType.conversational,
      });

      return event;
    };

    it('starts a new run for a manual trigger while a run waits on an admin', async () => {
      const blockedRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildApprovalWait()]),
      });
      const runner = finishedRunner({ fresh: true });
      const workflowInstance = buildWorkflowInstance(runner);
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);

      const result = await agenticService.handleEvent(
        createEvent({ text: 'again' }),
      );

      expect(result?.id).not.toBe(blockedRun.id);
      expect(result).toEqual(expect.objectContaining({ status: 'finished' }));
      expect(runner.start).toHaveBeenCalledTimes(1);
      expect(runner.resume).not.toHaveBeenCalled();
      expect((await workflowRunService.findOne(blockedRun.id))?.status).toBe(
        'suspended',
      );
      expect(await countRuns()).toBe(2);
    });

    it('holds a conversation message while its run waits on an admin', async () => {
      const blockedRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildApprovalWait()]),
      });
      const runner = finishedRunner({ fresh: true });
      const workflowInstance = buildWorkflowInstance(runner);
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(workflowInstance);
      const claimSpy = jest.spyOn(workflowRunService, 'claimSuspended');

      await expect(
        agenticService.handleEvent(
          createConversationalEvent({ text: 'are you there?' }),
        ),
      ).resolves.toEqual(
        expect.objectContaining({ id: blockedRun.id, status: 'suspended' }),
      );
      expect(claimSpy).not.toHaveBeenCalled();
      expect(runner.start).not.toHaveBeenCalled();
      expect(runner.resume).not.toHaveBeenCalled();
      expect(await countRuns()).toBe(1);
    });

    it('lets an event resolve the other waits of a run waiting on an admin', async () => {
      const replyWait = buildWait();
      const baseRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildApprovalWait(), replyWait]),
      });
      const event = createEvent({ text: 'reply' });
      const runner = finishedRunner({ done: true });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      await expect(agenticService.handleEvent(event)).resolves.toEqual(
        expect.objectContaining({ id: baseRun.id, status: 'finished' }),
      );
      expect(runner.resume).toHaveBeenCalledWith({
        waitId: replyWait.waitId,
        resumeData: event.buildInput(),
      });
    });

    describe('resumeWait', () => {
      it('resolves the requested wait with the payload', async () => {
        const approvalWait = buildApprovalWait();
        const baseRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([approvalWait, buildWait()]),
        });
        const runner = finishedRunner({ approved: true });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(runner));

        const outcome = await agenticService.resumeWait({
          run: baseRun,
          event: createEvent(),
          waitId: approvalWait.waitId,
          resumeData: approval,
        });

        expect(outcome).toEqual({
          status: 'accepted',
          run: expect.objectContaining({ id: baseRun.id }),
        });
        await jobs.onIdle();
        expect((await workflowRunService.findOne(baseRun.id))?.status).toBe(
          'finished',
        );
        expect(runner.resume).toHaveBeenCalledWith({
          waitId: approvalWait.waitId,
          resumeData: approval,
        });
      });

      it('refuses a payload before claiming the run', async () => {
        const approvalWait = buildApprovalWait();
        const baseRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([approvalWait]),
        });
        const refusal = new WorkflowResumeRejectedError('Payload refused', {
          issues: ['decision: Invalid option'],
        });
        jest.spyOn(AgenticWorkflow, 'fromDefinition').mockReturnValue(
          buildWorkflowInstance(finishedRunner({}), {
            validateCheckpoint: validateCheckpointMock(refusal),
          }),
        );
        const claimSpy = jest.spyOn(workflowRunService, 'claimSuspended');
        const outcome = await agenticService.resumeWait({
          run: baseRun,
          event: createEvent(),
          waitId: approvalWait.waitId,
          resumeData: { decision: 'maybe' },
        });

        expect(outcome).toEqual({ status: 'rejected', error: refusal });
        expect(claimSpy).not.toHaveBeenCalled();
      });

      it('lets only one of two concurrent decisions resume the run', async () => {
        const approvalWait = buildApprovalWait();
        const baseRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([approvalWait]),
        });
        const runner = finishedRunner({ approved: true });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(runner));
        const decide = () =>
          agenticService.resumeWait({
            run: baseRun,
            event: createEvent(),
            waitId: approvalWait.waitId,
            resumeData: approval,
          });
        const outcomes = await Promise.all([decide(), decide()]);

        expect(outcomes.map(({ status }) => status).sort()).toEqual([
          'accepted',
          'claim_lost',
        ]);
        await jobs.onIdle();
        expect(runner.resume).toHaveBeenCalledTimes(1);
      });

      it('reports a run that failed once its wait was resolved, after answering', async () => {
        const approvalWait = buildApprovalWait();
        const baseRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([approvalWait]),
        });
        const runner = buildRunnerMock({
          resumeError: new Error('Rejected by Jane Doe'),
          state: { input: {}, output: {}, iterationStack: [] },
          snapshot: failedSnapshot,
        });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(runner));

        const outcome = await agenticService.resumeWait({
          run: baseRun,
          event: createEvent(),
          waitId: approvalWait.waitId,
          resumeData: { ...approval, decision: 'rejected' },
        });

        expect(outcome.status).toBe('accepted');
        await jobs.onIdle();
        expect(await workflowRunService.findOne(baseRun.id)).toEqual(
          expect.objectContaining({
            status: 'failed',
            error: 'Rejected by Jane Doe',
          }),
        );
      });

      it('throws and keeps the run waiting when its definition no longer compiles', async () => {
        const approvalWait = buildApprovalWait();
        const checkpoint = buildCheckpoint([approvalWait]);
        const baseRun = await createSuspendedRun({ checkpoint });
        jest.spyOn(AgenticWorkflow, 'fromDefinition').mockImplementation(() => {
          throw new Error('No action implementations provided for: x');
        });

        await expect(
          agenticService.resumeWait({
            run: baseRun,
            event: createEvent(),
            waitId: approvalWait.waitId,
            resumeData: approval,
          }),
        ).rejects.toThrow('No action implementations provided for: x');

        const storedRun = await workflowRunService.findOne(baseRun.id);
        expect(storedRun?.status).toBe('suspended');
        expect(storedRun?.checkpoint).toEqual(checkpoint);
      });

      it('fails a run that can no longer resume and passes the failure to its parent', async () => {
        const childWorkflow = await createWorkflowWithDefinition();
        const parentRun = await createSuspendedRun({ checkpoint: null });
        const childRun = await createSuspendedRun({
          checkpoint: null,
          workflowId: childWorkflow.id,
          workflowVersion: childWorkflow.currentVersion?.id ?? null,
          parentRun: parentRun.id,
        });
        const childWait = buildChildWait(
          'call_child',
          childWorkflow.id,
          childRun.id,
        );
        await workflowRunService.updateOne(parentRun.id, {
          checkpoint: buildCheckpoint([childWait]),
        });
        const parentRunner = finishedRunner({ parent: 'done' });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(parentRunner));

        const outcome = await agenticService.resumeWait({
          run: childRun,
          event: createEvent(),
          waitId: buildApprovalWait().waitId,
          resumeData: approval,
        });
        const error =
          'Cannot resume workflow run: No checkpoint was persisted for this run.';
        expect(outcome).toEqual({ status: 'unresumable', error });
        expect(await workflowRunService.findOne(childRun.id)).toEqual(
          expect.objectContaining({ status: 'failed', error }),
        );
        // The parent goes on in the background.
        await jobs.onIdle();
        expect(parentRunner.resume).toHaveBeenCalledWith({
          waitId: childWait.waitId,
          resumeData: {
            status: 'failed',
            workflow_id: childWorkflow.id,
            workflow_run_id: childRun.id,
            error,
          },
        });
        expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
          'finished',
        );
      });

      it('leaves a run that can no longer resume to the caller that claimed it first', async () => {
        const baseRun = await createSuspendedRun({ checkpoint: null });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(finishedRunner({})));
        jest
          .spyOn(workflowRunService, 'claimSuspended')
          .mockResolvedValueOnce(null);

        const outcome = await agenticService.resumeWait({
          run: baseRun,
          event: createEvent(),
          waitId: buildApprovalWait().waitId,
          resumeData: approval,
        });

        expect(outcome).toEqual({ status: 'claim_lost' });
        expect((await workflowRunService.findOne(baseRun.id))?.status).toBe(
          'suspended',
        );
      });

      it('leaves a run that can no longer resume once it is taken over while being failed', async () => {
        const baseRun = await createSuspendedRun({ checkpoint: null });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(finishedRunner({})));
        jest
          .spyOn(workflowRunService.repository, 'settle')
          .mockResolvedValueOnce(false);

        const outcome = await agenticService.resumeWait({
          run: baseRun,
          event: createEvent(),
          waitId: buildApprovalWait().waitId,
          resumeData: approval,
        });

        expect(outcome).toEqual({ status: 'claim_lost' });
        expect((await workflowRunService.findOne(baseRun.id))?.status).not.toBe(
          'failed',
        );
      });

      it('answers with the claimed run when it cannot be read back', async () => {
        const approvalWait = buildApprovalWait();
        const baseRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([approvalWait]),
        });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(finishedRunner({ ok: true })));
        jest
          .spyOn(workflowRunService, 'findOneAndPopulate')
          .mockRejectedValueOnce(new Error('database unavailable'));

        const outcome = await agenticService.resumeWait({
          run: baseRun,
          event: createEvent(),
          waitId: approvalWait.waitId,
          resumeData: approval,
        });

        expect(outcome).toEqual({
          status: 'accepted',
          run: expect.objectContaining({ id: baseRun.id, status: 'running' }),
        });
        await jobs.onIdle();
        expect((await workflowRunService.findOne(baseRun.id))?.status).toBe(
          'finished',
        );
      });
    });

    describe('cancelRun', () => {
      it('fails the run and cancels its open waits', async () => {
        const approvalWait = buildApprovalWait();
        const replyWait = buildWait();
        const baseRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([approvalWait, replyWait]),
          stepLog: {
            approve: { id: 'approve', name: 'approve', status: 'suspended' },
          },
        });
        await workflowRunService.updateOne(baseRun.id, {
          awaitingOperator: true,
        });
        const emitSpy = jest.spyOn(eventEmitter, 'emit');
        const outcome = await agenticService.cancelRun({
          run: baseRun,
          message: 'Cancelled by Jane Doe: stale',
        });

        expect(outcome.status).toBe('cancelled');
        const storedRun = await workflowRunService.findOne(baseRun.id);
        expect(storedRun).toEqual(
          expect.objectContaining({
            status: 'failed',
            error: 'Cancelled by Jane Doe: stale',
            checkpoint: null,
            awaitingOperator: false,
          }),
        );
        expect(storedRun?.snapshot).toEqual({
          status: 'failed',
          actions: {
            approve: expect.objectContaining({
              status: 'cancelled',
              reason: 'Cancelled by Jane Doe: stale',
            }),
            wait_input: expect.objectContaining({ status: 'cancelled' }),
          },
        });
        expect(storedRun?.stepLog?.approve).toEqual(
          expect.objectContaining({
            status: 'cancelled',
            error: { message: 'Cancelled by Jane Doe: stale' },
          }),
        );
        expect(emitSpy).toHaveBeenCalledWith(
          'hook:step:cancelled',
          expect.objectContaining({ runId: baseRun.id, wait: approvalWait }),
        );
        expect(emitSpy).toHaveBeenCalledWith('hook:workflow:failure', {
          runId: baseRun.id,
          error: expect.any(Error),
        });
      });

      it('leaves a run another caller resumed or cancelled first', async () => {
        const baseRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([buildApprovalWait()]),
        });
        const outcome = await agenticService.cancelRun({
          run: { ...baseRun, suspendedAt: new Date('2025-01-01T00:00:00Z') },
          message: 'Cancelled by Jane Doe',
        });

        expect(outcome.status).toBe('claim_lost');
        expect((await workflowRunService.findOne(baseRun.id))?.status).toBe(
          'suspended',
        );
      });

      it('cancels the suspended runs called by a cancelled run', async () => {
        const childWorkflow = await createWorkflowWithDefinition();
        const parentRun = await createSuspendedRun({ checkpoint: null });
        const childRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([buildApprovalWait()]),
          workflowId: childWorkflow.id,
          workflowVersion: childWorkflow.currentVersion?.id ?? null,
          parentRun: parentRun.id,
        });
        await workflowRunService.updateOne(parentRun.id, {
          checkpoint: buildCheckpoint([
            buildChildWait('call_child', childWorkflow.id, childRun.id),
          ]),
        });

        await agenticService.cancelRun({
          run: (await workflowRunService.findOneAndPopulate(parentRun.id))!,
          message: 'Cancelled by Jane Doe',
        });

        expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
          'failed',
        );
        expect(await workflowRunService.findOne(childRun.id)).toEqual(
          expect.objectContaining({
            status: 'failed',
            error: `Parent workflow run ${parentRun.id} was cancelled`,
          }),
        );
      });

      it('passes a failed result to the parent of a cancelled run', async () => {
        const childWorkflow = await createWorkflowWithDefinition();
        const parentRun = await createSuspendedRun({ checkpoint: null });
        const childRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([buildApprovalWait()]),
          workflowId: childWorkflow.id,
          workflowVersion: childWorkflow.currentVersion?.id ?? null,
          parentRun: parentRun.id,
        });
        const childWait = buildChildWait(
          'call_child',
          childWorkflow.id,
          childRun.id,
        );
        await workflowRunService.updateOne(parentRun.id, {
          checkpoint: buildCheckpoint([childWait]),
        });
        const parentRunner = finishedRunner({ parent: 'done' });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(parentRunner));

        const outcome = await agenticService.cancelRun({
          run: childRun,
          message: 'Cancelled by Jane Doe',
        });

        expect(outcome).toEqual(
          expect.objectContaining({
            status: 'cancelled',
            run: expect.objectContaining({ id: childRun.id, status: 'failed' }),
          }),
        );
        // The parent goes on in the background, with its trigger rebuilt.
        await jobs.onIdle();
        expect(eventRestorerMock.restore).toHaveBeenCalledWith(
          expect.objectContaining({ id: parentRun.id }),
        );
        expect(parentRunner.resume).toHaveBeenCalledWith({
          waitId: childWait.waitId,
          resumeData: {
            status: 'failed',
            workflow_id: childWorkflow.id,
            workflow_run_id: childRun.id,
            error: 'Cancelled by Jane Doe',
          },
        });
        expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
          'finished',
        );
      });

      it('leaves the parent of a cancelled run waiting when its trigger cannot be rebuilt', async () => {
        const childWorkflow = await createWorkflowWithDefinition();
        const parentRun = await createSuspendedRun({ checkpoint: null });
        const childRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([buildApprovalWait()]),
          workflowId: childWorkflow.id,
          workflowVersion: childWorkflow.currentVersion?.id ?? null,
          parentRun: parentRun.id,
        });
        await workflowRunService.updateOne(parentRun.id, {
          checkpoint: buildCheckpoint([
            buildChildWait('call_child', childWorkflow.id, childRun.id),
          ]),
        });
        const fromDefinitionSpy = jest.spyOn(AgenticWorkflow, 'fromDefinition');
        eventRestorerMock.restore.mockRejectedValueOnce(
          new Error('Thread is closed'),
        );
        const outcome = await agenticService.cancelRun({
          run: childRun,
          message: 'Cancelled by Jane Doe',
        });

        expect(outcome.status).toBe('cancelled');
        await jobs.onIdle();
        // The parent catches the result up on its next event.
        expect(fromDefinitionSpy).not.toHaveBeenCalled();
        expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
          'suspended',
        );
      });
    });

    it('resumes an approval with the agentic runner', async () => {
      const awaitDecision = defineAction({
        name: 'await_decision',
        inputSchema: z.object({}),
        outputSchema: z.object({ decision: z.string() }),
        execute: async ({ context }) =>
          await context.workflow.suspend({
            reason: AWAITING_APPROVAL_REASON,
            accepts: z.object({ decision: z.enum(['approved', 'rejected']) }),
          }),
      });
      actionServiceMock.getRegistry.mockReturnValue({
        await_decision: awaitDecision,
      });
      workflowContextFactoryMock.create.mockImplementation(
        async () => new TestRuntimeContext({}),
      );
      const created = await workflowService.create({
        name: `await_decision_${++workflowCounter}`,
        description: 'Suspends until an admin decides',
        type: WorkflowType.manual,
        schedule: null,
        createdBy: initiator.id,
      });
      await workflowVersionService.commit({
        workflow: created.id,
        definitionYml: AgenticWorkflow.stringifyDefinition({
          defs: { review: { kind: 'task', action: 'await_decision' } },
          flow: [{ do: 'review' }],
          outputs: { decision: '=$output.review.decision' },
        }),
        action: WorkflowVersionAction.create,
        createdBy: initiator.id,
      });
      const trigger = async () => {
        const event = createEvent({});
        event.setWorkflowId(created.id);

        return (await agenticService.handleEvent(event))!;
      };
      const first = await trigger();
      const flagged = await workflowRunService.findOneAndPopulate(first.id);
      expect(flagged).toEqual(
        expect.objectContaining({
          status: 'suspended',
          awaitingOperator: true,
        }),
      );

      // Waiting on an admin does not absorb the next manual trigger.
      const second = await trigger();
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('suspended');

      const [wait] = (flagged!.checkpoint as WorkflowCheckpoint).waits;
      const refused = await agenticService.resumeWait({
        run: flagged!,
        event: createEvent(),
        waitId: wait.waitId,
        resumeData: { decision: 'maybe' },
      });
      expect(refused.status).toBe('rejected');

      const outcome = await agenticService.resumeWait({
        run: flagged!,
        event: createEvent(),
        waitId: wait.waitId,
        resumeData: { decision: 'approved' },
      });

      expect(outcome.status).toBe('accepted');
      await jobs.onIdle();
      expect(await workflowRunService.findOne(first.id)).toEqual(
        expect.objectContaining({
          status: 'finished',
          output: { decision: 'approved' },
          awaitingOperator: false,
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
      const childStartRunner = buildRunnerMock({
        startResult: suspendedResult([
          buildWait({
            waitId: 'wait_child@index:1',
            step: { id: 'wait_child', name: 'wait_child', type: StepType.Task },
          }),
        ]),
        state: {
          input: { original: true },
          output: { partial: true },
          iterationStack: [],
        },
        snapshot: suspendedSnapshot,
      });
      const childResumeRunner = finishedRunner({ child: 'done' });
      const parentResumeRunner = finishedRunner({ parent: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(buildWorkflowInstance(childStartRunner))
        .mockReturnValueOnce(buildWorkflowInstance(childResumeRunner))
        .mockReturnValueOnce(buildWorkflowInstance(parentResumeRunner));

      const suspendedCall = await agenticService.callWorkflow({
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
      // The parent also waits on a reply in a parallel branch: the child
      // result must resolve the wait of the step that spawned this child.
      const replyWait = buildWait();
      const childWait = buildChildWait(
        'call_child',
        childWorkflow.id,
        childRun.id,
      );
      await workflowRunService.repository.settle(
        parentRun.id,
        suspendedValues({
          checkpoint: buildCheckpoint([replyWait, childWait]),
          snapshot: suspendedSnapshot,
          context: { parent: true },
        }),
        null,
      );

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

      expect(suspendedCall).toEqual({
        status: 'suspended',
        workflow_id: childWorkflow.id,
        workflow_run_id: childRun.id,
      });
      expect(childResumeRunner.resume).toHaveBeenCalledWith({
        waitId: 'wait_child@index:1',
        resumeData: event.buildInput(),
      });
      expect(updatedChild?.status).toBe('finished');
      expect(updatedChild?.checkpoint).toBeNull();
      expect(updatedParent?.status).toBe('finished');
      expect(updatedParent?.output).toEqual({ parent: 'done' });
      expect(parentResumeRunner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'finished',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
          output: { child: 'done' },
        },
      });
    });

    it('resumes the parent with a failed child payload and persists parent failure', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({
        checkpoint: null,
      });
      const childRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      const childWait = buildChildWait(
        'call_child',
        childWorkflow.id,
        childRun.id,
      );
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([childWait]),
      });
      const event = createEvent({ text: 'fail child' });
      const runtimeContext = { state: { failed: true }, event } as any;
      workflowContextFactoryMock.create.mockResolvedValue(runtimeContext);
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

      // The event's run settled; the crash of its parent is its own.
      await expect(agenticService.handleEvent(event)).resolves.toEqual(
        expect.objectContaining({ id: childRun.id, status: 'failed' }),
      );

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
      expect(updatedParent?.checkpoint).toBeNull();
      expect(parentResumeRunner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'failed',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
          error: 'child failed',
        },
      });
    });

    /** A parent that fails once it receives the failed result of its child. */
    const failingParentRunner = () =>
      buildRunnerMock({
        resumeResult: {
          status: 'failed',
          error: new Error('Cannot resume child'),
          snapshot: failedSnapshot,
        },
        state: { input: {}, output: {}, iterationStack: [] },
        snapshot: failedSnapshot,
      });
    /**
     * Suspend a parent run on a child run that can never resume (it has no
     * checkpoint). The parent resumes with `parentRunner` and the new run the
     * event starts runs with `freshRunner`, whichever of them comes first.
     */
    const setUpUnresumableChild = async (
      parentRunner: jest.Mocked<WorkflowRunner>,
      freshRunner: jest.Mocked<WorkflowRunner>,
    ) => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({ checkpoint: null });
      const childRun = await createSuspendedRun({
        checkpoint: null,
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      const childWait = buildChildWait(
        'call_child',
        childWorkflow.id,
        childRun.id,
      );
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([childWait]),
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(buildWorkflowInstance(finishedRunner({})))
        .mockReturnValue(
          buildWorkflowInstance(freshRunner, {
            buildRunnerFromCheckpoint: jest.fn(() => parentRunner),
          }),
        );

      return { childWorkflow, parentRun, childRun, childWait };
    };

    it('unwinds an unresumable child into its parent and starts one new run', async () => {
      const parentRunner = failingParentRunner();
      const freshRunner = finishedRunner({ fresh: true });
      const { childWorkflow, parentRun, childRun, childWait } =
        await setUpUnresumableChild(parentRunner, freshRunner);

      await agenticService.handleEvent(createEvent({ text: 'hello again' }));

      expect((await workflowRunService.findOne(childRun.id))?.status).toBe(
        'failed',
      );
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'failed',
      );
      expect(parentRunner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'failed',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
          error:
            'Cannot resume workflow run: No checkpoint was persisted for this run.',
        },
      });
      expect(freshRunner.start).toHaveBeenCalledTimes(1);
      expect(await countRuns()).toBe(3);
    });

    it('lets the parent of an unresumable run go on before the new run starts when the caller waits', async () => {
      const steps: string[] = [];
      const parentRunner = failingParentRunner();
      const resume = parentRunner.resume.getMockImplementation()!;
      parentRunner.resume.mockImplementation(async (options) => {
        steps.push('parent resumed');
        // Leave the new run time to start, were it not waiting.
        await new Promise((resolve) => setTimeout(resolve, 20));
        steps.push('parent went on');

        return await resume(options);
      });
      const freshRunner = finishedRunner({ fresh: true });
      const start = freshRunner.start.getMockImplementation()!;
      freshRunner.start.mockImplementation(async (options) => {
        steps.push('new run started');

        return await start(options);
      });
      await setUpUnresumableChild(parentRunner, freshRunner);

      await expect(
        agenticService.handleEvent(createEvent({ text: 'hello again' })),
      ).resolves.toEqual(
        expect.objectContaining({
          status: 'finished',
          output: { fresh: true },
        }),
      );
      expect(steps).toEqual([
        'parent resumed',
        'parent went on',
        'new run started',
      ]);
    });

    it('answers a dispatched event with the new run while the parent of an unresumable run goes on', async () => {
      const parentRunner = failingParentRunner();
      const resume = parentRunner.resume.getMockImplementation()!;
      let releaseParent!: () => void;
      const parentResumed = new Promise<void>((markResumed) => {
        parentRunner.resume.mockImplementation(async (options) => {
          const released = new Promise<void>((release) => {
            releaseParent = release;
          });
          markResumed();
          await released;

          return await resume(options);
        });
      });
      const freshRunner = finishedRunner({ fresh: true });
      const { parentRun, childRun } = await setUpUnresumableChild(
        parentRunner,
        freshRunner,
      );
      // The parent is only released once the event is answered: an answer
      // that waited for it would never come.
      const dispatched = await agenticService.dispatchEvent(
        createEvent({ text: 'hello again' }),
      );

      expect(dispatched).toEqual(expect.objectContaining({ status: 'idle' }));
      expect([parentRun.id, childRun.id]).not.toContain(dispatched!.id);
      await parentResumed;
      releaseParent();
      await jobs.onIdle();
      expect((await workflowRunService.findOne(dispatched!.id))?.status).toBe(
        'finished',
      );
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'failed',
      );
    });

    it('fails the parent when it refuses the child result', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({ checkpoint: null });
      const childRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([
          buildChildWait('call_child', childWorkflow.id, childRun.id),
        ]),
      });
      const parentResumeRunner = finishedRunner({});
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(buildWorkflowInstance(finishedRunner({})))
        .mockReturnValueOnce(
          buildWorkflowInstance(parentResumeRunner, {
            validateCheckpoint: validateCheckpointMock(
              new WorkflowResumeRejectedError('Unexpected child result'),
            ),
          }),
        );

      await agenticService.handleEvent(createEvent({ text: 'reply' }));

      const updatedParent = await workflowRunService.findOne(parentRun.id);
      expect((await workflowRunService.findOne(childRun.id))?.status).toBe(
        'finished',
      );
      expect(parentResumeRunner.resume).not.toHaveBeenCalled();
      expect(updatedParent?.status).toBe('failed');
      expect(updatedParent?.error).toBe(
        'Cannot resume workflow run: Unexpected child result',
      );
    });

    it('delivers a child result to a parent once its definition compiles again', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({ checkpoint: null });
      const childRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      const childWait = buildChildWait(
        'call_child',
        childWorkflow.id,
        childRun.id,
      );
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([childWait]),
      });
      const parentRunner = finishedRunner({ parent: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(parentRunner))
        .mockReturnValueOnce(
          buildWorkflowInstance(finishedRunner({ child: 'done' })),
        )
        .mockImplementationOnce(() => {
          throw new Error('No action implementations provided for: call_child');
        });

      await agenticService.handleEvent(createEvent({ text: 'reply' }));

      expect((await workflowRunService.findOne(childRun.id))?.status).toBe(
        'finished',
      );
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'suspended',
      );
      expect(parentRunner.resume).not.toHaveBeenCalled();

      await agenticService.handleEvent(createEvent({ text: 'later' }));

      expect(parentRunner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'finished',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
          output: { child: 'done' },
        },
      });
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'finished',
      );
      expect(await countRuns()).toBe(2);
    });

    it('delivers a child result the parent missed once it suspends again', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({ checkpoint: null });
      const childA = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      // Child B finished while the parent was held by another caller, so its
      // result never reached the parent.
      const childB = await workflowRunService.create({
        workflow: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        triggeredBy: initiator.id,
        parentRun: parentRun.id,
        status: 'finished',
        output: { child: 'b' },
      });
      const waitA = buildChildWait('call_a', childWorkflow.id, childA.id);
      const waitB = buildChildWait('call_b', childWorkflow.id, childB.id);
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([waitA, waitB]),
      });
      const parentFirstRunner = buildRunnerMock({
        resumeResult: suspendedResult([waitB]),
        state: { input: {}, output: {}, iterationStack: [] },
        snapshot: suspendedSnapshot,
      });
      const parentSecondRunner = finishedRunner({ parent: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(
          buildWorkflowInstance(finishedRunner({ child: 'a' })),
        )
        .mockReturnValueOnce(buildWorkflowInstance(parentFirstRunner))
        .mockReturnValueOnce(buildWorkflowInstance(parentSecondRunner));

      await agenticService.handleEvent(createEvent({ text: 'reply' }));

      expect(parentFirstRunner.resume).toHaveBeenCalledWith({
        waitId: waitA.waitId,
        resumeData: expect.objectContaining({ workflow_run_id: childA.id }),
      });
      expect(parentSecondRunner.resume).toHaveBeenCalledWith({
        waitId: waitB.waitId,
        resumeData: {
          status: 'finished',
          workflow_id: childWorkflow.id,
          workflow_run_id: childB.id,
          output: { child: 'b' },
        },
      });
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'finished',
      );
    });

    it('delivers the result of a child that ended during the first pass of its parent', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const event = createEvent({ text: 'start parent' });
      event.setWorkflowId(workflow.id);
      let parentRunId: string | undefined;
      let childRunId: string | undefined;
      let childWait: WaitInfo | undefined;
      const parentStartRunner = buildRunnerMock({
        state: { input: {}, output: {}, iterationStack: [] },
        snapshot: suspendedSnapshot,
      });
      parentStartRunner.start.mockImplementation(async () => {
        // The child suspended, then another event resumed it to completion
        // while this first pass of the parent was still going: the child
        // could not resume a parent that was not suspended yet.
        const childRun = await workflowRunService.create({
          workflow: childWorkflow.id,
          workflowVersion: childWorkflow.currentVersion?.id ?? null,
          triggeredBy: initiator.id,
          parentRun: parentRunId,
          status: 'finished',
          output: { child: 'done' },
        });
        childRunId = childRun.id;
        childWait = buildChildWait('call_child', childWorkflow.id, childRun.id);

        return suspendedResult([childWait]);
      });
      const parentStartInstance = buildWorkflowInstance(parentStartRunner);
      (parentStartInstance.buildAsyncRunner as jest.Mock).mockImplementation(
        async (options?: { runId?: string }) => {
          parentRunId = options?.runId;

          return parentStartRunner;
        },
      );
      const parentResumeRunner = finishedRunner({ parent: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(parentStartInstance)
        .mockReturnValueOnce(buildWorkflowInstance(parentResumeRunner));

      const parentRun = await agenticService.handleEvent(event);

      expect(parentResumeRunner.resume).toHaveBeenCalledWith({
        waitId: childWait?.waitId,
        resumeData: {
          status: 'finished',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRunId,
          output: { child: 'done' },
        },
      });
      expect(parentRun).toEqual(
        expect.objectContaining({
          id: parentRunId,
          status: 'finished',
          output: { parent: 'done' },
        }),
      );
    });

    it('delivers a child result that ended while a refused resume held the parent', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({ checkpoint: null });
      // The child ended while the parent was claimed by the resume below, so
      // its own resume of the parent lost the claim.
      const childRun = await workflowRunService.create({
        workflow: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        triggeredBy: initiator.id,
        parentRun: parentRun.id,
        status: 'finished',
        output: { child: 'done' },
      });
      const replyWait = buildWait();
      const childWait = buildChildWait(
        'call_child',
        childWorkflow.id,
        childRun.id,
      );
      const checkpoint = buildCheckpoint([replyWait, childWait]);
      await workflowRunService.updateOne(parentRun.id, { checkpoint });
      const refusingRunner = buildRunnerMock({
        resumeResult: {
          ...suspendedResult([replyWait, childWait]),
          checkpoint,
          rejection: {
            waitId: replyWait.waitId,
            error: new WorkflowResumeRejectedError('Unknown order id'),
          },
        },
        state: { input: {}, output: {}, iterationStack: [] },
        snapshot: suspendedSnapshot,
      });
      const parentResumeRunner = finishedRunner({ parent: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(buildWorkflowInstance(refusingRunner))
        .mockReturnValueOnce(buildWorkflowInstance(parentResumeRunner));
      const event = createEvent({ order: 'unknown' });

      await agenticService.handleEvent(event);

      expect(refusingRunner.resume).toHaveBeenCalledWith({
        waitId: replyWait.waitId,
        resumeData: event.buildInput(),
      });
      expect(parentResumeRunner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'finished',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
          output: { child: 'done' },
        },
      });
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'finished',
      );
    });

    it('fails a parent that can no longer resume once its child ends, and passes the failure on', async () => {
      const parentWorkflow = await createWorkflowWithDefinition();
      const childWorkflow = await createWorkflowWithDefinition();
      const rootRun = await createSuspendedRun({ checkpoint: null });
      const parentRun = await createSuspendedRun({
        checkpoint: null,
        workflowId: parentWorkflow.id,
        workflowVersion: parentWorkflow.currentVersion?.id ?? null,
        parentRun: rootRun.id,
      });
      const childRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      const rootWait = buildChildWait(
        'call_parent',
        parentWorkflow.id,
        parentRun.id,
      );
      await workflowRunService.updateOne(rootRun.id, {
        checkpoint: buildCheckpoint([rootWait]),
      });
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([
          buildChildWait('call_child', childWorkflow.id, childRun.id),
        ]),
      });
      const rootRunner = finishedRunner({ root: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(
          buildWorkflowInstance(finishedRunner({ child: 'done' })),
        )
        .mockReturnValueOnce(
          buildWorkflowInstance(finishedRunner({}), {
            validateCheckpoint: jest.fn(() => ({
              ok: false,
              error: new WorkflowDefinitionDriftError('old', 'new'),
            })),
          }),
        )
        .mockReturnValueOnce(buildWorkflowInstance(rootRunner));

      await expect(
        agenticService.handleEvent(createEvent({ text: 'reply' })),
      ).resolves.toEqual(
        expect.objectContaining({ id: childRun.id, status: 'finished' }),
      );

      const failedParent = await workflowRunService.findOne(parentRun.id);
      expect(failedParent?.status).toBe('failed');
      expect(failedParent?.error).toMatch(/^Cannot resume workflow run: /);
      expect(rootRunner.resume).toHaveBeenCalledWith({
        waitId: rootWait.waitId,
        resumeData: {
          status: 'failed',
          workflow_id: parentWorkflow.id,
          workflow_run_id: parentRun.id,
          error: failedParent?.error,
        },
      });
      expect((await workflowRunService.findOne(rootRun.id))?.status).toBe(
        'finished',
      );
      expect(await countRuns()).toBe(3);
    });

    describe('when a child ends', () => {
      const decision = { decision: 'approved' };
      /** A suspended child of `parentRun` waiting on an admin. */
      const createChildRun = async (parentRunId: string) => {
        const childWorkflow = await createWorkflowWithDefinition();
        const childRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([buildApprovalWait()]),
          workflowId: childWorkflow.id,
          workflowVersion: childWorkflow.currentVersion?.id ?? null,
          parentRun: parentRunId,
        });

        return { childWorkflow, childRun };
      };
      const approveChild = async (childRun: WorkflowRunFull) => {
        await agenticService.resumeWait({
          run: childRun,
          event: createEvent(),
          waitId: buildApprovalWait().waitId,
          resumeData: decision,
        });
        await jobs.onIdle();

        return await workflowRunService.findOne(childRun.id);
      };

      it('ends a child whose parent run is gone', async () => {
        const parentRun = await createSuspendedRun({ checkpoint: null });
        const { childRun } = await createChildRun(parentRun.id);
        const runner = finishedRunner({ child: 'done' });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(runner));
        const findOneAndPopulate =
          workflowRunService.findOneAndPopulate.bind(workflowRunService);
        jest
          .spyOn(workflowRunService, 'findOneAndPopulate')
          .mockImplementation((async (...args: [any, ...any[]]) =>
            args[0] === parentRun.id
              ? null
              : await findOneAndPopulate(...args)) as any);

        expect((await approveChild(childRun))?.status).toBe('finished');
        expect(runner.resume).toHaveBeenCalledTimes(1);
        expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
          'suspended',
        );
      });

      it('leaves a parent that is still running to catch the result up', async () => {
        const parentRun = await createParentRun();
        const { childRun } = await createChildRun(parentRun.id);
        const runner = finishedRunner({ child: 'done' });
        const fromDefinitionSpy = jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(runner));

        expect((await approveChild(childRun))?.status).toBe('finished');
        expect(fromDefinitionSpy).toHaveBeenCalledTimes(1);
        expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
          'running',
        );
      });

      it('leaves a parent that does not wait on the child', async () => {
        const parentRun = await createSuspendedRun({
          checkpoint: buildCheckpoint([buildWait()]),
        });
        const { childRun } = await createChildRun(parentRun.id);
        const runner = finishedRunner({ done: true });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(runner));

        expect((await approveChild(childRun))?.status).toBe('finished');
        expect(runner.resume).toHaveBeenCalledTimes(1);
        expect(await workflowRunService.findOne(parentRun.id)).toEqual(
          expect.objectContaining({
            status: 'suspended',
            suspendedAt: parentRun.suspendedAt,
          }),
        );
      });

      it('leaves a parent another caller claimed first to catch the result up', async () => {
        const parentRun = await createSuspendedRun({ checkpoint: null });
        const { childWorkflow, childRun } = await createChildRun(parentRun.id);
        await workflowRunService.updateOne(parentRun.id, {
          checkpoint: buildCheckpoint([
            buildChildWait('call_child', childWorkflow.id, childRun.id),
          ]),
        });
        const runner = finishedRunner({ done: true });
        jest
          .spyOn(AgenticWorkflow, 'fromDefinition')
          .mockReturnValue(buildWorkflowInstance(runner));
        const claimSuspended =
          workflowRunService.claimSuspended.bind(workflowRunService);
        const claimSpy = jest
          .spyOn(workflowRunService, 'claimSuspended')
          .mockImplementation(async (runId, suspendedAt) =>
            runId === parentRun.id
              ? null
              : await claimSuspended(runId, suspendedAt),
          );

        expect((await approveChild(childRun))?.status).toBe('finished');
        expect(claimSpy).toHaveBeenCalledWith(
          parentRun.id,
          parentRun.suspendedAt,
        );
        expect(runner.resume).toHaveBeenCalledTimes(1);
        expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
          'suspended',
        );
      });
    });

    it.each([
      [
        'its caller run is unknown',
        'parent',
        'Unable to load parent workflow run',
      ],
      ['the workflow is unknown', 'workflow', 'not found'],
      [
        'the workflow has no definition',
        'definition',
        'is missing a definition',
      ],
    ])('rejects a call when %s', async (_label, missing, message) => {
      const unknownId = '44444444-4444-4444-8444-444444444444';
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createParentRun();
      if (missing === 'definition') {
        jest
          .spyOn(workflowService, 'findOneAndPopulate')
          .mockResolvedValueOnce({ ...childWorkflow, definition: null } as any);
      }

      await expect(
        agenticService.callWorkflow({
          workflowId: missing === 'workflow' ? unknownId : childWorkflow.id,
          parentContext: {
            workflowRunId: missing === 'parent' ? unknownId : parentRun.id,
            event: createEvent({ text: 'call child' }),
          } as any,
        }),
      ).rejects.toThrow(message);
      expect(await countRuns()).toBe(1);
    });

    it('reports the error of a child whose failure cannot be written', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createParentRun();
      const runner = buildRunnerMock({
        startError: new Error('runner-crash'),
        state: { input: {}, output: {}, iterationStack: [] },
        snapshot: failedSnapshot,
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));
      jest
        .spyOn(workflowRunService, 'persistCrash')
        .mockRejectedValueOnce(new Error('database unavailable'));

      await expect(
        agenticService.callWorkflow({
          workflowId: childWorkflow.id,
          parentContext: {
            workflowRunId: parentRun.id,
            event: createEvent({ text: 'call child' }),
          } as any,
        }),
      ).rejects.toThrow('runner-crash');

      const [childRun] = await workflowRunService.find({
        where: { workflow: { id: childWorkflow.id } },
      });
      // Recovery fails it once its claim lapses.
      expect(childRun.status).toBe('running');
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

  describe('workflow deletion', () => {
    /** Parent run of `workflow` waiting on a suspended run of a new child workflow. */
    const createCallStack = async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({ checkpoint: null });
      const childRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      const childWait = buildChildWait(
        'call_child',
        childWorkflow.id,
        childRun.id,
      );
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([childWait]),
      });

      return { childWorkflow, parentRun, childRun, childWait };
    };

    it('fails the call of the parent once the called workflow is deleted', async () => {
      const { childWorkflow, parentRun, childRun, childWait } =
        await createCallStack();
      const callerRunIds =
        await workflowRunService.prepareWorkflowDeletion(childWorkflow);
      await workflowService.deleteOne(childWorkflow.id);
      expect(await workflowRunService.findOne(childRun.id)).toBeNull();
      const parentRunner = finishedRunner({ parent: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(parentRunner));

      await callStack.reconcile([callerRunIds[0]], createEvent());

      expect(parentRunner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'failed',
          workflow_id: childWorkflow.id,
          workflow_run_id: childRun.id,
          error: `Called workflow ${childWorkflow.id} was deleted`,
        },
      });
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'finished',
      );
    });

    it('leaves a parent waiting on a child run that still exists', async () => {
      const { parentRun } = await createCallStack();
      const fromDefinition = jest.spyOn(AgenticWorkflow, 'fromDefinition');

      await callStack.reconcile([parentRun.id], createEvent());

      expect(fromDefinition).not.toHaveBeenCalled();
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'suspended',
      );
    });

    it('fails a call whose wait does not name the called workflow', async () => {
      const deletedRunId = '33333333-3333-4333-8333-333333333333';
      const childWait = buildWait({
        waitId: 'call_child@index:1',
        step: { id: 'call_child', name: 'call_child', type: StepType.Task },
        reason: AWAITING_CHILD_WORKFLOW_REASON,
        data: { workflow_run_id: deletedRunId },
      });
      const parentRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([childWait]),
      });
      const parentRunner = finishedRunner({ parent: 'done' });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(parentRunner));

      await callStack.reconcile([parentRun.id], createEvent());

      expect(parentRunner.resume).toHaveBeenCalledWith({
        waitId: childWait.waitId,
        resumeData: {
          status: 'failed',
          workflow_id: '',
          workflow_run_id: deletedRunId,
          error: 'Called workflow undefined was deleted',
        },
      });
    });

    it.each([
      ['is not suspended', 'running'],
      ['no longer exists', 'missing'],
    ])('leaves a caller that %s', async (_label, state) => {
      const { parentRun } = await createCallStack();
      if (state === 'running') {
        await workflowRunService.updateOne(parentRun.id, {
          status: 'running',
        });
      }
      const fromDefinition = jest.spyOn(AgenticWorkflow, 'fromDefinition');

      await callStack.reconcile(
        [
          state === 'missing'
            ? '44444444-4444-4444-8444-444444444444'
            : parentRun.id,
        ],
        createEvent(),
      );

      expect(fromDefinition).not.toHaveBeenCalled();
    });
  });
  describe('claim leases', () => {
    const approval = {
      decision: 'approved',
      decided_by: { id: 'admin-1', name: 'Jane Doe' },
      decided_at: '2026-01-02T10:00:00.000Z',
    };
    /** Read the claim token of a run, which the run schemas strip. */
    const readClaimId = async (runId: string) =>
      (
        await dataSource
          .getRepository(WorkflowRunOrmEntity)
          .findOneByOrFail({ id: runId })
      ).claimId ?? null;
    /** Tell whether this process holds the claim the run is under. */
    const isHeld = async (runId: string) => {
      const claimId = await readClaimId(runId);

      return !!claimId && workflowRunService.holdsClaim(claimId);
    };
    /** Read the claim a run is under, and whether this process holds it. */
    const readHold = async (runId: string) => {
      const claimId = (await readClaimId(runId))!;

      return { claimId, held: workflowRunService.holdsClaim(claimId) };
    };
    const finished = (output: Record<string, unknown> = {}) => ({
      status: 'finished' as const,
      output,
      snapshot: finishedSnapshot,
    });
    /** Take a run over, as closing its thread does. */
    const takeOver = async (runId: string) =>
      await workflowRunService.repository.settle(
        runId,
        failedValues({ error: 'Thread was closed' }),
        null,
      );

    it('holds the claim on a new run until its first pass is over', async () => {
      const holds: { claimId: string; held: boolean }[] = [];
      const runner = finishedRunner({ done: true });
      runner.start.mockImplementation(async () => {
        const [run] = await workflowRunService.find({});
        holds.push(await readHold(run.id));

        return finished({ done: true });
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));
      const run = await agenticService.handleEvent(createEvent({ text: 'hi' }));

      expect(run).toEqual(expect.objectContaining({ status: 'finished' }));
      expect(holds).toEqual([{ claimId: expect.any(String), held: true }]);
      expect(workflowRunService.holdsClaim(holds[0].claimId)).toBe(false);
      expect(await readClaimId(run!.id)).toBeNull();
    });

    it('releases the claim on a resumed run whose runner throws', async () => {
      const run = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
      });
      const holds: { claimId: string; held: boolean }[] = [];
      const runner = finishedRunner({});
      runner.resume.mockImplementation(async () => {
        holds.push(await readHold(run.id));
        throw new Error('runner-crash');
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      await expect(
        agenticService.handleEvent(createEvent({ text: 'reply' })),
      ).resolves.toBeNull();

      expect(holds).toEqual([{ claimId: expect.any(String), held: true }]);
      expect(workflowRunService.holdsClaim(holds[0].claimId)).toBe(false);
      expect(await workflowRunService.findOne(run.id)).toEqual(
        expect.objectContaining({ status: 'failed', error: 'runner-crash' }),
      );
      expect(await readClaimId(run.id)).toBeNull();
    });

    it('fails a run that cannot start instead of leaving it idle', async () => {
      workflowContextFactoryMock.create.mockRejectedValueOnce(
        new Error('Unsupported triggerType: nope'),
      );
      const runner = finishedRunner({});
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));
      const createSpy = jest.spyOn(workflowRunService, 'createFromEvent');

      await expect(
        agenticService.handleEvent(createEvent({ text: 'hi' })),
      ).resolves.toBeNull();

      const { lease } = await createSpy.mock.results[0].value;
      const [run] = await workflowRunService.find({});
      expect(run).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Unsupported triggerType: nope',
        }),
      );
      expect(runner.start).not.toHaveBeenCalled();
      expect(workflowRunService.holdsClaim(lease.claimId)).toBe(false);
      expect(await readClaimId(run.id)).toBeNull();
    });

    it('keeps a run failed when its thread is closed during its first pass', async () => {
      const runner = finishedRunner({ done: true });
      runner.start.mockImplementation(async () => {
        const [run] = await workflowRunService.find({});
        await takeOver(run.id);

        return finished({ done: true });
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      await expect(
        agenticService.handleEvent(createEvent({ text: 'hi' })),
      ).resolves.toBeNull();

      const [run] = await workflowRunService.find({});
      expect(run).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Thread was closed',
          output: null,
        }),
      );
    });

    it('drops the outcome of a resume whose run was taken over, and leaves its parent alone', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
      });
      const childRun = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildApprovalWait()]),
        workflowId: childWorkflow.id,
        workflowVersion: childWorkflow.currentVersion?.id ?? null,
        parentRun: parentRun.id,
      });
      await workflowRunService.updateOne(parentRun.id, {
        checkpoint: buildCheckpoint([
          buildChildWait('call_child', childWorkflow.id, childRun.id),
        ]),
      });
      const runner = finishedRunner({ child: 'done' });
      runner.resume.mockImplementation(async () => {
        await takeOver(childRun.id);

        return finished({ child: 'done' });
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      const outcome = await agenticService.resumeWait({
        run: childRun,
        event: createEvent(),
        waitId: buildApprovalWait().waitId,
        resumeData: approval,
      });

      expect(outcome.status).toBe('accepted');
      await jobs.onIdle();
      expect(await workflowRunService.findOne(childRun.id)).toEqual(
        expect.objectContaining({ status: 'failed', output: { saved: true } }),
      );
      expect(runner.resume).toHaveBeenCalledTimes(1);
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'suspended',
      );
    });

    it('answers an admin resume once its run is claimed, holding the claim until the pass is over', async () => {
      const run = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildApprovalWait()]),
      });
      const runner = finishedRunner({ done: true });
      let endPass!: () => void;
      runner.resume.mockImplementation(
        () =>
          new Promise((resolve) => {
            endPass = () => resolve(finished({ done: true }));
          }),
      );
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      const outcome = await agenticService.resumeWait({
        run,
        event: createEvent(),
        waitId: buildApprovalWait().waitId,
        resumeData: approval,
      });

      expect(outcome).toEqual({
        status: 'accepted',
        run: expect.objectContaining({ id: run.id, status: 'running' }),
      });
      expect(await isHeld(run.id)).toBe(true);

      endPass();
      await jobs.onIdle();
      expect((await workflowRunService.findOne(run.id))?.status).toBe(
        'finished',
      );
      expect(await readClaimId(run.id)).toBeNull();
    });

    it('answers a dispatched event once its new run is created, holding the claim until the pass is over', async () => {
      const runner = finishedRunner({ done: true });
      let endPass!: () => void;
      const started = new Promise<void>((markStarted) => {
        runner.start.mockImplementation(
          () =>
            new Promise((resolve) => {
              endPass = () => resolve(finished({ done: true }));
              markStarted();
            }),
        );
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      const dispatched = await agenticService.dispatchEvent(
        createEvent({ text: 'hi' }),
      );

      expect(dispatched).toEqual(expect.objectContaining({ status: 'idle' }));
      const runId = dispatched!.id;
      expect(await isHeld(runId)).toBe(true);

      await started;
      expect((await workflowRunService.findOne(runId))?.status).toBe('running');
      endPass();
      await jobs.onIdle();
      expect((await workflowRunService.findOne(runId))?.status).toBe(
        'finished',
      );
      expect(await readClaimId(runId)).toBeNull();
    });

    it('answers a dispatched event once it claimed the suspended run it resumes', async () => {
      const run = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildWait()]),
      });
      const runner = finishedRunner({ done: true });
      let endPass!: () => void;
      runner.resume.mockImplementation(
        () =>
          new Promise((resolve) => {
            endPass = () => resolve(finished({ done: true }));
          }),
      );
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      const dispatched = await agenticService.dispatchEvent(
        createEvent({ text: 'reply' }),
      );

      expect(dispatched).toEqual(
        expect.objectContaining({ id: run.id, status: 'running' }),
      );
      expect(await isHeld(run.id)).toBe(true);

      endPass();
      await jobs.onIdle();
      expect((await workflowRunService.findOne(run.id))?.status).toBe(
        'finished',
      );
      expect(await readClaimId(run.id)).toBeNull();
    });

    it('leaves a resume whose outcome could not be written to recovery', async () => {
      const run = await createSuspendedRun({
        checkpoint: buildCheckpoint([buildApprovalWait()]),
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(finishedRunner({ done: true })));
      jest
        .spyOn(workflowRunService, 'persistResult')
        .mockRejectedValueOnce(new Error('database unavailable'));

      const outcome = await agenticService.resumeWait({
        run,
        event: createEvent(),
        waitId: buildApprovalWait().waitId,
        resumeData: approval,
      });

      expect(outcome.status).toBe('accepted');
      await jobs.onIdle();
      // Recovery puts it back on its wait once its claim lapses.
      expect((await workflowRunService.findOne(run.id))?.status).toBe(
        'running',
      );
      expect(await isHeld(run.id)).toBe(false);
    });

    it('rejects a call whose child run was taken over during its first pass', async () => {
      const childWorkflow = await createWorkflowWithDefinition();
      const parentRun = (await workflowRunService.findOneAndPopulate(
        (
          await workflowRunService.create({
            workflow: workflow.id,
            workflowVersion: workflowVersionId,
            triggeredBy: initiator.id,
            status: 'running',
            input: { parent: true },
          })
        ).id,
      ))!;
      const runner = finishedRunner({ child: 'done' });
      runner.start.mockImplementation(async () => {
        const [childRun] = await workflowRunService.find({
          where: { workflow: { id: childWorkflow.id } },
        });
        await takeOver(childRun.id);

        return finished({ child: 'done' });
      });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValue(buildWorkflowInstance(runner));

      await expect(
        agenticService.callWorkflow({
          workflowId: childWorkflow.id,
          input: {},
          parentContext: {
            workflowRunId: parentRun.id,
            event: createEvent({ text: 'call child' }),
          } as any,
        }),
      ).rejects.toThrow(WorkflowRunClaimLostError);
    });
  });
});

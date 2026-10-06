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
} from '@hexabot-ai/agentic';
import type { User, WorkflowRunFull, WorkflowFull } from '@hexabot-ai/types';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { ManualEventWrapper } from '@/workflow/lib/trigger-event-wrapper';
import { WorkflowRunRepository } from '@/workflow/repositories/workflow-run.repository';
import { WorkflowVersionRepository } from '@/workflow/repositories/workflow-version.repository';
import { WorkflowRepository } from '@/workflow/repositories/workflow.repository';
import {
  AWAITING_CHILD_WORKFLOW_REASON,
  WorkflowType,
  WorkflowVersionAction,
} from '@/workflow/types';

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
  let workflowService: WorkflowService;
  let workflowVersionService: WorkflowVersionService;
  let workflowRunService: WorkflowRunService;
  let eventEmitter: EventEmitter2;
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

    [
      agenticService,
      workflowService,
      workflowVersionService,
      workflowRunService,
      eventEmitter,
    ] = await testing.getMocks([
      AgenticService,
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
      );
      expect(pickWorkflowSpy).not.toHaveBeenCalled();
      expect(findOneAndPopulateSpy.mock.calls[0]?.[0]).toBe(workflow.id);
      expect(workflowInstance.buildAsyncRunner).toHaveBeenCalled();
    });

    it('scopes suspended run lookup by thread id when provided', async () => {
      const event = createEvent({ text: 'threaded resume' });
      const resumeRunSpy = jest
        .spyOn(agenticService as any, 'resumeRun')
        .mockResolvedValue({
          status: 'resumed',
          run: { id: 'run-threaded' } as WorkflowRunFull,
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
      expect(resumeRunSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          run: expect.objectContaining({ id: 'run-threaded' }),
          resumeData: event.buildInput(),
        }),
      );
      resumeRunSpy.mockRestore();
      findSuspendedSpy.mockRestore();
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
      const childWait = buildChildWait(
        'call_child',
        workflow.id,
        '33333333-3333-4333-8333-333333333333',
      );
      const baseRun = await createSuspendedRun({
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
      await workflowRunService.markSuspended(parentRun.id, {
        checkpoint: buildCheckpoint([replyWait, childWait]),
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

    it('unwinds an unresumable child into its parent and starts one new run', async () => {
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
      const parentResumeRunner = buildRunnerMock({
        resumeResult: {
          status: 'failed',
          error: new Error('Cannot resume child'),
          snapshot: failedSnapshot,
        },
        state: { input: {}, output: {}, iterationStack: [] },
        snapshot: failedSnapshot,
      });
      const freshRunner = finishedRunner({ fresh: true });
      jest
        .spyOn(AgenticWorkflow, 'fromDefinition')
        .mockReturnValueOnce(buildWorkflowInstance(finishedRunner({})))
        .mockReturnValueOnce(buildWorkflowInstance(parentResumeRunner))
        .mockReturnValueOnce(buildWorkflowInstance(freshRunner));

      await agenticService.handleEvent(createEvent({ text: 'hello again' }));

      expect((await workflowRunService.findOne(childRun.id))?.status).toBe(
        'failed',
      );
      expect((await workflowRunService.findOne(parentRun.id))?.status).toBe(
        'failed',
      );
      expect(parentResumeRunner.resume).toHaveBeenCalledWith({
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

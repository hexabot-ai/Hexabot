/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Workflow } from '@hexabot-ai/types';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TestingModule } from '@nestjs/testing';
import { FindOneOptions } from 'typeorm';

import { UserService } from '@/user/services/user.service';
import { EHook } from '@/utils/generics/base-orm.repository';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import { installScheduledWorkflowFixturesTypeOrm } from '@/utils/test/fixtures/workflow';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import {
  closeTypeOrmConnections,
  getLastTypeOrmDataSource,
} from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import type { InferActionsDto } from '@/utils/types/dto.types';
import {
  DeleteEntityEvent,
  InsertEntityEvent,
  UpdateEntityEvent,
} from '@/utils/types/entity-event.types';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import type { WebsocketGateway } from '@/websocket/websocket.gateway';
import { WorkflowType } from '@/workflow/types';

import { WorkflowOrmEntity } from '../entities/workflow.entity';
import { ScheduledEventWrapper } from '../lib/trigger-event-wrapper';

import { AgenticService } from './agentic.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';
import { WorkflowService } from './workflow.service';

describe('WorkflowSchedulerService (TypeORM)', () => {
  let module: TestingModule;
  let schedulerService: WorkflowSchedulerService;
  let workflowService: WorkflowService;
  let schedulerRegistry: SchedulerRegistry;
  let workflow: Workflow;
  let agenticService: AgenticService;
  let userService: UserService;
  let eventEmitter: EventEmitter2;
  let handleEventSpy: jest.SpyInstance;
  const agenticServiceMock = {
    handleEvent: jest.fn().mockResolvedValue(null),
  } as jest.Mocked<Pick<AgenticService, 'handleEvent'>>;
  const workflowRunServiceMock = {
    findOne: jest.fn(),
  } as jest.Mocked<Pick<WorkflowRunService, 'findOne'>>;
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  } as jest.Mocked<
    Pick<WebsocketGateway, 'joinSockets' | 'broadcastWorkflowEvent'>
  >;
  const flushCronCallbacks = async () =>
    await new Promise<void>((resolve) => setImmediate(resolve));
  const clearCronJobs = () => {
    if (!schedulerRegistry) {
      return;
    }

    schedulerRegistry.getCronJobs().forEach((job, name) => {
      job.stop();
      schedulerRegistry.deleteCronJob(name);
    });
  };
  const reloadScheduledWorkflow = async () => {
    await workflowService.deleteMany();
    await installScheduledWorkflowFixturesTypeOrm(getLastTypeOrmDataSource());
    const [scheduled] = await workflowService.find({
      where: { type: WorkflowType.scheduled },
      order: { createdAt: 'DESC' },
    });

    if (!scheduled) {
      throw new Error('Expected scheduled workflow fixtures');
    }

    workflow = scheduled as Workflow;
  };
  const getJobName = () => `workflow:${workflow.id}`;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WorkflowSchedulerService,
        {
          provide: AgenticService,
          useValue: agenticServiceMock,
        },
        {
          provide: WorkflowRunService,
          useValue: workflowRunServiceMock,
        },
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: websocketGatewayMock,
        },
        I18nServiceProvider,
      ],
      typeorm: {
        fixtures: [installScheduledWorkflowFixturesTypeOrm],
      },
    });

    module = testing.module;
    await module.init();
    [
      agenticService,
      schedulerService,
      workflowService,
      schedulerRegistry,
      userService,
      eventEmitter,
    ] = await testing.getMocks([
      AgenticService,
      WorkflowSchedulerService,
      WorkflowService,
      SchedulerRegistry,
      UserService,
      EventEmitter2,
    ]);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    clearCronJobs();
    handleEventSpy = jest
      .spyOn(agenticService, 'handleEvent')
      .mockResolvedValue(null);
    await reloadScheduledWorkflow();
    clearCronJobs();
  });

  afterAll(async () => {
    clearCronJobs();
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  it('registers cron jobs for scheduled workflows and triggers the agent handler', async () => {
    await schedulerService.onModuleInit();
    const job = schedulerRegistry.getCronJob(getJobName());

    expect(job.isActive).toBe(true);

    job.fireOnTick();
    await flushCronCallbacks();

    expect(handleEventSpy).toHaveBeenCalledTimes(1);
    const [eventArg] = handleEventSpy.mock.calls[0];
    expect(eventArg).toBeInstanceOf(ScheduledEventWrapper);
    expect(eventArg.getContextData()).toEqual(
      expect.objectContaining({
        schedule: workflow.schedule,
        triggered_at: expect.any(Date),
      }),
    );
    expect(eventArg.buildInput()).toEqual(
      expect.objectContaining({
        schedule: workflow.schedule,
        triggered_at: expect.any(String),
      }),
    );
    expect(eventArg.getInitiator()).toEqual(
      expect.objectContaining({ id: workflow.createdBy }),
    );
    expect(eventArg.getWorkflowId()).toBe(workflow.id);
  });

  it('skips registration when there are no scheduled workflows', async () => {
    await workflowService.deleteMany();

    await schedulerService.onModuleInit();

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('registers a cron job when a workflow is created', async () => {
    await workflowService.deleteMany();
    clearCronJobs();

    const created = await workflowService.create({
      name: `scheduled-workflow-${Date.now()}`,
      description: 'Created by workflow scheduler test',
      type: WorkflowType.scheduled,
      schedule: workflow.schedule ?? '*/10 * * * * *',
      createdBy: workflow.createdBy ?? userFixtureIds.admin,
    });

    expect(
      schedulerRegistry.getCronJob(`workflow:${created.id}`),
    ).toBeDefined();
  });

  it('ignores create events without an identifier', async () => {
    await eventEmitter.emitAsync('hook:workflow:postCreate', {
      action: EHook.postCreate,
      payload: {} as InferActionsDto<WorkflowOrmEntity>['create'],
      entity: {} as WorkflowOrmEntity,
    } as InsertEntityEvent<WorkflowOrmEntity>);

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('ignores update events without an identifier', async () => {
    await eventEmitter.emitAsync('hook:workflow:postUpdate', {
      action: EHook.postUpdate,
      payload: {} as InferActionsDto<WorkflowOrmEntity>['update'],
      entity: {} as WorkflowOrmEntity,
    } as UpdateEntityEvent<WorkflowOrmEntity>);

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('replaces an existing cron job when re-registering workflows', async () => {
    await schedulerService.onModuleInit();
    const existingJob = schedulerRegistry.getCronJob(getJobName());
    const stopSpy = jest.spyOn(schedulerRegistry, 'deleteCronJob');

    await schedulerService.onModuleInit();

    const replacementJob = schedulerRegistry.getCronJob(getJobName());

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(replacementJob).not.toBe(existingJob);
  });

  it('rejects workflow type changes and keeps scheduled cron jobs', async () => {
    await schedulerService.onModuleInit();
    expect(schedulerRegistry.getCronJobs().size).toBe(1);

    await expect(
      workflowService.updateOne(workflow.id, {
        type: WorkflowType.conversational,
      } as any),
    ).rejects.toThrow(
      new BadRequestException('Workflow type cannot be changed once created'),
    );

    expect(schedulerRegistry.getCronJobs().size).toBe(1);
  });

  it('unregisters cron jobs when workflows are deleted', async () => {
    await schedulerService.onModuleInit();

    await workflowService.deleteOne(workflow.id);

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('ignores delete events without an identifier', async () => {
    await eventEmitter.emitAsync('hook:workflow:postDelete', {
      action: EHook.postDelete,
      payload: {} as string | FindOneOptions<WorkflowOrmEntity>,
      entity: {} as WorkflowOrmEntity,
    } as DeleteEntityEvent<WorkflowOrmEntity>);

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('skips workflows that are missing a schedule', async () => {
    await schedulerService.onModuleInit();
    expect(schedulerRegistry.getCronJobs().size).toBe(1);

    await workflowService.updateOne(workflow.id, { schedule: null });

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('skips workflows when the initiator cannot be resolved', async () => {
    await schedulerService.onModuleInit();
    expect(schedulerRegistry.getCronJobs().size).toBe(1);

    const findOneSpy = jest
      .spyOn(userService, 'findOne')
      .mockResolvedValue(null);

    await schedulerService.onModuleInit();

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
    expect(findOneSpy).toHaveBeenCalled();

    findOneSpy.mockRestore();
  });

  it('skips workflows that lack an initiator', async () => {
    await schedulerService.onModuleInit();
    expect(schedulerRegistry.getCronJobs().size).toBe(1);

    await workflowService.updateOne(workflow.id, {
      createdBy: null as unknown as string,
    });

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('skips registration when the workflow cannot be found', async () => {
    await workflowService.deleteOne(workflow.id);

    await (schedulerService as any).registerScheduledWorkflow(workflow.id);

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
  });

  it('handles cron registration errors gracefully', async () => {
    const errorSpy = jest
      .spyOn((schedulerService as any).logger, 'error')
      .mockImplementation(() => undefined);
    const addCronJobSpy = jest
      .spyOn(schedulerRegistry, 'addCronJob')
      .mockImplementation(() => {
        throw new Error('cron failure');
      });

    await (schedulerService as any).registerScheduledWorkflow(workflow.id);

    expect(schedulerRegistry.getCronJobs().size).toBe(0);
    expect(errorSpy).toHaveBeenCalled();

    addCronJobSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

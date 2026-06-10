/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { Workflow as WorkflowHelper } from '@hexabot-ai/agentic';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { LoggerService } from '@/logger/logger.service';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import {
  installMessagingWorkflowFixturesTypeOrm,
  installScheduledWorkflowFixturesTypeOrm,
} from '@/utils/test/fixtures/workflow';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { WorkflowVersionService } from '../services/workflow-version.service';
import { WorkflowService } from '../services/workflow.service';
import { DirectionType, WorkflowType, WorkflowVersionAction } from '../types';

import { WorkflowVersionController } from './workflow-version.controller';

describe('WorkflowVersionController (TypeORM)', () => {
  let module: TestingModule;
  let controller: WorkflowVersionController;
  let workflowService: WorkflowService;
  let workflowVersionService: WorkflowVersionService;
  let logger: LoggerService;
  const createdWorkflowIds = new Set<string>();
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  };
  let counter = 0;

  const buildWorkflowPayload = () => {
    return {
      name: `workflow_${++counter}`,
      description: 'Workflow version controller test definition',
      type: WorkflowType.conversational,
      schedule: null,
      definitionYml: WorkflowHelper.stringifyDefinition({
        defs: {
          send_greeting: {
            kind: 'task',
            action: 'send_text_message',
            inputs: { text: '="Hi"' },
          },
        },
        flow: [{ do: 'send_greeting' }],
        outputs: { result: '=1' },
      }),
      createdBy: userFixtureIds.admin,
      direction: DirectionType.HORIZONTAL,
      x: 0,
      y: 0,
      zoom: 1,
      builtin: false,
    };
  };

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [WorkflowVersionController],
      providers: [
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: websocketGatewayMock,
        },
      ],
      typeorm: {
        fixtures: [
          installMessagingWorkflowFixturesTypeOrm,
          installScheduledWorkflowFixturesTypeOrm,
        ],
      },
    });
    module = testingModule;
    [controller, workflowService, workflowVersionService] = await getMocks([
      WorkflowVersionController,
      WorkflowService,
      WorkflowVersionService,
    ]);
    logger = controller.logger;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const ids = Array.from(createdWorkflowIds);

    for (const id of ids) {
      await workflowService.deleteOne(id);
      createdWorkflowIds.delete(id);
    }
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  describe('findMany', () => {
    it('returns version history for a workflow', async () => {
      const payload = buildWorkflowPayload();
      const created = await workflowService.create({
        ...payload,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);
      const createdBy = created.createdBy ?? userFixtureIds.admin;

      await workflowVersionService.commit({
        action: WorkflowVersionAction.update,
        workflow: created.id,
        definitionYml: WorkflowHelper.stringifyDefinition({
          defs: {
            send_greeting: {
              kind: 'task',
              action: 'send_text_message',
              inputs: { text: '="Hello world"' },
            },
          },
          flow: [{ do: 'send_greeting' }],
          outputs: { result: '=2' },
        }),
        createdBy,
      });

      const versions = await controller.findWorkflowVersions(created.id, {
        order: { createdAt: 'DESC' },
      });

      expect(versions).toHaveLength(2);
      expect(versions[0]?.version).toBeGreaterThan(versions[1]?.version ?? 0);
      expect(versions[0]?.action).toBe(WorkflowVersionAction.update);
      expect(versions[1]?.action).toBe(WorkflowVersionAction.create);
    });

    it('throws NotFoundException when workflow is missing', async () => {
      const id = randomUUID();
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(controller.findWorkflowVersions(id)).rejects.toThrow(
        new NotFoundException(`Workflow with ID ${id} not found`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to find Workflow by id ${id}`,
      );
    });
  });

  describe('findOne', () => {
    it('returns a workflow version when it exists', async () => {
      const payload = buildWorkflowPayload();
      const created = await workflowService.create({
        ...payload,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);

      const latest = (await workflowVersionService.findOne({
        where: { workflow: { id: created.id } },
      }))!;
      expect(latest).toBeDefined();

      const result = (await controller.findWorkflowVersion(
        created.id,
        latest.id,
      ))!;

      expect(result.id).toBe(latest.id);
      expect(result.version).toBe(latest.version);
      expect(result.workflow).toBe(created.id);
    });

    it('throws NotFoundException when version is missing', async () => {
      const payload = buildWorkflowPayload();
      const created = await workflowService.create({
        ...payload,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);
      const versionId = randomUUID();

      await expect(
        controller.findWorkflowVersion(created.id, versionId),
      ).rejects.toThrow(
        new NotFoundException(`WorkflowVersion with ID ${versionId} not found`),
      );
    });
  });

  describe('updateOne', () => {
    it('updates workflow version message when version exists', async () => {
      const payload = buildWorkflowPayload();
      const created = await workflowService.create({
        ...payload,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);
      const latest = (await workflowVersionService.findOne({
        where: { workflow: { id: created.id } },
      }))!;
      const message = 'Updated onboarding prompt tone';
      const updated = await controller.updateOne(created.id, latest.id, {
        message,
      });

      expect(updated.id).toBe(latest.id);
      expect(updated.message).toBe(message);
    });

    it('throws NotFoundException when workflow is missing', async () => {
      const id = randomUUID();
      const versionId = randomUUID();
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        controller.updateOne(id, versionId, { message: 'New note' }),
      ).rejects.toThrow(
        new NotFoundException(`Workflow with ID ${id} not found`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to find Workflow by id ${id}`,
      );
    });

    it('throws NotFoundException when version is missing', async () => {
      const payload = buildWorkflowPayload();
      const created = await workflowService.create({
        ...payload,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);
      const versionId = randomUUID();

      await expect(
        controller.updateOne(created.id, versionId, { message: 'New note' }),
      ).rejects.toThrow(
        new NotFoundException(
          `Workflow version with ID ${versionId} not found`,
        ),
      );
    });
  });
});

describe('WorkflowVersionController (HTTP pipes)', () => {
  let app: INestApplication;
  let workflowService: jest.Mocked<Pick<WorkflowService, 'findOne'>>;
  let workflowVersionService: jest.Mocked<
    Pick<
      WorkflowVersionService,
      'count' | 'findOne' | 'findOneAndPopulate' | 'find' | 'updateOne'
    >
  >;

  beforeAll(async () => {
    workflowService = {
      findOne: jest.fn(),
    };
    workflowVersionService = {
      count: jest.fn(),
      findOne: jest.fn(),
      findOneAndPopulate: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
    };

    const { module } = await buildTestingMocks({
      controllers: [WorkflowVersionController],
      providers: [
        { provide: WorkflowService, useValue: workflowService },
        { provide: WorkflowVersionService, useValue: workflowVersionService },
      ],
    });

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects malformed workflow id before controller logic', async () => {
    const versionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    await request(app.getHttpServer())
      .get(`/workflow/not-a-uuid/versions/${versionId}`)
      .expect(404);

    expect(workflowService.findOne).not.toHaveBeenCalled();
    expect(workflowVersionService.findOne).not.toHaveBeenCalled();
    expect(workflowVersionService.findOneAndPopulate).not.toHaveBeenCalled();
  });

  it('rejects malformed version id before controller logic', async () => {
    const workflowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    await request(app.getHttpServer())
      .get(`/workflow/${workflowId}/versions/not-a-uuid`)
      .expect(404);

    expect(workflowService.findOne).not.toHaveBeenCalled();
    expect(workflowVersionService.findOne).not.toHaveBeenCalled();
    expect(workflowVersionService.findOneAndPopulate).not.toHaveBeenCalled();
  });
});

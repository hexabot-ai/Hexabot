/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_TIMEOUT_MS,
  validateWorkflow,
} from '@hexabot-ai/agentic';
import { TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import {
  closeTypeOrmConnections,
  getLastTypeOrmDataSource,
} from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { WorkflowVersionOrmEntity } from '../entities/workflow-version.entity';
import { WorkflowOrmEntity } from '../entities/workflow.entity';
import { WorkflowType, WorkflowVersionAction } from '../types';

import { WorkflowVersionService } from './workflow-version.service';

describe('WorkflowVersionService (TypeORM)', () => {
  let module: TestingModule;
  let workflowVersionService: WorkflowVersionService;
  let workflowRepository: Repository<WorkflowOrmEntity>;
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  };
  const createWorkflow = async (
    overrides: Partial<WorkflowOrmEntity> = {},
  ): Promise<WorkflowOrmEntity> => {
    const workflow = workflowRepository.create({
      name: `workflow_${randomUUID()}`,
      description: 'Workflow for version service tests.',
      type: WorkflowType.conversational,
      schedule: null,
      createdBy: { id: userFixtureIds.admin },
      ...overrides,
    });

    return await workflowRepository.save(workflow);
  };
  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WorkflowVersionService,
        { provide: WEBSOCKET_GATEWAY, useValue: websocketGatewayMock },
      ],
      typeorm: {
        fixtures: [installUserFixturesTypeOrm],
      },
    });

    module = testing.module;
    [workflowVersionService] = await testing.getMocks([WorkflowVersionService]);
    const dataSource = getLastTypeOrmDataSource();
    workflowRepository = dataSource.getRepository(WorkflowOrmEntity);
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

  describe('createSnapshot', () => {
    it('creates a blank version with global defaults when workflow is created', async () => {
      const workflow = await createWorkflow();
      const blank = await workflowVersionService.findOne({
        where: { workflow: { id: workflow.id }, version: 0 },
      });

      expect(blank).toBeDefined();
      expect(blank?.version).toBe(0);
      expect(blank?.action).toBe(WorkflowVersionAction.create);

      const parsed = validateWorkflow(blank!.definitionYml);

      expect(parsed.success).toBe(true);

      if (!parsed.success) {
        return;
      }

      expect(parsed.data).toEqual({
        defaults: {
          settings: {
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retries: { ...DEFAULT_RETRY_SETTINGS },
          },
        },
        defs: {},
        flow: [],
        outputs: {},
      });
    });

    it('creates the blank version when workflow is created inside a transaction', async () => {
      const dataSource = getLastTypeOrmDataSource();
      await dataSource.transaction(async (manager) => {
        const workflowRepository = manager.getRepository(WorkflowOrmEntity);
        const workflow = await workflowRepository.save(
          workflowRepository.create({
            name: `workflow_${randomUUID()}`,
            description: 'Workflow transactional insert test.',
            type: WorkflowType.conversational,
            schedule: null,
            createdBy: { id: userFixtureIds.admin },
          }),
        );
        const versionRepository = manager.getRepository(
          WorkflowVersionOrmEntity,
        );
        const blank = await versionRepository.findOne({
          where: { workflow: { id: workflow.id }, version: 0 },
        });

        expect(blank).toBeDefined();
        expect(blank?.version).toBe(0);
        expect(blank?.action).toBe(WorkflowVersionAction.create);
      });
    });

    it('creates the first version when none exist', async () => {
      const workflow = await createWorkflow();
      const definitionYml = 'version: 1';
      const created = await workflowVersionService.createSnapshot({
        workflow: workflow.id,
        definitionYml,
        message: 'Initial version',
        action: WorkflowVersionAction.create,
        createdBy: userFixtureIds.admin,
      });

      expect(created.version).toBe(1);
      expect(created.checksum).toBe(
        WorkflowVersionOrmEntity.computeChecksum(definitionYml),
      );
      expect(created.workflow).toBe(workflow.id);
      expect(created.message).toBe('Initial version');
      expect(created.createdBy).toBe(userFixtureIds.admin);
      expect(created.parentVersion ?? null).toBeNull();
    });

    it('increments version and maps parent/creator fields', async () => {
      const workflow = await createWorkflow();
      const initialDefinition = 'version: 1';
      const initial = await workflowVersionService.createSnapshot({
        workflow: workflow.id,
        definitionYml: initialDefinition,
        action: WorkflowVersionAction.create,
        createdBy: userFixtureIds.admin,
      });
      const updatedDefinition = 'version: 2';
      const created = await workflowVersionService.createSnapshot({
        workflow: workflow.id,
        definitionYml: updatedDefinition,
        message: 'Update workflow',
        action: WorkflowVersionAction.update,
        parentVersion: initial.id,
        createdBy: userFixtureIds.admin,
      });

      expect(created.version).toBe(initial.version + 1);
      expect(created.checksum).toBe(
        WorkflowVersionOrmEntity.computeChecksum(updatedDefinition),
      );
      expect(created.parentVersion).toBe(initial.id);
      expect(created.createdBy).toBe(userFixtureIds.admin);
      expect(created.message).toBe('Update workflow');
    });
  });

  describe('published versions', () => {
    it('treats new workflows as draft when no published version exists', async () => {
      const workflow = await createWorkflow();
      const stored = await workflowRepository.findOne({
        where: { id: workflow.id },
        relations: ['publishedVersion'],
      });

      expect(stored?.publishedVersion ?? null).toBeNull();
    });

    it('does not update published version when creating snapshots', async () => {
      const workflow = await createWorkflow();
      await workflowVersionService.createSnapshot({
        workflow: workflow.id,
        definitionYml: 'version: 1',
        action: WorkflowVersionAction.update,
        createdBy: userFixtureIds.admin,
      });
      const stored = await workflowRepository.findOne({
        where: { id: workflow.id },
        relations: ['publishedVersion'],
      });

      expect(stored?.publishedVersion ?? null).toBeNull();
    });
  });
});

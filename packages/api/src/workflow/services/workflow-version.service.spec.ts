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
import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { ActionService } from '@/actions/actions.service';
import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import { getLastTypeOrmDataSource } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';

import { WorkflowVersionOrmEntity } from '../entities/workflow-version.entity';
import { WorkflowOrmEntity } from '../entities/workflow.entity';
import { WorkflowType, WorkflowVersionAction } from '../types';

import { WorkflowVersionService } from './workflow-version.service';

describe('WorkflowVersionService (TypeORM)', () => {
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

    [workflowVersionService] = await testing.getMocks([WorkflowVersionService]);
    const dataSource = getLastTypeOrmDataSource();
    workflowRepository = dataSource.getRepository(WorkflowOrmEntity);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
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

    describe('actions the workflow type cannot run', () => {
      const definitionYml = [
        'defs:',
        '  ask:',
        '    kind: task',
        '    action: await_reply',
        'flow:',
        '  - do: ask',
        'outputs: {}',
      ].join('\n');
      const countVersions = async (workflowId: string) =>
        await workflowVersionService.count({
          where: { workflow: { id: workflowId } },
        });

      beforeEach(() => {
        jest.spyOn(ActionService.prototype, 'getRegistry').mockReturnValue({
          await_reply: { workflowTypes: [WorkflowType.conversational] },
        } as any);
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('refuses the definition', async () => {
        const workflow = await createWorkflow({ type: WorkflowType.manual });

        await expect(
          workflowVersionService.createSnapshot({
            workflow: workflow.id,
            definitionYml,
            action: WorkflowVersionAction.update,
            createdBy: userFixtureIds.admin,
          }),
        ).rejects.toThrow(
          new BadRequestException(
            'Actions not available in manual workflows: ask (await_reply)',
          ),
        );
        // Only the blank version created with the workflow.
        expect(await countVersions(workflow.id)).toBe(1);
      });

      it('refuses the definition inside a transaction', async () => {
        const workflow = await createWorkflow({ type: WorkflowType.manual });
        const dataSource = getLastTypeOrmDataSource();

        await expect(
          dataSource.transaction((manager) =>
            workflowVersionService.createSnapshotWithManager(manager, {
              workflow: workflow.id,
              definitionYml,
              action: WorkflowVersionAction.create,
              createdBy: userFixtureIds.admin,
            }),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(await countVersions(workflow.id)).toBe(1);
      });

      it('accepts it in a workflow of a type the action runs in', async () => {
        const workflow = await createWorkflow();

        await expect(
          workflowVersionService.createSnapshot({
            workflow: workflow.id,
            definitionYml,
            action: WorkflowVersionAction.update,
            createdBy: userFixtureIds.admin,
          }),
        ).resolves.toEqual(expect.objectContaining({ version: 1 }));
      });
    });

    describe('inputs the workflow type does not take', () => {
      const definitionYml = [
        'inputs:',
        '  schema:',
        '    type: object',
        '    properties:',
        '      question:',
        '        type: string',
        'defs: {}',
        'flow: []',
        'outputs: {}',
      ].join('\n');
      const countVersions = async (workflowId: string) =>
        await workflowVersionService.count({
          where: { workflow: { id: workflowId } },
        });

      it.each([WorkflowType.conversational, WorkflowType.scheduled])(
        'refuses a %s definition that declares inputs',
        async (type) => {
          const workflow = await createWorkflow({ type });

          await expect(
            workflowVersionService.createSnapshot({
              workflow: workflow.id,
              definitionYml,
              action: WorkflowVersionAction.update,
              createdBy: userFixtureIds.admin,
            }),
          ).rejects.toThrow(
            new BadRequestException(
              `A ${type} workflow cannot declare "inputs": its input is ` +
                'fixed by its trigger. Remove "inputs" from the definition.',
            ),
          );
          expect(await countVersions(workflow.id)).toBe(1);
        },
      );

      it('refuses the definition inside a transaction', async () => {
        const workflow = await createWorkflow();
        const dataSource = getLastTypeOrmDataSource();

        await expect(
          dataSource.transaction((manager) =>
            workflowVersionService.createSnapshotWithManager(manager, {
              workflow: workflow.id,
              definitionYml,
              action: WorkflowVersionAction.create,
              createdBy: userFixtureIds.admin,
            }),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(await countVersions(workflow.id)).toBe(1);
      });

      it('accepts it in a manual workflow', async () => {
        const workflow = await createWorkflow({ type: WorkflowType.manual });

        await expect(
          workflowVersionService.createSnapshot({
            workflow: workflow.id,
            definitionYml,
            action: WorkflowVersionAction.update,
            createdBy: userFixtureIds.admin,
          }),
        ).resolves.toEqual(expect.objectContaining({ version: 1 }));
      });
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

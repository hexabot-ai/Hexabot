/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { NotFoundException } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';
import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import {
  installWorkflowRunFixturesTypeOrm,
  workflowRunFixtureIds,
  workflowRunOrmFixtures,
} from '@/utils/test/fixtures/workflow-run';
import { buildTestingMocks } from '@/utils/test/utils';

import { WorkflowRunService } from '../services/workflow-run.service';

import { WorkflowRunController } from './workflow-run.controller';

describe('WorkflowRunController (TypeORM)', () => {
  let controller: WorkflowRunController;
  let service: WorkflowRunService;
  let logger: LoggerService;

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [WorkflowRunController],
      typeorm: {
        fixtures: installWorkflowRunFixturesTypeOrm,
      },
    });
    [controller, service] = await getMocks([
      WorkflowRunController,
      WorkflowRunService,
    ]);
    logger = controller.logger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('findMany', () => {
    it('returns workflow runs matching the provided filters', async () => {
      const options = { where: { status: 'running' as const } };
      const findSpy = jest.spyOn(service, 'find');
      const result = await controller.findWorkflowRuns(options, []);

      expect(findSpy).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload(
        [workflowRunOrmFixtures[0]],
        [...IGNORED_TEST_FIELDS],
      );
    });
  });

  describe('findOne', () => {
    it('returns a workflow run when it exists', async () => {
      const id = workflowRunFixtureIds.running;
      const findSpy = jest.spyOn(service, 'findOne');
      const result = await controller.findWorkflowRun(id, []);

      expect(findSpy).toHaveBeenCalledWith(id);
      expect(result).toEqualPayload(workflowRunOrmFixtures[0], [
        ...IGNORED_TEST_FIELDS,
      ]);
    });

    it('throws NotFoundException when workflow run is missing', async () => {
      const id = randomUUID();
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(controller.findWorkflowRun(id, [])).rejects.toThrow(
        new NotFoundException(`WorkflowRun with ID ${id} not found`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to find WorkflowRun by id ${id}`,
      );
    });
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { NotFoundException, UnauthorizedException } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';
import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import {
  installWorkflowRunFixturesTypeOrm,
  workflowRunFixtureIds,
  workflowRunOrmFixtures,
} from '@/utils/test/fixtures/workflow-run';
import { buildTestingMocks } from '@/utils/test/utils';

import { WorkflowRunOperatorService } from '../services/workflow-run-operator.service';
import { WorkflowRunService } from '../services/workflow-run.service';

import { WorkflowRunController } from './workflow-run.controller';

describe('WorkflowRunController (TypeORM)', () => {
  let controller: WorkflowRunController;
  let service: WorkflowRunService;
  let logger: LoggerService;
  const operatorServiceMock = {
    decide: jest.fn(),
    resume: jest.fn(),
    cancel: jest.fn(),
  };
  const sessionRequest = (user?: Record<string, unknown>) =>
    ({ session: { passport: user ? { user } : undefined } }) as any;

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      // Only the run service is real: auto-injecting from the controller
      // would build the whole agentic graph behind the operator service.
      autoInjectFrom: ['providers'],
      controllers: [WorkflowRunController],
      providers: [
        WorkflowRunService,
        {
          provide: WorkflowRunOperatorService,
          useValue: operatorServiceMock,
        },
      ],
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

  describe('pending', () => {
    it('lists only the runs waiting on an admin', async () => {
      const findSpy = jest.spyOn(service, 'find');
      const result = await controller.findPendingWorkflowRuns(
        { where: { thread: { id: 'thread-1' } }, take: 10 },
        [],
      );

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          thread: { id: 'thread-1' },
          status: 'suspended',
          awaitingOperator: true,
        },
        take: 10,
      });
      expect(result).toEqual([]);
    });

    it('counts the runs waiting on an admin', async () => {
      const countSpy = jest.spyOn(service, 'count');

      expect(await controller.filterPendingCount({})).toEqual({ count: 0 });
      expect(countSpy).toHaveBeenCalledWith({
        where: { status: 'suspended', awaitingOperator: true },
      });
    });
  });

  describe('operator operations', () => {
    const id = workflowRunFixtureIds.running;
    const user = { id: 'user-1', first_name: 'Jane', last_name: 'Doe' };
    const actor = { id: 'user-1', name: 'Jane Doe' };
    const run = { id };

    it('approves and rejects on behalf of the session user', async () => {
      operatorServiceMock.decide.mockResolvedValue(run);
      const body = { waitId: 'wait-1', comment: 'ok' };

      expect(await controller.approve(id, body, sessionRequest(user))).toBe(
        run,
      );
      expect(operatorServiceMock.decide).toHaveBeenCalledWith(
        id,
        'approved',
        body,
        actor,
      );

      await controller.reject(id, {}, sessionRequest(user));
      expect(operatorServiceMock.decide).toHaveBeenLastCalledWith(
        id,
        'rejected',
        {},
        actor,
      );
    });

    it('resumes and cancels on behalf of the session user', async () => {
      operatorServiceMock.resume.mockResolvedValue(run);
      operatorServiceMock.cancel.mockResolvedValue(run);

      expect(
        await controller.resume(
          id,
          { data: { reference: 'REF-1' } },
          sessionRequest({ id: 'user-2' }),
        ),
      ).toBe(run);
      expect(operatorServiceMock.resume).toHaveBeenCalledWith(
        id,
        { data: { reference: 'REF-1' } },
        { id: 'user-2', name: 'user-2' },
      );

      expect(
        await controller.cancel(id, { reason: 'stale' }, sessionRequest(user)),
      ).toBe(run);
      expect(operatorServiceMock.cancel).toHaveBeenCalledWith(
        id,
        { reason: 'stale' },
        actor,
      );
    });

    it('refuses requests without a session user', async () => {
      await expect(
        controller.approve(id, {}, sessionRequest()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        controller.cancel(id, {}, sessionRequest()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(operatorServiceMock.decide).not.toHaveBeenCalled();
      expect(operatorServiceMock.cancel).not.toHaveBeenCalled();
    });
  });
});

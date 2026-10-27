/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  WaitInfo,
  WorkflowResumeRejectedError,
} from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';
import { HttpException, NotFoundException } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';
import { DeleteEntityEvent } from '@/utils/types/entity-event.types';

import { WorkflowOrmEntity } from '../entities/workflow.entity';
import { ManualEventWrapper } from '../lib/trigger-event-wrapper';

import { AgenticService } from './agentic.service';
import {
  WorkflowEventRestorer,
  WorkflowTriggerUnavailableError,
} from './workflow-event-restorer.service';
import { WorkflowRunOperatorService } from './workflow-run-operator.service';
import { WorkflowRunService } from './workflow-run.service';

const buildWait = (stepId: string, reason: string): WaitInfo => ({
  waitId: `${stepId}@index:1`,
  step: { id: stepId, name: stepId, type: StepType.Task },
  suspendKey: 'index:1',
  reason,
});
const approvalWait = buildWait('approve', 'awaiting_approval');
const secondApprovalWait = buildWait('approve_again', 'awaiting_approval');
const resumeWait = buildWait('collect', 'awaiting_resume');
const replyWait = buildWait('ask', 'awaiting_user_response');

describe('WorkflowRunOperatorService', () => {
  const workflowRunService = {
    findOneAndPopulate: jest.fn(),
    prepareWorkflowDeletion: jest.fn(),
  };
  const agenticService = {
    resumeWait: jest.fn(),
    cancelRun: jest.fn(),
    resumeFromEndedChildren: jest.fn(),
  };
  const eventRestorer = { restore: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let service: WorkflowRunOperatorService;
  const buildService = () =>
    new WorkflowRunOperatorService(
      workflowRunService as unknown as WorkflowRunService,
      agenticService as unknown as AgenticService,
      eventRestorer as unknown as WorkflowEventRestorer,
      logger as unknown as LoggerService,
    );
  const actor = { id: 'admin-1', name: 'Jane Doe' };
  const event = new ManualEventWrapper();
  const buildRun = (
    waits: WaitInfo[],
    overrides: Partial<WorkflowRunFull> = {},
  ): WorkflowRunFull =>
    ({
      id: 'run-1',
      status: 'suspended',
      parentRun: null,
      checkpoint: { waits },
      ...overrides,
    }) as unknown as WorkflowRunFull;
  /** Run `operation` and return the HTTP error it threw. */
  const failure = async (operation: Promise<unknown>) => {
    const error = await operation.then(
      () => {
        throw new Error('expected the operation to fail');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;

    return {
      status: http.getStatus(),
      body: http.getResponse() as Record<string, unknown>,
    };
  };

  beforeEach(() => {
    jest.resetAllMocks();
    eventRestorer.restore.mockResolvedValue(event);
    service = buildService();
  });

  describe('decide', () => {
    it('approves the only approval wait on behalf of the admin', async () => {
      const run = buildRun([replyWait, approvalWait]);
      const resumed = { ...run, status: 'finished' };
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.resumeWait.mockResolvedValue({
        status: 'resumed',
        run: resumed,
      });

      await expect(
        service.decide('run-1', 'approved', { comment: '  ok  ' }, actor),
      ).resolves.toBe(resumed);
      expect(eventRestorer.restore).toHaveBeenCalledWith(run);
      expect(agenticService.resumeWait).toHaveBeenCalledWith({
        run,
        event,
        waitId: approvalWait.waitId,
        resumeData: {
          decision: 'approved',
          decided_by: actor,
          decided_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          comment: 'ok',
        },
      });
    });

    it('rejects the requested wait without an empty comment', async () => {
      const run = buildRun([approvalWait, secondApprovalWait]);
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.resumeWait.mockResolvedValue({ status: 'resumed', run });

      await service.decide(
        'run-1',
        'rejected',
        { waitId: secondApprovalWait.waitId, comment: '   ' },
        actor,
      );

      const [{ waitId, resumeData }] = agenticService.resumeWait.mock.calls[0];
      expect(waitId).toBe(secondApprovalWait.waitId);
      expect(resumeData).toEqual({
        decision: 'rejected',
        decided_by: actor,
        decided_at: expect.any(String),
      });
    });

    it('returns a run that failed once the decision was applied', async () => {
      const run = buildRun([approvalWait]);
      const failed = { ...run, status: 'failed' };
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.resumeWait.mockResolvedValue({
        status: 'failed',
        run: failed,
        error: new Error('Rejected by Jane Doe'),
      });

      await expect(
        service.decide('run-1', 'rejected', {}, actor),
      ).resolves.toBe(failed);
    });

    it('refuses a missing run', async () => {
      workflowRunService.findOneAndPopulate.mockResolvedValue(null);

      await expect(
        service.decide('run-1', 'approved', {}, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      [
        'a run that is not suspended',
        buildRun([approvalWait], { status: 'running' }),
        {},
        409,
        'run_not_suspended',
      ],
      [
        'several approval waits without a waitId',
        buildRun([approvalWait, secondApprovalWait]),
        {},
        400,
        'wait_ambiguous',
      ],
      [
        'a waitId of another kind of wait',
        buildRun([approvalWait, replyWait]),
        { waitId: replyWait.waitId },
        400,
        'wait_kind_mismatch',
      ],
      [
        'a waitId that is not open',
        buildRun([approvalWait]),
        { waitId: 'gone@index:1' },
        409,
        'wait_not_found',
      ],
      [
        'a run without an approval wait',
        buildRun([replyWait]),
        {},
        409,
        'no_matching_wait',
      ],
    ])('refuses %s', async (_label, run, request, status, code) => {
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);

      expect(
        await failure(service.decide('run-1', 'approved', request, actor)),
      ).toEqual({ status, body: expect.objectContaining({ code }) });
      expect(agenticService.resumeWait).not.toHaveBeenCalled();
    });

    it('lists the open approval waits of an ambiguous request', async () => {
      workflowRunService.findOneAndPopulate.mockResolvedValue(
        buildRun([approvalWait, secondApprovalWait, replyWait]),
      );

      const { body } = await failure(
        service.decide('run-1', 'approved', {}, actor),
      );

      expect(body.openWaitIds).toEqual([
        approvalWait.waitId,
        secondApprovalWait.waitId,
      ]);
    });

    it('refuses a run whose trigger cannot be rebuilt', async () => {
      workflowRunService.findOneAndPopulate.mockResolvedValue(
        buildRun([approvalWait]),
      );
      eventRestorer.restore.mockRejectedValue(
        new WorkflowTriggerUnavailableError('thread_closed', 'Closed'),
      );

      expect(
        await failure(service.decide('run-1', 'approved', {}, actor)),
      ).toEqual({
        status: 409,
        body: expect.objectContaining({
          code: 'trigger_unavailable',
          reason: 'thread_closed',
        }),
      });
      expect(agenticService.resumeWait).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a refused payload',
        {
          status: 'rejected',
          error: new WorkflowResumeRejectedError('Payload refused', {
            issues: ['decision: Invalid option'],
          }),
        },
        422,
        { code: 'payload_rejected', issues: ['decision: Invalid option'] },
      ],
      ['a lost claim', { status: 'claim_lost' }, 409, { code: 'claim_lost' }],
      [
        'a wait gone meanwhile',
        { status: 'no_wait' },
        409,
        { code: 'wait_not_found' },
      ],
      [
        'an unresumable run',
        { status: 'unresumable' },
        409,
        { code: 'unresumable' },
      ],
    ])('maps %s', async (_label, outcome, status, body) => {
      const run = buildRun([approvalWait]);
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.resumeWait.mockResolvedValue({ ...outcome, run });

      expect(
        await failure(service.decide('run-1', 'approved', {}, actor)),
      ).toEqual({ status, body: expect.objectContaining(body) });
    });

    it('reports a run that could not be resumed and still waits', async () => {
      workflowRunService.findOneAndPopulate.mockResolvedValue(
        buildRun([approvalWait]),
      );
      agenticService.resumeWait.mockRejectedValue(
        new Error('No action implementations provided for: await_approval'),
      );

      expect(
        await failure(service.decide('run-1', 'approved', {}, actor)),
      ).toEqual({
        status: 409,
        body: expect.objectContaining({
          code: 'resume_unavailable',
          message: expect.stringContaining('await_approval'),
        }),
      });
    });
  });

  describe('resume', () => {
    it('resumes the only resume wait with the admin data', async () => {
      const run = buildRun([approvalWait, resumeWait]);
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.resumeWait.mockResolvedValue({ status: 'resumed', run });

      await service.resume('run-1', { data: { reference: 'REF-1' } }, actor);

      expect(agenticService.resumeWait).toHaveBeenCalledWith({
        run,
        event,
        waitId: resumeWait.waitId,
        resumeData: {
          data: { reference: 'REF-1' },
          resumed_by: actor,
          resumed_at: expect.any(String),
        },
      });
    });

    it('defaults the data to an empty object', async () => {
      const run = buildRun([resumeWait]);
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.resumeWait.mockResolvedValue({ status: 'resumed', run });

      await service.resume('run-1', {}, actor);

      expect(
        agenticService.resumeWait.mock.calls[0][0].resumeData.data,
      ).toEqual({});
    });

    it('does not resume an approval wait', async () => {
      workflowRunService.findOneAndPopulate.mockResolvedValue(
        buildRun([approvalWait]),
      );

      expect(
        (await failure(service.resume('run-1', {}, actor))).body.code,
      ).toBe('no_matching_wait');
    });
  });

  describe('cancel', () => {
    it('cancels a suspended run with the admin and reason', async () => {
      const run = buildRun([replyWait]);
      const failed = { ...run, status: 'failed' };
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.cancelRun.mockResolvedValue({
        status: 'cancelled',
        run: failed,
      });

      await expect(
        service.cancel('run-1', { reason: ' stale ' }, actor),
      ).resolves.toBe(failed);
      expect(agenticService.cancelRun).toHaveBeenCalledWith({
        run,
        message: 'Cancelled by Jane Doe: stale',
        event: undefined,
      });
      // Only a parent run needs the trigger.
      expect(eventRestorer.restore).not.toHaveBeenCalled();
    });

    it('rebuilds the trigger to notify a parent run, when it can', async () => {
      const run = buildRun([approvalWait], {
        parentRun: 'parent-1' as unknown as WorkflowRunFull['parentRun'],
      });
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.cancelRun.mockResolvedValue({ status: 'cancelled', run });

      await service.cancel('run-1', {}, actor);
      expect(agenticService.cancelRun).toHaveBeenLastCalledWith({
        run,
        message: 'Cancelled by Jane Doe',
        event,
      });

      eventRestorer.restore.mockRejectedValue(
        new WorkflowTriggerUnavailableError('thread_closed', 'Closed'),
      );
      await service.cancel('run-1', {}, actor);
      expect(agenticService.cancelRun).toHaveBeenLastCalledWith(
        expect.objectContaining({ event: undefined }),
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it('refuses runs it cannot cancel', async () => {
      workflowRunService.findOneAndPopulate.mockResolvedValue(
        buildRun([], { status: 'finished' }),
      );
      expect(
        (await failure(service.cancel('run-1', {}, actor))).body.code,
      ).toBe('run_not_suspended');

      const run = buildRun([replyWait]);
      workflowRunService.findOneAndPopulate.mockResolvedValue(run);
      agenticService.cancelRun.mockResolvedValue({ status: 'claim_lost', run });
      expect(await failure(service.cancel('run-1', {}, actor))).toEqual({
        status: 409,
        body: expect.objectContaining({ code: 'claim_lost' }),
      });
    });
  });

  describe('workflow deletion', () => {
    const deletedWorkflow = { id: 'workflow-b', name: 'Collect address' };
    const deleteEvent = {
      entity: deletedWorkflow,
      databaseEntity: deletedWorkflow,
    } as unknown as DeleteEntityEvent<WorkflowOrmEntity>;
    const deleteWorkflow = async () => {
      await service.handleWorkflowDeleting(deleteEvent);
      await service.handleWorkflowDeleted(deleteEvent);
    };

    it('notifies the suspended callers once the workflow is deleted', async () => {
      const caller = buildRun([], { id: 'caller-1' });
      workflowRunService.prepareWorkflowDeletion.mockImplementation(
        async () => {
          // Callers are only notified after the deletion.
          expect(agenticService.resumeFromEndedChildren).not.toHaveBeenCalled();

          return ['caller-1', 'caller-2'];
        },
      );
      workflowRunService.findOneAndPopulate.mockImplementation(
        async (id: string) =>
          id === 'caller-1' ? caller : buildRun([], { id, status: 'running' }),
      );

      await deleteWorkflow();

      expect(workflowRunService.prepareWorkflowDeletion).toHaveBeenCalledWith(
        deletedWorkflow,
      );
      expect(eventRestorer.restore).toHaveBeenCalledWith(caller);
      // A caller still running gets the result once it suspends.
      expect(agenticService.resumeFromEndedChildren).toHaveBeenCalledTimes(1);
      expect(agenticService.resumeFromEndedChildren).toHaveBeenCalledWith(
        'caller-1',
        event,
      );

      // The callers are notified once.
      await service.handleWorkflowDeleted(deleteEvent);
      expect(agenticService.resumeFromEndedChildren).toHaveBeenCalledTimes(1);
    });

    it('leaves a caller whose trigger cannot be rebuilt to its next event', async () => {
      workflowRunService.prepareWorkflowDeletion.mockResolvedValue([
        'caller-1',
        'caller-2',
      ]);
      workflowRunService.findOneAndPopulate.mockImplementation(
        async (id: string) => buildRun([], { id }),
      );
      eventRestorer.restore.mockRejectedValueOnce(
        new WorkflowTriggerUnavailableError('thread_closed', 'Closed'),
      );

      await deleteWorkflow();

      expect(logger.warn).toHaveBeenCalled();
      expect(agenticService.resumeFromEndedChildren).toHaveBeenCalledTimes(1);
      expect(agenticService.resumeFromEndedChildren).toHaveBeenCalledWith(
        'caller-2',
        event,
      );
    });

    it('notifies the other callers when one fails', async () => {
      workflowRunService.prepareWorkflowDeletion.mockResolvedValue([
        'caller-1',
        'caller-2',
      ]);
      workflowRunService.findOneAndPopulate.mockImplementation(
        async (id: string) => buildRun([], { id }),
      );
      agenticService.resumeFromEndedChildren.mockRejectedValueOnce(
        new Error('Called workflow workflow-b was deleted'),
      );

      await deleteWorkflow();

      expect(logger.error).toHaveBeenCalled();
      expect(agenticService.resumeFromEndedChildren).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no run called the workflow', async () => {
      workflowRunService.prepareWorkflowDeletion.mockResolvedValue([]);

      await deleteWorkflow();

      expect(workflowRunService.findOneAndPopulate).not.toHaveBeenCalled();
      expect(agenticService.resumeFromEndedChildren).not.toHaveBeenCalled();
    });
  });
});

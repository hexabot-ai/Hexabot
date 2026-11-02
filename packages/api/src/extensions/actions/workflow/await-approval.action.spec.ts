/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type Actions,
  BaseWorkflowContext,
  Workflow,
  WorkflowResumeRejectedError,
} from '@hexabot-ai/agentic';

import { ActionService } from '@/actions/actions.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';
import { approvalDecisionSchema } from '@/workflow/schemas/operator-wait-schemas';

import AwaitApprovalAction from './await-approval.action';

class TestContext extends BaseWorkflowContext {
  public eventEmitter = { emit: jest.fn(), on: jest.fn() };
}

const decidedBy = { id: 'admin-1', name: 'Jane Doe' };
const decidedAt = '2026-01-02T10:00:00.000Z';

describe('AwaitApprovalAction', () => {
  let action: InstanceType<typeof AwaitApprovalAction>;
  let suspend: jest.Mock;
  let context: WorkflowRuntimeContext;

  beforeEach(() => {
    action = new AwaitApprovalAction({
      register: jest.fn(),
    } as unknown as ActionService);
    suspend = jest.fn();
    context = { workflow: { suspend } } as unknown as WorkflowRuntimeContext;
  });

  const execute = (settings: Record<string, unknown> = {}) =>
    action.execute({
      input: { message: 'Refund 42 EUR?', details: { order: 'A-1' } },
      context,
      settings: action.parseSettings(settings),
      bindings: {} as any,
    });

  it('suspends on an approval wait describing the request', async () => {
    suspend.mockResolvedValue({
      decision: 'approved',
      decided_by: decidedBy,
      decided_at: decidedAt,
    });

    await expect(execute()).resolves.toEqual({
      approved: true,
      decision: 'approved',
      decided_by: decidedBy,
      decided_at: decidedAt,
    });
    expect(suspend).toHaveBeenCalledWith({
      reason: 'awaiting_approval',
      data: { message: 'Refund 42 EUR?', details: { order: 'A-1' } },
      accepts: approvalDecisionSchema,
    });
  });

  it('continues with approved set to false on a rejection by default', async () => {
    suspend.mockResolvedValue({
      decision: 'rejected',
      decided_by: decidedBy,
      decided_at: decidedAt,
      comment: 'Too high',
    });

    await expect(execute()).resolves.toEqual(
      expect.objectContaining({
        approved: false,
        decision: 'rejected',
        comment: 'Too high',
      }),
    );
  });

  it('fails on a rejection when on_reject is fail', async () => {
    suspend.mockResolvedValue({
      decision: 'rejected',
      decided_by: decidedBy,
      decided_at: decidedAt,
      comment: 'Too high',
    });

    await expect(execute({ on_reject: 'fail' })).rejects.toThrow(
      'Rejected by Jane Doe: Too high',
    );
  });

  describe('with the agentic runner', () => {
    const run = async (settings: Record<string, unknown> = {}) => {
      const workflow = Workflow.fromDefinition(
        {
          defs: {
            review: {
              kind: 'task',
              action: 'await_approval',
              inputs: { message: 'Refund 42 EUR?' },
              settings: { retries: { enabled: false }, ...settings },
            },
          },
          flow: [{ do: 'review' }],
          outputs: { approved: '=$output.review.approved' },
        },
        { actions: { await_approval: action } as unknown as Actions },
      );
      const runner = await workflow.buildAsyncRunner();
      const started = await runner.start({
        inputData: {},
        context: new TestContext({}),
      });
      if (started.status !== 'suspended') {
        throw new Error('expected the run to suspend');
      }

      return { runner, started, wait: started.waits[0] };
    };

    it('refuses a malformed decision and finishes on an approval', async () => {
      const { runner, started, wait } = await run();

      expect(wait).toEqual(
        expect.objectContaining({
          reason: 'awaiting_approval',
          data: { message: 'Refund 42 EUR?', details: null },
          accepts: expect.objectContaining({ type: 'object' }),
        }),
      );

      const refused = await runner.resume({
        waitId: wait.waitId,
        resumeData: { decision: 'maybe', decided_by: decidedBy },
      });
      expect(refused).toMatchObject({
        status: 'suspended',
        checkpoint: started.checkpoint,
        rejection: { waitId: wait.waitId },
      });
      expect(
        refused.status === 'suspended' && refused.rejection?.error,
      ).toBeInstanceOf(WorkflowResumeRejectedError);

      await expect(
        runner.resume({
          waitId: wait.waitId,
          resumeData: {
            decision: 'approved',
            decided_by: decidedBy,
            decided_at: decidedAt,
          },
        }),
      ).resolves.toMatchObject({
        status: 'finished',
        output: { approved: true },
      });
    });

    it('fails the run on a rejection when on_reject is fail', async () => {
      const { runner, wait } = await run({ on_reject: 'fail' });
      const result = await runner.resume({
        waitId: wait.waitId,
        resumeData: {
          decision: 'rejected',
          decided_by: decidedBy,
          decided_at: decidedAt,
        },
      });

      expect(result.status).toBe('failed');
      expect(result.status === 'failed' && result.error).toEqual(
        expect.objectContaining({ message: 'Rejected by Jane Doe' }),
      );
    });
  });
});

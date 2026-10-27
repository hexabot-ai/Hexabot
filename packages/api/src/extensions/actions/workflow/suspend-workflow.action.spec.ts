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

import SuspendWorkflowAction from './suspend-workflow.action';

class TestContext extends BaseWorkflowContext {
  public eventEmitter = { emit: jest.fn(), on: jest.fn() };
}

const resumedBy = { id: 'admin-1', name: 'Jane Doe' };
const resumedAt = '2026-01-02T10:00:00.000Z';
const payloadSchema = {
  type: 'object',
  properties: {
    reference: { type: 'string', minLength: 3 },
    due: { type: 'string', format: 'date-time' },
  },
  required: ['reference'],
};

describe('SuspendWorkflowAction', () => {
  const action = new SuspendWorkflowAction({
    register: jest.fn(),
  } as unknown as ActionService);
  const start = async (settings: Record<string, unknown> = {}) => {
    const workflow = Workflow.fromDefinition(
      {
        defs: {
          collect: {
            kind: 'task',
            action: 'suspend_workflow',
            inputs: { message: 'Supply the reference.' },
            settings: { retries: { enabled: false }, ...settings },
          },
        },
        flow: [{ do: 'collect' }],
        outputs: {
          data: '=$output.collect.data',
          by: '=$output.collect.resumed_by.name',
        },
      },
      { actions: { suspend_workflow: action } as unknown as Actions },
    );
    const runner = await workflow.buildAsyncRunner();
    const started = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });

    return { workflow, runner, started };
  };

  it('accepts any JSON object when no payload schema is declared', async () => {
    const { runner, started } = await start();
    if (started.status !== 'suspended') {
      throw new Error('expected the run to suspend');
    }
    const [wait] = started.waits;

    expect(wait).toEqual(
      expect.objectContaining({
        reason: 'awaiting_resume',
        data: {
          message: 'Supply the reference.',
          details: null,
          payload_schema: null,
        },
      }),
    );
    await expect(
      runner.resume({
        waitId: wait.waitId,
        resumeData: {
          data: { anything: [1, 2] },
          resumed_by: resumedBy,
          resumed_at: resumedAt,
        },
      }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: { data: { anything: [1, 2] }, by: 'Jane Doe' },
    });
  });

  it('checks the data against the declared payload schema', async () => {
    const { workflow, runner, started } = await start({
      payload_schema: payloadSchema,
    });
    if (started.status !== 'suspended') {
      throw new Error('expected the run to suspend');
    }
    const [wait] = started.waits;
    const resume = (data: Record<string, unknown>) => ({
      data,
      resumed_by: resumedBy,
      resumed_at: resumedAt,
    });

    expect(wait.data).toEqual(
      expect.objectContaining({ payload_schema: payloadSchema }),
    );
    // A host refuses it before claiming the run...
    const validated = workflow.validateCheckpoint(started.checkpoint, {
      waitId: wait.waitId,
      resumeData: resume({}),
    });
    expect(validated.ok).toBe(false);
    expect(!validated.ok && validated.error).toBeInstanceOf(
      WorkflowResumeRejectedError,
    );
    // ...and so does the step, for checks JSON Schema relaxed away.
    const refused = await runner.resume({
      waitId: wait.waitId,
      resumeData: resume({ reference: 'REF-1', due: 'tomorrow' }),
    });
    expect(refused).toMatchObject({
      status: 'suspended',
      rejection: { waitId: wait.waitId },
    });

    await expect(
      runner.resume({
        waitId: wait.waitId,
        resumeData: resume({
          reference: 'REF-1',
          due: '2026-02-01T00:00:00Z',
        }),
      }),
    ).resolves.toMatchObject({
      status: 'finished',
      output: {
        data: { reference: 'REF-1', due: '2026-02-01T00:00:00Z' },
      },
    });
  });

  it('fails the step when the payload schema cannot be read', async () => {
    const { started } = await start({ payload_schema: { type: 'nope' } });

    expect(started.status).toBe('failed');
    expect(started.status === 'failed' && started.error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'payload_schema is not a valid JSON Schema',
        ),
      }),
    );
  });
});

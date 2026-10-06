/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type Actions,
  BaseWorkflowContext,
  Workflow,
  WorkflowResumeRejectedError,
} from '@hexabot-ai/agentic';

import { ActionService } from '@/actions/actions.service';
import { ConversationalWorkflowContext } from '@/workflow/contexts/conversational-workflow.context';

import { AwaitReplyAction, awaitReplyResumeSchema } from './await-reply.action';

class TestContext extends BaseWorkflowContext {
  public eventEmitter = { emit: jest.fn(), on: jest.fn() };
}

describe('AwaitReplyAction', () => {
  let actionService: ActionService;
  let action: AwaitReplyAction;
  let workflow: { suspend: jest.Mock };
  let context: ConversationalWorkflowContext;
  let event: {
    getHandler: jest.Mock;
    getInitiator: jest.Mock;
  };

  beforeEach(() => {
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new AwaitReplyAction(actionService);
    workflow = { suspend: jest.fn() };
    event = {
      getHandler: jest.fn(() => ({ getName: () => 'web' })),
      getInitiator: jest.fn(() => ({ id: 'sub-event' })),
    };
    context = {
      workflow,
      event,
      initiatorId: 'sub-ctx',
      workflowRunId: 'run-ctx',
    } as unknown as ConversationalWorkflowContext;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('suspends the workflow and returns parsed conversational input', async () => {
    const resume = {
      message: { type: 'text', data: { text: 'user reply' } },
      text: 'user reply',
      thread_id: 'thread-1',
    };
    workflow.suspend.mockResolvedValue(resume);

    const result = await action.execute({
      input: undefined,
      context,
      settings: action.parseSettings({}),
      bindings: {} as any,
    });

    expect(workflow.suspend).toHaveBeenCalledWith({
      reason: 'awaiting_user_response',
      data: null,
      accepts: awaitReplyResumeSchema,
    });
    expect(result).toEqual(resume);
  });

  it('keeps waiting when the reply does not match the conversational input', async () => {
    const workflowDefinition = Workflow.fromDefinition(
      {
        defs: { wait: { kind: 'task', action: 'await_reply' } },
        flow: [{ do: 'wait' }],
        outputs: { text: '=$output.wait.text' },
      },
      { actions: { await_reply: action } as unknown as Actions },
    );
    const runner = await workflowDefinition.buildAsyncRunner();
    const started = await runner.start({
      inputData: {},
      context: new TestContext({}),
    });
    if (started.status !== 'suspended') {
      throw new Error('expected the run to suspend');
    }
    const [wait] = started.waits;
    const refused = await runner.resume({
      waitId: wait.waitId,
      resumeData: { unexpected: true },
    });

    expect(refused).toMatchObject({
      status: 'suspended',
      checkpoint: started.checkpoint,
      rejection: { waitId: wait.waitId },
    });
    expect(
      refused.status === 'suspended' && refused.rejection?.error,
    ).toBeInstanceOf(WorkflowResumeRejectedError);

    const resumed = await runner.resume({
      waitId: wait.waitId,
      resumeData: {
        message: { type: 'text', data: { text: 'user reply' } },
        text: 'user reply',
        thread_id: 'thread-1',
      },
    });

    expect(resumed).toMatchObject({
      status: 'finished',
      output: { text: 'user reply' },
    });
  });

  it('accepts optional conversational fields in resume data', async () => {
    const resumeWithOptionalFields = {
      message: { type: 'text', data: { text: 'user reply' } },
      text: 'user reply',
      message_type: 'text',
      payload: 'quick-reply',
      mid: 'mid-1',
      thread_id: 'thread-1',
    };
    workflow.suspend.mockResolvedValue(resumeWithOptionalFields);

    const resultWithOptionalFields = await action.execute({
      input: undefined,
      context,
      settings: action.parseSettings({}),
      bindings: {} as any,
    });

    expect(resultWithOptionalFields).toEqual(resumeWithOptionalFields);
  });
});

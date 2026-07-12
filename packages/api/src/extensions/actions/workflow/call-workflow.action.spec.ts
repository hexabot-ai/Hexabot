/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ActionService } from '@/actions/actions.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { CallWorkflowAction } from './call-workflow.action';

describe('CallWorkflowAction', () => {
  const actionServiceMock = {
    register: jest.fn(),
  } as unknown as ActionService;
  const workflowId = '11111111-1111-4111-8111-111111111111';
  const childRunId = '22222222-2222-4222-8222-222222222222';
  const finishedPayload = {
    status: 'finished' as const,
    workflow_id: workflowId,
    workflow_run_id: childRunId,
    output: { child: 'done' },
  };
  const buildContext = ({
    hasRecordedResult,
    callWorkflow,
    suspend,
  }: {
    hasRecordedResult: jest.Mock;
    callWorkflow: jest.Mock;
    suspend: jest.Mock;
  }) =>
    ({
      services: { agentic: { callWorkflow } },
      workflow: { hasRecordedResult, suspend },
    }) as unknown as WorkflowRuntimeContext;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('spawns the child workflow and suspends until the child result arrives', async () => {
    const callWorkflow = jest.fn().mockResolvedValue({
      status: 'suspended',
      workflow_id: workflowId,
      workflow_run_id: childRunId,
    });
    const suspend = jest.fn().mockResolvedValue(finishedPayload);
    const context = buildContext({
      hasRecordedResult: jest.fn(() => false),
      callWorkflow,
      suspend,
    });
    const action = new CallWorkflowAction(actionServiceMock);
    const result = await action.execute({
      input: { workflow_id: workflowId },
      context,
    } as any);

    expect(callWorkflow).toHaveBeenCalledWith({
      workflowId,
      input: undefined,
      parentContext: context,
    });
    expect(suspend).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'awaiting_child_workflow' }),
    );
    expect(result).toEqual(finishedPayload);
  });

  it('does not re-spawn the child workflow when replaying a recorded suspension', async () => {
    const callWorkflow = jest.fn();
    const suspend = jest.fn().mockResolvedValue(finishedPayload);
    const context = buildContext({
      hasRecordedResult: jest.fn(() => true),
      callWorkflow,
      suspend,
    });
    const action = new CallWorkflowAction(actionServiceMock);
    const result = await action.execute({
      input: { workflow_id: workflowId },
      context,
    } as any);

    // Deterministic replay re-executes this action after the child completes;
    // spawning again would create a duplicate, orphaned child run.
    expect(callWorkflow).not.toHaveBeenCalled();
    expect(suspend).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'awaiting_child_workflow' }),
    );
    expect(result).toEqual(finishedPayload);
  });
});

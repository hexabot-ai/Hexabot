/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowFull, WorkflowRun, WorkflowRunFull } from '@hexabot-ai/types';
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { UserService } from '@/user/services/user.service';

import {
  ManualEventWrapper,
  TriggerEventWrapper,
} from '../lib/trigger-event-wrapper';

import { AgenticService } from './agentic.service';
import { WorkflowService } from './workflow.service';

/**
 * Outcome of a triggered workflow run, exposed to webhook callers. Execution
 * is synchronous, so the final status and workflow output are available.
 */
export type WorkflowTriggerResult = {
  runId: string;
  status: WorkflowRun['status'];
  output: Record<string, unknown> | null;
  error: string | null;
};

@Injectable()
export class WebhookTriggerService {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly userService: UserService,
    private readonly agenticService: AgenticService,
  ) {}

  /**
   * Executes a manual workflow run from a webhook.
   *
   * Access control (existence, manual type, enabled webhook, credentials) is
   * enforced upstream by {@link WebhookTriggerGuard}; this method resolves the
   * workflow, validates the payload, and dispatches the event. The workflow
   * runs to completion before responding, so the result carries the final run
   * status and output.
   *
   * @param id - The workflow ID to execute.
   * @param input - Optional workflow input payload.
   */
  async trigger(id: string, input: unknown): Promise<WorkflowTriggerResult> {
    const workflow = await this.workflowService.findOneAndPopulate(id);
    if (!workflow) {
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    const manualInput = this.workflowService.validateManualInput(
      input ?? {},
      workflow.inputSchema,
    );
    const initiatorId = workflow.createdBy?.id ?? null;
    const event = new ManualEventWrapper(manualInput, initiatorId);
    const run = await this.dispatchTriggerEvent(workflow, event, initiatorId);
    if (!run) {
      // The run could not be created (missing initiator/definition) or the
      // runner crashed before persisting a result.
      throw new UnprocessableEntityException(
        'Workflow run could not be started',
      );
    }

    return {
      runId: run.id,
      status: run.status,
      output: run.output ?? null,
      error: run.error ?? null,
    };
  }

  /**
   * Resolves the initiator, targets the event at the given workflow, and hands
   * it to the agentic runner. Shared by webhook triggers and authenticated
   * manual runs so both paths dispatch identically.
   */
  async dispatchTriggerEvent(
    workflow: WorkflowFull,
    event: TriggerEventWrapper,
    initiatorId: string | null,
  ): Promise<WorkflowRunFull | null> {
    const initiator = initiatorId
      ? await this.userService.findOne(initiatorId)
      : null;
    if (initiator) {
      event.setInitiator(initiator);
    }
    event.setWorkflowId(workflow.id);

    return await this.agenticService.handleEvent(event, { workflow });
  }
}

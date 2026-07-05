/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  WebhookAuthType,
  WorkflowFull,
  WorkflowRun,
  WorkflowRunFull,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { CredentialService } from '@/user/services/credential.service';
import { UserService } from '@/user/services/user.service';

import {
  ManualEventWrapper,
  TriggerEventWrapper,
} from '../lib/trigger-event-wrapper';
import { WorkflowType } from '../types';

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

/**
 * A server-issued webhook trigger token. Tokens carry no expiry: they stay
 * valid until the workflow's signing secret credential is rotated.
 */
export type WebhookTokenResult = {
  token: string;
};

@Injectable()
export class WebhookTriggerService {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly userService: UserService,
    private readonly agenticService: AgenticService,
    private readonly credentialService: CredentialService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Signs a webhook trigger token with the workflow's own JWT secret so
   * callers never have to craft tokens themselves. Tokens carry no expiry;
   * rotating the secret credential invalidates every previously issued
   * token. The workflow must be a manual workflow with an enabled,
   * JWT-authenticated webhook trigger.
   *
   * @param id - The workflow ID the token is scoped to.
   */
  async generateToken(id: string): Promise<WebhookTokenResult> {
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    const webhook = workflow.webhookTrigger;
    if (
      workflow.type !== WorkflowType.manual ||
      !webhook?.enabled ||
      webhook.authType !== WebhookAuthType.jwt
    ) {
      throw new BadRequestException(
        'Workflow must have an enabled JWT-authenticated webhook trigger',
      );
    }

    const secret = await this.credentialService.findOneValue(
      webhook.jwtSecretCredentialId ?? undefined,
    );
    if (!secret) {
      throw new BadRequestException(
        'The webhook trigger references a missing JWT secret credential',
      );
    }

    const token = this.jwtService.sign(
      { sub: id },
      {
        secret,
        algorithm: webhook.jwtAlgorithm ?? 'HS256',
      },
    );

    return { token };
  }

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

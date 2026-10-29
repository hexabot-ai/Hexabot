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
 * Outcome of a triggered workflow run, exposed to webhook callers. By default
 * the run executes before the response, which carries its final status and
 * output. An asynchronous trigger answers without waiting for the run:
 * `output` and `error` are then `null`, and `status` is the run's status at
 * that time. It is `idle` for a new run, `running` for a suspended run the
 * call resumed, or `suspended` for one the call reached without resuming it
 * (the run refused the body, or a called workflow's result is delivered to it
 * instead).
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
   * workflow, validates the payload, and dispatches the event. By default the
   * workflow runs until it finishes, fails or suspends before responding, so
   * the result carries the final run status and output.
   *
   * @param id - The workflow ID to execute.
   * @param input - Optional workflow input payload.
   * @param options.async - Respond without waiting for the run, and without
   * its output, for workflows that run longer than the caller can wait.
   */
  async trigger(
    id: string,
    input: unknown,
    options: { async?: boolean } = {},
  ): Promise<WorkflowTriggerResult> {
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
    const run = await this.dispatchTriggerEvent(workflow, event, initiatorId, {
      wait: !options.async,
    });
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
      output: options.async ? null : (run.output ?? null),
      error: options.async ? null : (run.error ?? null),
    };
  }

  /**
   * Resolves the initiator, targets the event at the given workflow, and hands
   * it to the agentic runner. Shared by webhook triggers and authenticated
   * manual runs so both paths dispatch identically.
   *
   * @param options.wait - Wait for the run to finish, fail or suspend
   * (default). With `false`, return the run as soon as the event reached it
   * (see `AgenticService.dispatchEvent`); its pass goes on in the background.
   * @returns The run, or `null` when no run could process the event.
   */
  async dispatchTriggerEvent(
    workflow: WorkflowFull,
    event: TriggerEventWrapper,
    initiatorId: string | null,
    { wait = true }: { wait?: boolean } = {},
  ): Promise<WorkflowRunFull | null> {
    const initiator = initiatorId
      ? await this.userService.findOne(initiatorId)
      : null;
    if (initiator) {
      event.setInitiator(initiator);
    }
    event.setWorkflowId(workflow.id);

    return wait
      ? await this.agenticService.handleEvent(event, { workflow })
      : await this.agenticService.dispatchEvent(event, { workflow });
  }
}

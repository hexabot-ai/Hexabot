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
  ConflictException,
  HttpStatus,
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
 * call resumed, or `suspended` for one that waits on a workflow it called,
 * whose result the call delivers to it instead. Only an authenticated call
 * reaches a suspended run; an anonymous one always starts a new run. A body
 * the suspended run refused is an error, not an outcome (see
 * {@link WebhookTriggerService.dispatchTriggerEvent}).
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
   * the result carries the final run status and output. A call without
   * authentication (`none`) only starts runs: it never resumes a suspended
   * one.
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
    // Every call acts as the workflow's creator. Resuming on an anonymous
    // call would let anyone answer the waits of the creator's runs, and read
    // their output.
    const authenticated =
      (workflow.webhookTrigger?.authType ?? WebhookAuthType.none) !==
      WebhookAuthType.none;
    const run = await this.dispatchTriggerEvent(workflow, event, initiatorId, {
      wait: !options.async,
      resume: authenticated,
    });

    return {
      runId: run.id,
      status: run.status,
      output: options.async ? null : (run.output ?? null),
      error: options.async ? null : (run.error ?? null),
    };
  }

  /**
   * Resolves the initiator, targets the event at the given workflow, and hands
   * it to the agentic runner. Shared by webhook triggers, authenticated
   * manual runs and the MCP run tool so they dispatch, and fail, identically.
   *
   * @param options.wait - Wait for the run to finish, fail or suspend
   * (default). With `false`, return the run as soon as the event reached it
   * (see `AgenticService.triggerEvent`); its pass goes on in the background.
   * @param options.resume - Let the event resume a suspended run of the
   * initiator (default). With `false`, it always starts a new run.
   * @returns The run.
   * @throws {UnprocessableEntityException} `payload_rejected` when the
   * suspended run the event reached refused its input (the run still waits on
   * the same wait), or when no run could process the event.
   * @throws {ConflictException} `claim_lost` when another request resumed or
   * cancelled that suspended run first.
   */
  async dispatchTriggerEvent(
    workflow: WorkflowFull,
    event: TriggerEventWrapper,
    initiatorId: string | null,
    { wait = true, resume = true }: { wait?: boolean; resume?: boolean } = {},
  ): Promise<WorkflowRunFull> {
    const initiator = initiatorId
      ? await this.userService.findOne(initiatorId)
      : null;
    if (initiator) {
      event.setInitiator(initiator);
    }
    event.setWorkflowId(workflow.id);

    const outcome = await this.agenticService.triggerEvent(event, {
      workflow,
      wait,
      resume,
    });
    switch (outcome.status) {
      case 'dispatched':
        return outcome.run;
      case 'rejected':
        throw new UnprocessableEntityException({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'payload_rejected',
          message: outcome.error.message,
          issues: outcome.error.issues ?? [],
          runId: outcome.runId,
        });
      case 'claim_lost':
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          code: 'claim_lost',
          message: 'The run was resumed or cancelled by another request',
          runId: outcome.runId,
        });
      default:
        // The run could not be created (missing initiator/definition) or the
        // runner crashed before persisting a result.
        throw new UnprocessableEntityException(
          'Workflow run could not be started',
        );
    }
  }
}

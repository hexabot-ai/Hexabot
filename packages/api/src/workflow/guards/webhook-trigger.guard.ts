/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { timingSafeEqual } from 'node:crypto';

import { WebhookAuthType, WebhookTriggerConfig } from '@hexabot-ai/types';
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NotFoundException,
  ParseUUIDPipe,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { LoggerService } from '@/logger/logger.service';
import { CredentialService } from '@/user/services/credential.service';

import { WorkflowService } from '../services/workflow.service';
import { WorkflowType } from '../types';

// One message for every refusal, so it does not tell what was wrong.
const invalidCredentials = () =>
  new UnauthorizedException('Invalid webhook credentials');

type WebhookAuth<T extends WebhookAuthType> = Extract<
  WebhookTriggerConfig,
  { authType: T }
>;

const AUTHORIZATION_PATTERNS = {
  Basic: /^Basic\s+(\S+)$/i,
  Bearer: /^Bearer\s+(\S+)$/i,
};
/**
 * Reads the credentials of the `Authorization` header sent with `scheme`
 * (case-insensitive).
 *
 * @throws UnauthorizedException when the header is missing or uses another scheme.
 */
const readAuthorization = (
  req: Request,
  scheme: keyof typeof AUTHORIZATION_PATTERNS,
) => {
  const match = (req.headers.authorization ?? '').match(
    AUTHORIZATION_PATTERNS[scheme],
  );
  if (!match) {
    throw invalidCredentials();
  }

  return match[1];
};

/**
 * Guards the public webhook trigger endpoint. It resolves the target workflow,
 * enforces that it is a manual workflow with an enabled webhook, and verifies
 * the configured credentials. The handler re-resolves the workflow rather than
 * receiving it through mutated request state.
 */
@Injectable()
export class WebhookTriggerGuard implements CanActivate {
  private readonly uuidPipe = new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: HttpStatus.NOT_FOUND,
  });

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly credentialService: CredentialService,
    private readonly jwtService: JwtService,
    private readonly logger: LoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const id = await this.uuidPipe.transform(request.params.id, {
      type: 'param',
      data: 'id',
    });
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    // Do not disclose whether the workflow exists when it is not exposed as a
    // webhook (wrong type or webhook disabled).
    if (workflow.type !== WorkflowType.manual) {
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    const webhook = workflow.webhookTrigger;
    if (!webhook?.enabled) {
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    await this.verifyWebhookAuth(webhook, request);

    return true;
  }

  /**
   * Resolves the secret referenced by the trigger config from the credentials
   * store. A missing reference or a dangling credential must never
   * authenticate: both fail closed with a generic 401, with a server-side
   * warning so operators can diagnose broken references.
   */
  private async resolveSecret(
    credentialId: string | null | undefined,
  ): Promise<string> {
    if (!credentialId) {
      throw invalidCredentials();
    }

    const value = await this.credentialService.findOneValue(credentialId);
    if (!value) {
      this.logger.warn(
        `Webhook trigger references a missing credential (${credentialId})`,
      );
      throw invalidCredentials();
    }

    return value;
  }

  /**
   * Validates incoming webhook credentials against the workflow configuration.
   * Throws {@link UnauthorizedException} when the credentials are missing or invalid.
   */
  private async verifyWebhookAuth(
    webhook: WebhookTriggerConfig,
    req: Request,
  ): Promise<void> {
    switch (webhook.authType) {
      case WebhookAuthType.none:
        return;
      case WebhookAuthType.basic:
        return await this.verifyBasicAuth(webhook, req);
      case WebhookAuthType.header:
        return await this.verifyHeaderAuth(webhook, req);
      case WebhookAuthType.jwt:
        return await this.verifyJwtAuth(webhook, req);
      default:
        throw invalidCredentials();
    }
  }

  private async verifyBasicAuth(
    webhook: WebhookAuth<WebhookAuthType.basic>,
    req: Request,
  ): Promise<void> {
    // A missing expected secret must never authenticate empty credentials.
    if (!webhook.username) {
      throw invalidCredentials();
    }
    const expectedPassword = await this.resolveSecret(
      webhook.passwordCredentialId,
    );
    const decoded = Buffer.from(
      readAuthorization(req, 'Basic'),
      'base64',
    ).toString('utf8');
    const separator = decoded.indexOf(':');
    const username = separator === -1 ? decoded : decoded.slice(0, separator);
    const password = separator === -1 ? '' : decoded.slice(separator + 1);
    if (
      !this.safeEqual(username, webhook.username) ||
      !this.safeEqual(password, expectedPassword)
    ) {
      throw invalidCredentials();
    }
  }

  private async verifyHeaderAuth(
    webhook: WebhookAuth<WebhookAuthType.header>,
    req: Request,
  ): Promise<void> {
    const headerName = (webhook.headerName ?? '').toLowerCase();
    // A missing expected secret must never authenticate empty credentials.
    if (!headerName) {
      throw invalidCredentials();
    }
    const expectedValue = await this.resolveSecret(
      webhook.headerValueCredentialId,
    );
    const provided = req.headers[headerName];
    const value = Array.isArray(provided) ? provided[0] : (provided ?? '');
    if (!this.safeEqual(value, expectedValue)) {
      throw invalidCredentials();
    }
  }

  private async verifyJwtAuth(
    webhook: WebhookAuth<WebhookAuthType.jwt>,
    req: Request,
  ): Promise<void> {
    const secret = await this.resolveSecret(webhook.jwtSecretCredentialId);
    const token = readAuthorization(req, 'Bearer');
    try {
      this.jwtService.verify(token, {
        secret,
        algorithms: [webhook.jwtAlgorithm ?? 'HS256'],
      });
    } catch {
      throw invalidCredentials();
    }
  }

  /**
   * Constant-time string comparison to avoid leaking secrets through timing.
   */
  private safeEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');
    if (bufferA.length !== bufferB.length) {
      return false;
    }

    return timingSafeEqual(bufferA, bufferB);
  }
}

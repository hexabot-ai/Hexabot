/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { WebhookAuthType, WebhookJwtAlgorithm } from '@hexabot-ai/types';
import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { CredentialService } from '@/user/services/credential.service';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import {
  installMessagingWorkflowFixturesTypeOrm,
  installScheduledWorkflowFixturesTypeOrm,
} from '@/utils/test/fixtures/workflow';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import type { WebsocketGateway } from '@/websocket/websocket.gateway';
import {
  conversationalWorkflowInputJsonSchema,
  scheduledWorkflowInputJsonSchema,
} from '@/workflow/schemas/workflow-input-schemas';

import { WorkflowRunService } from '../services/workflow-run.service';
import { WorkflowService } from '../services/workflow.service';
import { DirectionType, WorkflowType } from '../types';

import { WebhookTriggerGuard } from './webhook-trigger.guard';

describe('WebhookTriggerGuard (TypeORM)', () => {
  let guard: WebhookTriggerGuard;
  let workflowService: WorkflowService;
  const workflowRunServiceMock = {
    findOne: jest.fn(),
  } as jest.Mocked<Pick<WorkflowRunService, 'findOne'>>;
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  } as jest.Mocked<
    Pick<WebsocketGateway, 'joinSockets' | 'broadcastWorkflowEvent'>
  >;
  const jwtService = new JwtService({});
  // Secrets live in the credentials store; the guard resolves them by id.
  const credentialStore = new Map<string, string>([
    ['cred-basic-password', 'webhook-pass'],
    ['cred-header-value', 'super-secret'],
    ['cred-jwt-secret', 'jwt-shared-secret'],
  ]);
  const credentialServiceMock = {
    findOneValue: jest.fn(
      async (id?: string) => (id && credentialStore.get(id)) ?? null,
    ),
  } as unknown as jest.Mocked<Pick<CredentialService, 'findOneValue'>>;
  const createdWorkflowIds = new Set<string>();
  let counter = 0;

  const buildWorkflowPayload = () => {
    return {
      name: `webhook_guard_workflow_${++counter}`,
      description: 'Webhook trigger guard test definition',
      type: WorkflowType.conversational,
      schedule: null,
      inputSchema: conversationalWorkflowInputJsonSchema,
      createdBy: userFixtureIds.admin,
      direction: DirectionType.HORIZONTAL,
      x: 0,
      y: 0,
      zoom: 1,
      builtin: false,
      runAfterMs: 0,
      webhookTrigger: null,
    };
  };
  const createManualWebhookWorkflow = async (
    webhookTrigger: Record<string, unknown> | null,
  ) => {
    const workflow = await workflowService.create({
      ...buildWorkflowPayload(),
      type: WorkflowType.manual,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      webhookTrigger,
      createdBy: userFixtureIds.admin,
    } as any);
    createdWorkflowIds.add(workflow.id);

    return workflow;
  };
  const buildContext = (
    id: string,
    headers: Record<string, unknown> = {},
  ): ExecutionContext => {
    const request = { params: { id }, headers };

    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WebhookTriggerGuard,
        {
          provide: WorkflowRunService,
          useValue: workflowRunServiceMock,
        },
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: websocketGatewayMock,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: CredentialService,
          useValue: credentialServiceMock,
        },
      ],
      typeorm: {
        fixtures: [
          installMessagingWorkflowFixturesTypeOrm,
          installScheduledWorkflowFixturesTypeOrm,
        ],
      },
    });
    [guard, workflowService] = await getMocks([
      WebhookTriggerGuard,
      WorkflowService,
    ]);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const ids = Array.from(createdWorkflowIds);

    for (const id of ids) {
      await workflowService.deleteOne(id);
      createdWorkflowIds.delete(id);
    }
  });

  it('allows the request when no auth is configured', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.none,
    });
    const context = buildContext(workflow.id);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('accepts a request with valid basic credentials', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.basic,
      username: 'webhook-user',
      passwordCredentialId: 'cred-basic-password',
    });
    const encoded = Buffer.from('webhook-user:webhook-pass').toString('base64');
    const context = buildContext(workflow.id, {
      authorization: `Basic ${encoded}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a request with invalid basic credentials', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.basic,
      username: 'webhook-user',
      passwordCredentialId: 'cred-basic-password',
    });
    const encoded = Buffer.from('webhook-user:wrong').toString('base64');
    const context = buildContext(workflow.id, {
      authorization: `Basic ${encoded}`,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a request with the configured auth header', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.header,
      headerName: 'X-Webhook-Token',
      headerValueCredentialId: 'cred-header-value',
    });
    const context = buildContext(workflow.id, {
      'x-webhook-token': 'super-secret',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a request with a wrong auth header value', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.header,
      headerName: 'X-Webhook-Token',
      headerValueCredentialId: 'cred-header-value',
    });
    const context = buildContext(workflow.id, {
      'x-webhook-token': 'nope',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a request with a valid JWT', async () => {
    const secret = 'jwt-shared-secret';
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.jwt,
      jwtSecretCredentialId: 'cred-jwt-secret',
      jwtAlgorithm: WebhookJwtAlgorithm.HS256,
    });
    const token = jwtService.sign({ sub: 'caller' }, { secret });
    const context = buildContext(workflow.id, {
      authorization: `Bearer ${token}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a request with a JWT signed by a different secret', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.jwt,
      jwtSecretCredentialId: 'cred-jwt-secret',
      jwtAlgorithm: WebhookJwtAlgorithm.HS256,
    });
    const token = jwtService.sign({ sub: 'caller' }, { secret: 'other' });
    const context = buildContext(workflow.id, {
      authorization: `Bearer ${token}`,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects the request when the referenced credential is missing', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: true,
      authType: WebhookAuthType.header,
      headerName: 'X-Webhook-Token',
      headerValueCredentialId: 'cred-deleted',
    });
    // Even the correct secret must not authenticate against a dangling
    // credential reference: the guard fails closed.
    const context = buildContext(workflow.id, {
      'x-webhook-token': 'super-secret',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns not found when the webhook trigger is disabled', async () => {
    const workflow = await createManualWebhookWorkflow({
      enabled: false,
      authType: WebhookAuthType.none,
    });
    const context = buildContext(workflow.id);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns not found for a non-manual workflow to avoid disclosing it', async () => {
    const scheduled = await workflowService.create({
      ...buildWorkflowPayload(),
      type: WorkflowType.scheduled,
      schedule: '*/5 * * * * *',
      inputSchema: scheduledWorkflowInputJsonSchema,
      createdBy: userFixtureIds.admin,
    });
    createdWorkflowIds.add(scheduled.id);
    const context = buildContext(scheduled.id);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects basic auth when the expected credentials are not configured', async () => {
    const id = randomUUID();
    jest.spyOn(workflowService, 'findOne').mockResolvedValueOnce({
      id,
      type: WorkflowType.manual,
      webhookTrigger: {
        enabled: true,
        authType: WebhookAuthType.basic,
        username: null,
        passwordCredentialId: null,
      },
    } as any);
    // Empty basic credentials (":") must not match an unset configuration.
    const encoded = Buffer.from(':').toString('base64');
    const context = buildContext(id, {
      authorization: `Basic ${encoded}`,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects header auth when the expected header value is not configured', async () => {
    const id = randomUUID();
    jest.spyOn(workflowService, 'findOne').mockResolvedValueOnce({
      id,
      type: WorkflowType.manual,
      webhookTrigger: {
        enabled: true,
        authType: WebhookAuthType.header,
        headerName: 'X-Webhook-Token',
        headerValueCredentialId: null,
      },
    } as any);
    // A request without the header must not match an unset expected value.
    const context = buildContext(id);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns not found for an unknown workflow', async () => {
    const context = buildContext(randomUUID());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns not found for a malformed workflow id', async () => {
    const context = buildContext('not-a-uuid');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { WebhookAuthType, WebhookJwtAlgorithm } from '@hexabot-ai/types';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JSONSchema7 as JsonSchema } from 'json-schema';

import { CredentialService } from '@/user/services/credential.service';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import {
  installMessagingWorkflowFixturesTypeOrm,
  installScheduledWorkflowFixturesTypeOrm,
} from '@/utils/test/fixtures/workflow';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import type { WebsocketGateway } from '@/websocket/websocket.gateway';
import { conversationalWorkflowInputJsonSchema } from '@/workflow/schemas/workflow-input-schemas';

import { ManualEventWrapper } from '../lib/trigger-event-wrapper';
import { DirectionType, WorkflowType } from '../types';

import { AgenticService } from './agentic.service';
import { WebhookTriggerService } from './webhook-trigger.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowService } from './workflow.service';

describe('WebhookTriggerService (TypeORM)', () => {
  let webhookTriggerService: WebhookTriggerService;
  let workflowService: WorkflowService;
  let agenticService: AgenticService;
  const agenticServiceMock = {
    handleEvent: jest.fn().mockResolvedValue(null),
  } as jest.Mocked<Pick<AgenticService, 'handleEvent'>>;
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
  const credentialStore = new Map<string, string>([
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
      name: `webhook_workflow_${++counter}`,
      description: 'Webhook trigger service test definition',
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
  const createManualWorkflow = async (inputSchema: JsonSchema) => {
    const created = await workflowService.create({
      ...buildWorkflowPayload(),
      type: WorkflowType.manual,
      inputSchema,
      createdBy: userFixtureIds.admin,
    } as any);
    createdWorkflowIds.add(created.id);

    // Re-read to obtain the persisted workflow as the guard would hand it over.
    return (await workflowService.findOne(created.id))!;
  };

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WebhookTriggerService,
        {
          provide: AgenticService,
          useValue: agenticServiceMock,
        },
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
    [webhookTriggerService, workflowService, agenticService] = await getMocks([
      WebhookTriggerService,
      WorkflowService,
      AgenticService,
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

  it('validates the payload, resolves the initiator and dispatches the event', async () => {
    const workflow = await createManualWorkflow({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
    const input = { foo: 'bar' };
    const run = {
      id: randomUUID(),
      status: 'finished',
      output: { result: 'ok' },
      error: null,
    };
    const spy = jest
      .spyOn(agenticService, 'handleEvent')
      .mockResolvedValueOnce(run as any);
    const result = await webhookTriggerService.trigger(workflow.id, input);

    expect(spy).toHaveBeenCalledTimes(1);
    const [eventArg, optionsArg] = spy.mock.calls[0];
    expect(eventArg).toBeInstanceOf(ManualEventWrapper);
    expect(eventArg.buildInput()).toEqual(input);
    expect(eventArg.getInitiator()?.id).toEqual(userFixtureIds.admin);
    expect(eventArg.getWorkflowId()).toEqual(workflow.id);
    expect(optionsArg?.workflow?.id).toEqual(workflow.id);
    expect(result).toEqual({
      runId: run.id,
      status: 'finished',
      output: { result: 'ok' },
      error: null,
    });
  });

  it('throws when no run could be started for the event', async () => {
    const workflow = await createManualWorkflow({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });

    // Default handleEvent mock resolves null (no run created).
    await expect(
      webhookTriggerService.trigger(workflow.id, {}),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a payload that does not match the workflow schema', async () => {
    const workflow = await createManualWorkflow({
      type: 'object',
      properties: { customerId: { type: 'string' } },
      required: ['customerId'],
      additionalProperties: false,
    });

    await expect(
      webhookTriggerService.trigger(workflow.id, { customerId: 42 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(agenticService.handleEvent).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the workflow no longer exists', async () => {
    await expect(
      webhookTriggerService.trigger(randomUUID(), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(agenticService.handleEvent).not.toHaveBeenCalled();
  });

  describe('generateToken', () => {
    const createJwtWebhookWorkflow = async (
      webhookTrigger: Record<string, unknown> | null = {
        enabled: true,
        authType: WebhookAuthType.jwt,
        jwtSecretCredentialId: 'cred-jwt-secret',
        jwtAlgorithm: WebhookJwtAlgorithm.HS256,
      },
    ) => {
      const created = await workflowService.create({
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
      createdWorkflowIds.add(created.id);

      return created;
    };

    it('signs a verifiable permanent token scoped to the workflow', async () => {
      const workflow = await createJwtWebhookWorkflow();
      const { token } = await webhookTriggerService.generateToken(workflow.id);
      const payload = jwtService.verify<{ sub: string; exp?: number }>(token, {
        secret: 'jwt-shared-secret',
        algorithms: ['HS256'],
      });

      expect(payload.sub).toBe(workflow.id);
      // Tokens are permanent: revocation happens by rotating the secret.
      expect(payload.exp).toBeUndefined();
    });

    it('rejects a workflow whose webhook is not JWT-authenticated', async () => {
      const workflow = await createJwtWebhookWorkflow({
        enabled: true,
        authType: WebhookAuthType.none,
      });

      await expect(
        webhookTriggerService.generateToken(workflow.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a workflow whose webhook trigger is disabled', async () => {
      const workflow = await createJwtWebhookWorkflow({
        enabled: false,
        authType: WebhookAuthType.jwt,
        jwtSecretCredentialId: 'cred-jwt-secret',
      });

      await expect(
        webhookTriggerService.generateToken(workflow.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a dangling secret credential reference', async () => {
      const workflow = await createJwtWebhookWorkflow({
        enabled: true,
        authType: WebhookAuthType.jwt,
        jwtSecretCredentialId: 'cred-deleted',
      });

      await expect(
        webhookTriggerService.generateToken(workflow.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for an unknown workflow', async () => {
      await expect(
        webhookTriggerService.generateToken(randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

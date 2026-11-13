/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  Workflow as WorkflowHelper,
  type WorkflowInputSchema,
  WorkflowResumeRejectedError,
} from '@hexabot-ai/agentic';
import { WebhookAuthType, WebhookJwtAlgorithm } from '@hexabot-ai/types';
import {
  BadRequestException,
  ConflictException,
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

import { ManualEventWrapper } from '../lib/trigger-event-wrapper';
import { DirectionType, WorkflowType, WorkflowVersionAction } from '../types';

import { AgenticService } from './agentic.service';
import { WebhookTriggerService } from './webhook-trigger.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowVersionService } from './workflow-version.service';
import { WorkflowService } from './workflow.service';

describe('WebhookTriggerService (TypeORM)', () => {
  let webhookTriggerService: WebhookTriggerService;
  let workflowService: WorkflowService;
  let workflowVersionService: WorkflowVersionService;
  let agenticService: AgenticService;
  const agenticServiceMock = {
    triggerEvent: jest.fn().mockResolvedValue({ status: 'unprocessed' }),
  } as jest.Mocked<Pick<AgenticService, 'triggerEvent'>>;
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
  const createManualWorkflow = async (
    inputSchema: JsonSchema,
    webhookTrigger: Record<string, unknown> | null = null,
  ) => {
    const created = await workflowService.create({
      ...buildWorkflowPayload(),
      type: WorkflowType.manual,
      webhookTrigger,
      createdBy: userFixtureIds.admin,
    } as any);
    createdWorkflowIds.add(created.id);
    // The input of a manual workflow is declared in its definition.
    await workflowVersionService.commit({
      action: WorkflowVersionAction.update,
      workflow: created.id,
      definitionYml: WorkflowHelper.stringifyDefinition({
        defs: {},
        inputs: { schema: inputSchema as WorkflowInputSchema },
        flow: [],
        outputs: {},
      }),
      createdBy: userFixtureIds.admin,
    });

    // Re-read to obtain the persisted workflow as the guard would hand it over.
    return (await workflowService.findOne(created.id))!;
  };

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        WebhookTriggerService,
        WorkflowVersionService,
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
    [
      webhookTriggerService,
      workflowService,
      workflowVersionService,
      agenticService,
    ] = await getMocks([
      WebhookTriggerService,
      WorkflowService,
      WorkflowVersionService,
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
      .spyOn(agenticService, 'triggerEvent')
      .mockResolvedValueOnce({ status: 'dispatched', run: run as any });
    const result = await webhookTriggerService.trigger(workflow.id, input);

    expect(spy).toHaveBeenCalledTimes(1);
    const [eventArg, optionsArg] = spy.mock.calls[0];
    expect(eventArg).toBeInstanceOf(ManualEventWrapper);
    expect(eventArg.buildInput()).toEqual(input);
    expect(eventArg.getInitiator()?.id).toEqual(userFixtureIds.admin);
    expect(eventArg.getWorkflowId()).toEqual(workflow.id);
    expect(optionsArg?.workflow?.id).toEqual(workflow.id);
    expect(optionsArg?.wait).toBe(true);
    expect(result).toEqual({
      runId: run.id,
      status: 'finished',
      output: { result: 'ok' },
      error: null,
    });
  });

  it('answers an asynchronous trigger once the run is started', async () => {
    const workflow = await createManualWorkflow({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
    const run = {
      id: randomUUID(),
      status: 'idle',
      output: null,
      error: null,
    };
    const spy = jest
      .spyOn(agenticService, 'triggerEvent')
      .mockResolvedValueOnce({ status: 'dispatched', run: run as any });
    const result = await webhookTriggerService.trigger(
      workflow.id,
      { foo: 'bar' },
      { async: true },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        workflow: expect.objectContaining({ id: workflow.id }),
        wait: false,
      }),
    );
    expect(result).toEqual({
      runId: run.id,
      status: 'idle',
      output: null,
      error: null,
    });
  });

  it('bounds the wait for the run when asked to', async () => {
    const { id } = await createManualWorkflow({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
    const workflow = (await workflowService.findOneAndPopulate(id))!;
    const run = { id: randomUUID(), status: 'running' };
    const spy = jest
      .spyOn(agenticService, 'triggerEvent')
      .mockResolvedValueOnce({ status: 'dispatched', run: run as any });

    await expect(
      webhookTriggerService.dispatchTriggerEvent(
        workflow,
        new ManualEventWrapper({}, userFixtureIds.admin),
        userFixtureIds.admin,
        { waitTimeoutMs: 5_000 },
      ),
    ).resolves.toBe(run);
    expect(spy.mock.calls[0][1]).toEqual(
      expect.objectContaining({ wait: true, waitTimeoutMs: 5_000 }),
    );
  });

  it.each([
    {
      label: 'without authentication',
      webhookTrigger: { enabled: true, authType: WebhookAuthType.none },
      resume: false,
    },
    {
      label: 'with JWT authentication',
      webhookTrigger: {
        enabled: true,
        authType: WebhookAuthType.jwt,
        jwtSecretCredentialId: 'cred-jwt-secret',
        jwtAlgorithm: WebhookJwtAlgorithm.HS256,
      },
      resume: true,
    },
  ])(
    'lets a call $label resume a suspended run: $resume',
    async ({ webhookTrigger, resume }) => {
      const workflow = await createManualWorkflow(
        { type: 'object', properties: {}, additionalProperties: true },
        webhookTrigger,
      );
      const spy = jest
        .spyOn(agenticService, 'triggerEvent')
        .mockResolvedValueOnce({
          status: 'dispatched',
          run: { id: randomUUID(), status: 'idle' } as any,
        });

      await webhookTriggerService.trigger(workflow.id, {});

      expect(spy.mock.calls[0][1]?.resume).toBe(resume);
    },
  );

  it('throws when no run could be started for the event', async () => {
    const workflow = await createManualWorkflow({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });

    // Default triggerEvent mock reports that no run processed the event.
    await expect(
      webhookTriggerService.trigger(workflow.id, {}),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it.each([false, true])(
    'answers 422 when the suspended run refuses the body (async: %s)',
    async (async) => {
      const workflow = await createManualWorkflow({
        type: 'object',
        properties: {},
        additionalProperties: true,
      });
      const runId = randomUUID();
      const error = new WorkflowResumeRejectedError(
        'Resume payload for wait "ask" was rejected: quantity: Expected number',
        { issues: ['quantity: Expected number'] },
      );
      jest
        .spyOn(agenticService, 'triggerEvent')
        .mockResolvedValueOnce({ status: 'rejected', runId, error });

      const thrown = await webhookTriggerService
        .trigger(workflow.id, { quantity: 'ten' }, { async })
        .catch((reason: unknown) => reason);

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      expect((thrown as UnprocessableEntityException).getResponse()).toEqual({
        statusCode: 422,
        code: 'payload_rejected',
        message: error.message,
        issues: ['quantity: Expected number'],
        runId,
      });
    },
  );

  it('answers 409 when another request resumed the suspended run first', async () => {
    const workflow = await createManualWorkflow({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
    const runId = randomUUID();
    jest
      .spyOn(agenticService, 'triggerEvent')
      .mockResolvedValueOnce({ status: 'claim_lost', runId });

    const thrown = await webhookTriggerService
      .trigger(workflow.id, {})
      .catch((reason: unknown) => reason);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ statusCode: 409, code: 'claim_lost', runId }),
    );
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
    expect(agenticService.triggerEvent).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the workflow no longer exists', async () => {
    await expect(
      webhookTriggerService.trigger(randomUUID(), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(agenticService.triggerEvent).not.toHaveBeenCalled();
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

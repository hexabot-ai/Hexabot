/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WebhookAuthType } from '@hexabot-ai/types';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import request from 'supertest';

import { LoggerService } from '@/logger/logger.service';
import { CredentialService } from '@/user/services/credential.service';
import { buildTestingMocks } from '@/utils/test/utils';
import { WebhookTriggerGuard } from '@/workflow/guards/webhook-trigger.guard';
import { WebhookTriggerService } from '@/workflow/services/webhook-trigger.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { WorkflowType } from '@/workflow/types';

import { ChannelService } from './channel.service';
import { ChannelDownloadService } from './services/channel-download.service';
import { WebhookController } from './webhook.controller';

const triggerResult = {
  runId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  status: 'finished' as const,
  output: { result: 'ok' },
  error: null,
};

describe('WebhookController', () => {
  let controller: WebhookController;
  let channelService: jest.Mocked<Pick<ChannelService, 'handle'>>;
  let channelDownloadService: jest.Mocked<
    Pick<ChannelDownloadService, 'download'>
  >;
  let webhookTriggerService: jest.Mocked<
    Pick<WebhookTriggerService, 'trigger'>
  >;
  let logger: jest.Mocked<Pick<LoggerService, 'log'>>;

  beforeEach(() => {
    channelService = {
      handle: jest.fn().mockResolvedValue(undefined),
    };
    channelDownloadService = {
      download: jest.fn(),
    };
    webhookTriggerService = {
      trigger: jest.fn().mockResolvedValue(triggerResult),
    };
    logger = {
      log: jest.fn(),
    };

    controller = new WebhookController(
      channelService as unknown as ChannelService,
      channelDownloadService as unknown as ChannelDownloadService,
      webhookTriggerService as unknown as WebhookTriggerService,
      logger as unknown as LoggerService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates source requests without workflow id', async () => {
    const sourceRef = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const req = { method: 'POST' } as unknown as Request;
    const res = {} as Response;

    await controller.handlePost(sourceRef, req, res);

    expect(channelService.handle).toHaveBeenCalledWith(
      sourceRef,
      req,
      res,
      undefined,
    );
  });

  it('delegates source requests with explicit workflow id', async () => {
    const sourceRef = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const workflowId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const req = { method: 'POST' } as unknown as Request;
    const res = {} as Response;

    await controller.handlePostWithWorkflow(sourceRef, workflowId, req, res);

    expect(channelService.handle).toHaveBeenCalledWith(
      sourceRef,
      req,
      res,
      workflowId,
    );
  });

  it('forwards the workflow id and the raw body to the trigger service', async () => {
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const input = { foo: 'bar' };
    const result = await controller.trigger(id, input);

    expect(webhookTriggerService.trigger).toHaveBeenCalledWith(id, input);
    expect(result).toEqual(triggerResult);
  });

  it('delegates download requests to channel download service', async () => {
    const sourceRef = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const req = {} as Request;
    channelDownloadService.download.mockResolvedValue('stream' as any);

    const result = await controller.handleDownload(
      sourceRef,
      'file.txt',
      'token',
      req,
    );

    expect(channelDownloadService.download).toHaveBeenCalledWith(
      sourceRef,
      'token',
      req,
    );
    expect(result).toBe('stream');
  });
});

describe('WebhookController (HTTP pipes)', () => {
  let app: INestApplication;
  let channelService: jest.Mocked<Pick<ChannelService, 'handle'>>;
  let channelDownloadService: jest.Mocked<
    Pick<ChannelDownloadService, 'download'>
  >;
  let webhookTriggerService: jest.Mocked<
    Pick<WebhookTriggerService, 'trigger'>
  >;
  let logger: jest.Mocked<Pick<LoggerService, 'log'>>;

  beforeAll(async () => {
    channelService = {
      handle: jest.fn(async (_sourceId, _req, res: Response) => {
        res.status(204).send();
      }),
    };
    channelDownloadService = {
      download: jest.fn(),
    };
    webhookTriggerService = {
      trigger: jest.fn().mockResolvedValue(triggerResult),
    };
    logger = {
      log: jest.fn(),
    };

    // Drive the real guard with a mocked WorkflowService so the trigger route
    // is exercised end-to-end (guard resolution + attachment) without a DB.
    const workflowServiceMock = {
      findOne: jest.fn(async (id: string) => ({
        id,
        type: WorkflowType.manual,
        webhookTrigger: { enabled: true, authType: WebhookAuthType.none },
      })),
    };
    const { module } = await buildTestingMocks({
      controllers: [WebhookController],
      providers: [
        { provide: ChannelService, useValue: channelService },
        { provide: ChannelDownloadService, useValue: channelDownloadService },
        {
          provide: WebhookTriggerService,
          useValue: webhookTriggerService,
        },
        WebhookTriggerGuard,
        { provide: WorkflowService, useValue: workflowServiceMock },
        { provide: JwtService, useValue: new JwtService({}) },
        {
          provide: CredentialService,
          useValue: { findOneValue: jest.fn().mockResolvedValue(null) },
        },
        { provide: LoggerService, useValue: logger },
      ],
    });

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates source references to ChannelService for GET resolution', async () => {
    await request(app.getHttpServer()).get('/webhook/not-a-uuid').expect(204);

    expect(channelService.handle).toHaveBeenCalled();
  });

  it('delegates source references to ChannelService for POST resolution', async () => {
    await request(app.getHttpServer())
      .post('/webhook/not-a-uuid')
      .send({ text: 'hello' })
      .expect(204);

    expect(channelService.handle).toHaveBeenCalled();
  });

  it('routes POST /webhook/:id/trigger to the trigger service, not the catch-all', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const response = await request(app.getHttpServer())
      .post(`/webhook/${id}/trigger`)
      .send({ foo: 'bar' })
      .expect(200);

    expect(webhookTriggerService.trigger).toHaveBeenCalledTimes(1);
    expect(webhookTriggerService.trigger.mock.calls[0][0]).toBe(id);
    expect(webhookTriggerService.trigger.mock.calls[0][1]).toEqual({
      foo: 'bar',
    });
    expect(response.body).toEqual(triggerResult);
    expect(channelService.handle).not.toHaveBeenCalled();
  });

  it('rejects malformed workflow id on GET before controller logic', async () => {
    await request(app.getHttpServer())
      .get('/webhook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/not-a-uuid')
      .expect(404);

    expect(channelService.handle).not.toHaveBeenCalled();
  });

  it('rejects malformed workflow id on POST before controller logic', async () => {
    await request(app.getHttpServer())
      .post('/webhook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/not-a-uuid')
      .send({ text: 'hello' })
      .expect(404);

    expect(channelService.handle).not.toHaveBeenCalled();
  });
});

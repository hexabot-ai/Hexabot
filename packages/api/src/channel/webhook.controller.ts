/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { LoggerService } from '@/logger/logger.service';
import { UuidParam } from '@/utils';
import { Roles } from '@/utils/decorators/roles.decorator';
import { WebhookTriggerGuard } from '@/workflow/guards/webhook-trigger.guard';
import {
  WebhookTriggerService,
  WorkflowTriggerResult,
} from '@/workflow/services/webhook-trigger.service';

import { ChannelService } from './channel.service';
import { ChannelDownloadService } from './services/channel-download.service';

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly channelDownloadService: ChannelDownloadService,
    private readonly webhookTriggerService: WebhookTriggerService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Public webhook endpoint that triggers a manual workflow run.
   *
   * {@link WebhookTriggerGuard} authenticates the request; this handler only
   * forwards the workflow ID and payload to the service. The run executes
   * synchronously and the response carries its final status and output.
   *
   * The whole request body is the workflow input, so third-party services
   * that emit fixed body shapes can call the endpoint directly.
   *
   * Declared before the `:sourceRef/:workflowId` catch-all so `POST
   * /webhook/:id/trigger` is matched first: NestJS registers routes in method
   * definition order and Express 5 resolves overlapping dynamic routes by
   * registration order.
   *
   * @param input - Optional workflow input payload (the request body).
   */
  @Roles('public')
  @UseGuards(WebhookTriggerGuard)
  @Post(':id/trigger')
  @HttpCode(200)
  async trigger(
    @UuidParam('id') id: string,
    @Body() input: unknown = {},
  ): Promise<WorkflowTriggerResult> {
    return await this.webhookTriggerService.trigger(id, input);
  }

  @Roles('public')
  @Get(':sourceRef/download/:name')
  async handleDownload(
    @Param('sourceRef') sourceRef: string,
    @Param('name') name: string,
    @Query('t') token: string,
    @Req() req: Request,
  ) {
    this.logger.log('Channel download request: ', sourceRef, name);

    return await this.channelDownloadService.download(sourceRef, token, req);
  }

  @Roles('public')
  @Get(':sourceRef')
  async handleGet(
    @Param('sourceRef') sourceRef: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return await this.handleSourceRequest(sourceRef, req, res);
  }

  @Roles('public')
  @Get(':sourceRef/not-found')
  async handleNotFound(
    @Param('sourceRef') _sourceRef: string,
    @Res() res: Response,
  ) {
    return res.status(404).send({ error: 'Resource not found!' });
  }

  @Roles('public')
  @Get(':sourceRef/:workflowId')
  async handleGetWithWorkflow(
    @Param('sourceRef') sourceRef: string,
    @UuidParam('workflowId') workflowId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return await this.handleSourceRequest(sourceRef, req, res, workflowId);
  }

  @Roles('public')
  @Post(':sourceRef')
  async handlePost(
    @Param('sourceRef') sourceRef: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return await this.handleSourceRequest(sourceRef, req, res);
  }

  @Roles('public')
  @Post(':sourceRef/:workflowId')
  async handlePostWithWorkflow(
    @Param('sourceRef') sourceRef: string,
    @UuidParam('workflowId') workflowId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return await this.handleSourceRequest(sourceRef, req, res, workflowId);
  }

  private async handleSourceRequest(
    sourceRef: string,
    req: Request,
    res: Response,
    workflowId?: string,
  ): Promise<void> {
    this.logger.log(
      'Channel notification : ',
      req.method,
      sourceRef,
      workflowId,
    );

    return await this.channelService.handle(sourceRef, req, res, workflowId);
  }
}

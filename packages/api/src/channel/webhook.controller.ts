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
  HttpStatus,
  Param,
  ParseBoolPipe,
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
   * forwards the workflow ID and payload to the service. By default the run
   * executes before the response, which carries its final status and output.
   * With `?async=true`, the endpoint answers `202` without waiting for the
   * run, and without its output, for runs longer than the caller (or a proxy
   * in front of the API) can wait. Either way, a body the suspended run it
   * reaches refuses answers `422` (`payload_rejected`).
   *
   * The whole request body is the workflow input, so third-party services
   * that emit fixed body shapes can call the endpoint directly; the flag is
   * therefore a query parameter.
   *
   * Declared before the `:sourceRef/:workflowId` catch-all so `POST
   * /webhook/:id/trigger` is matched first: NestJS registers routes in method
   * definition order and Express 5 resolves overlapping dynamic routes by
   * registration order.
   *
   * @param input - Optional workflow input payload (the request body).
   * @param isAsync - Answer without waiting for the run (`?async=true`).
   */
  @Roles('public')
  @UseGuards(WebhookTriggerGuard)
  @Post(':id/trigger')
  @HttpCode(200)
  async trigger(
    @UuidParam('id') id: string,
    @Body() input: unknown = {},
    @Query('async', new ParseBoolPipe({ optional: true }))
    isAsync: boolean | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkflowTriggerResult> {
    const result = await this.webhookTriggerService.trigger(id, input, {
      async: isAsync,
    });
    if (isAsync) {
      res.status(HttpStatus.ACCEPTED);
    }

    return result;
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

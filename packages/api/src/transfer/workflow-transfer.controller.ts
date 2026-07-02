/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowImportResult } from '@hexabot-ai/types';
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';

import { requireAuthenticatedUserId } from '@/user/utils/authenticated-user';
import { UuidParam } from '@/utils/decorators/uuid-param.decorator';

import { WorkflowTransferService } from './workflow-transfer.service';

@Controller('workflow')
export class WorkflowTransferController {
  constructor(
    private readonly workflowTransferService: WorkflowTransferService,
  ) {}

  /**
   * Imports a workflow bundle YAML file.
   *
   * @param file - Uploaded `.workflow.yml` bundle.
   * @param req - Express request containing the authenticated session.
   *
   * @returns Imported workflow and resource mapping summary.
   */
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importWorkflow(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ): Promise<WorkflowImportResult> {
    const userId = requireAuthenticatedUserId(
      req,
      'Only authenticated users can import workflows',
    );

    if (!file?.buffer) {
      throw new BadRequestException('No workflow bundle file was selected');
    }

    return await this.workflowTransferService.importWorkflow(
      file.buffer.toString('utf-8'),
      userId,
    );
  }

  /**
   * Exports a workflow bundle YAML file.
   *
   * @param id - Workflow identifier.
   * @param res - Express response used to attach download headers.
   *
   * @returns YAML bundle content.
   */
  @Get(':id/export')
  async exportWorkflow(
    @UuidParam('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const exported = await this.workflowTransferService.exportWorkflow(id);

    res.setHeader('Content-Type', 'application/x-yaml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exported.filename}"`,
    );

    return exported.content;
  }
}

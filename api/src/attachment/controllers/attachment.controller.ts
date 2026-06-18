/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  MethodNotAllowedException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { diskStorage, memoryStorage } from 'multer';

import { config } from '@/config';
import { Roles } from '@/utils/decorators/roles.decorator';
import { BaseController } from '@/utils/generics/base-controller';
import { PageQueryDto } from '@/utils/pagination/pagination-query.dto';
import { PageQueryPipe } from '@/utils/pagination/pagination-query.pipe';
import { SearchFilterPipe } from '@/utils/pipes/search-filter.pipe';
import { TFilterQuery } from '@/utils/types/filter.types';

import {
  AttachmentContextParamDto,
  AttachmentDownloadDto,
} from '../dto/attachment.dto';
import { AttachmentGuard } from '../guards/attachment-ability.guard';
import { Attachment } from '../schemas/attachment.schema';
import { AttachmentService } from '../services/attachment.service';
import { AttachmentAccess, AttachmentCreatedByRef } from '../types';

@Controller('attachment')
@UseGuards(AttachmentGuard)
export class AttachmentController extends BaseController<Attachment> {
  constructor(private readonly attachmentService: AttachmentService) {
    super(attachmentService);
  }

  /**
   * Counts the filtered number of attachments.
   *
   * @returns A promise that resolves to an object representing the filtered number of attachments.
   */
  @Get('count')
  async filterCount(
    @Query(
      new SearchFilterPipe<Attachment>({
        allowedFields: ['name', 'type', 'resourceRef'],
      }),
    )
    filters?: TFilterQuery<Attachment>,
  ) {
    return await this.count(filters);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Attachment> {
    const doc = await this.attachmentService.findOne(id);
    if (!doc) {
      this.logger.warn(`Unable to find Attachment by id ${id}`);
      throw new NotFoundException(`Attachment with ID ${id} not found`);
    }
    return doc;
  }

  /**
   * Retrieves all attachments based on specified filters.
   *
   * @param pageQuery - The pagination to apply when retrieving attachments.
   * @param filters - The filters to apply when retrieving attachments.
   * @returns A promise that resolves to an array of attachments matching the filters.
   */
  @Get()
  async findPage(
    @Query(PageQueryPipe) pageQuery: PageQueryDto<Attachment>,
    @Query(
      new SearchFilterPipe<Attachment>({
        allowedFields: ['name', 'type', 'resourceRef'],
      }),
    )
    filters: TFilterQuery<Attachment>,
  ) {
    return await this.attachmentService.find(filters, pageQuery);
  }

  /**
   * Uploads files to the server.
   *
   * @param files - An array of files to upload.
   * @returns A promise that resolves to an array of uploaded attachments.
   */
  @Post('upload')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'file' }], {
      limits: {
        fileSize: config.parameters.maxUploadSize,
      },
      storage: (() => {
        if (config.parameters.storageMode === 'memory') {
          return memoryStorage();
        } else {
          return diskStorage({});
        }
      })(),
    }),
  )
  async uploadFile(
    @UploadedFiles() files: { file: Express.Multer.File[] },
    @Req() req: Request,
    @Query()
    {
      resourceRef,
      access = AttachmentAccess.Public,
    }: AttachmentContextParamDto,
  ): Promise<Attachment[]> {
    if (!files || !Array.isArray(files?.file) || files.file.length === 0) {
      throw new BadRequestException('No file was selected');
    }

    const userId = req.session.passport?.user?.id;
    if (!userId) {
      throw new ForbiddenException(
        'Unexpected Error: Only authenticated users are allowed to upload',
      );
    }

    const attachments: Attachment[] = [];
    for (const file of files.file) {
      const attachment = await this.attachmentService.store(file, {
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        resourceRef,
        access,
        createdBy: userId,
        createdByRef: AttachmentCreatedByRef.User,
      });

      if (attachment) {
        attachments.push(attachment);
      }
    }

    return attachments;
  }

  /**
   * Downloads an attachment identified by the provided parameters.
   *
   * @param  params - The parameters identifying the attachment to download.
   * @returns A promise that resolves to a StreamableFile representing the downloaded attachment.
   */
  @Roles('public')
  @Get(['download/:id', 'download/:id/:filename'])
  async download(
    @Param() params: AttachmentDownloadDto,
  ): Promise<StreamableFile> {
    const attachment = await this.attachmentService.findOne(params.id);

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    return await this.attachmentService.download(attachment);
  }

  /**
   * Deletion of attachments is disallowed to prevent database inconsistencies.
   * Attachments may be referenced by blocks, messages, or content elements,
   * and deleting them directly could lead to orphaned references or broken UI.
   *
   * @param id - The ID of the attachment (not used since deletion is not allowed).
   * @throws MethodNotAllowedException - Always thrown to indicate deletion is not permitted.
   */
  @Delete(':id')
  @HttpCode(405)
  async deleteOne(@Param('id') id: string): Promise<void> {
    // Deletion is explicitly disallowed due to potential reference issues.
    this.logger.warn(`Attempted deletion of attachment ${id} is not allowed.`);
    throw new MethodNotAllowedException(
      'Deletion of attachments is not permitted to avoid data inconsistency.',
    );
  }
}

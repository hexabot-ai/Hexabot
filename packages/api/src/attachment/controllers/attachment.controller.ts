/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Attachment, AttachmentFull } from '@hexabot-ai/types';
import {
  BadRequestException,
  Controller,
  Delete,
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
import { FindManyOptions } from 'typeorm';

import { config } from '@/config';
import { requireAuthenticatedUserId } from '@/user/utils/authenticated-user';
import { PopulatePipe, UuidParam } from '@/utils';
import { Roles } from '@/utils/decorators/roles.decorator';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import {
  AttachmentContextParamDto,
  AttachmentDownloadDto,
} from '../dto/attachment.dto';
import { AttachmentOrmEntity } from '../entities/attachment.entity';
import { AttachmentGuard } from '../guards/attachment-ability.guard';
import { AttachmentService } from '../services/attachment.service';
import { AttachmentAccess, AttachmentCreatedByRef } from '../types';

@Controller('attachment')
@UseGuards(AttachmentGuard)
export class AttachmentController extends BaseOrmController<AttachmentOrmEntity> {
  constructor(protected readonly attachmentService: AttachmentService) {
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
      new TypeOrmSearchFilterPipe<AttachmentOrmEntity>({
        allowedFields: ['name', 'type', 'resourceRef'],
      }),
    )
    options: FindManyOptions<AttachmentOrmEntity> = {},
  ) {
    return this.count(options);
  }

  @Get(':id')
  async findAttachment(
    @Query(PopulatePipe)
    populate: string[],
    @UuidParam('id') id: string,
  ): Promise<Attachment | AttachmentFull> {
    return await this.findOne(id, populate);
  }

  /**
   * Retrieves all attachments based on specified filters.
   *
   * @param options - Combined filters, pagination, and sorting for the query.
   * @returns A promise that resolves to an array of attachments matching the filters.
   */
  @Get()
  async findAttachments(
    @Query(PopulatePipe)
    populate: string[],
    @Query(
      new TypeOrmSearchFilterPipe<AttachmentOrmEntity>({
        allowedFields: ['name', 'type', 'resourceRef'],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<AttachmentOrmEntity>,
  ) {
    return await this.find(options, populate);
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

    const userId = requireAuthenticatedUserId(
      req,
      'Unexpected Error: Only authenticated users are allowed to upload',
    );
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
   * @param id - Identifier of the attachment to download.
   * @param _params - Optional params containing filename constraints.
   * @returns A promise that resolves to a StreamableFile representing the downloaded attachment.
   */
  @Roles('public')
  @Get('download/:id{/:filename}')
  async download(
    @UuidParam('id') id: string,
    @Param() _params: AttachmentDownloadDto,
  ): Promise<StreamableFile> {
    const attachment = await this.attachmentService.findOne(id);

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    return await this.attachmentService.download(attachment);
  }

  /**
   * Deletion of attachments is disallowed to prevent database inconsistencies.
   * Attachments may be referenced by actions, messages, or content elements,
   * and deleting them directly could lead to orphaned references or broken UI.
   *
   * @param id - The ID of the attachment (not used since deletion is not allowed).
   * @throws MethodNotAllowedException - Always thrown to indicate deletion is not permitted.
   */
  @Delete(':id')
  @HttpCode(405)
  async deleteAttachment(@UuidParam('id') id: string): Promise<void> {
    // Deletion is explicitly disallowed due to potential reference issues.
    this.logger.warn(`Attempted deletion of attachment ${id} is not allowed.`);
    throw new MethodNotAllowedException(
      'Deletion of attachments is not permitted to avoid data inconsistency.',
    );
  }
}

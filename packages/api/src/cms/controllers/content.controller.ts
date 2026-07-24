/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Content } from '@hexabot-ai/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FindManyOptions } from 'typeorm';

import { UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import { ContentCreateDto, ContentUpdateDto } from '../dto/content.dto';
import { ContentOrmEntity } from '../entities/content.entity';
import { RagService } from '../services/rag.service';
import { RagHit, RagQueryOptions } from '../types/rag';

import { ContentTypeService } from './../services/content-type.service';
import { ContentService } from './../services/content.service';

@Controller('content')
export class ContentController extends BaseOrmController<ContentOrmEntity> {
  constructor(
    protected readonly contentService: ContentService,
    private readonly contentTypeService: ContentTypeService,
    private readonly ragService: RagService,
  ) {
    super(contentService);
  }

  /**
   * Schedules reconciliation of the configured RAG helper.
   */
  @Post('rag/reindex')
  @HttpCode(202)
  reindexRag(): { accepted: true } {
    this.ragService.scheduleReindexAll();

    return { accepted: true };
  }

  /**
   * Creates new content based on the provided DTO, filtering content properties to match
   * the associated content type before persisting it.
   *
   * @param contentDto - The DTO containing the content data to be created.
   *
   * @returns The created content record.
   */
  @Post()
  async create(@Body() contentDto: ContentCreateDto): Promise<Content> {
    return await this.contentService.create(contentDto);
  }

  /**
   * Imports content from a CSV file based on the provided content type and file ID.
   *
   * @param idTargetContentType - The content type to match the CSV data against.   *
   * @returns A promise that resolves to the newly created content records.
   */
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('idTargetContentType')
    targetContentType: string,
  ) {
    const datasetContent = file.buffer.toString('utf-8');
    if (!targetContentType) {
      this.logger.warn(`Parameter is missing`);
      throw new NotFoundException(`Missing parameter`);
    }
    const contentType =
      await this.contentTypeService.findOne(targetContentType);
    if (!contentType) {
      this.logger.warn(
        `Failed to fetch content type with id ${targetContentType}. Content type not found.`,
      );
      throw new NotFoundException(`Content type is not found`);
    }

    return await this.contentService.parseAndSaveDataset(
      datasetContent,
      contentType,
    );
  }

  /**
   * Executes a RAG search query for content.
   *
   * @param query - Search query text.
   *
   * @returns Ranked matching content hits.
   */
  @Get('rag/search')
  async searchRag(
    @Query('query') query: string,
    @Query('limit') limit?: string,
    @Query('contentTypeId') contentTypeId?: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<RagHit[]> {
    const parsedLimit =
      typeof limit === 'string' && limit.trim() !== ''
        ? Number.parseInt(limit, 10)
        : undefined;
    const parsedIncludeInactive =
      includeInactive === undefined
        ? undefined
        : includeInactive.toLowerCase() === 'true' || includeInactive === '1';
    const options: RagQueryOptions = {
      ...(Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
      ...(contentTypeId ? { contentTypeId } : {}),
      ...(includeInactive === undefined
        ? {}
        : { includeInactive: parsedIncludeInactive }),
    };

    return await this.contentService.retrieve(query, options);
  }

  /**
   * Retrieves content based on query options with optional population of related entities.
   *
   * @param populate - Fields to populate in the query.
   * @param options - Combined filters, pagination, and sorting for the query.
   *
   * @returns Content list.
   */
  @Get()
  async findContents(
    @Query(PopulatePipe) populate: string[],
    @Query(
      new TypeOrmSearchFilterPipe<ContentOrmEntity>({
        allowedFields: ['contentType.id', 'title'],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<ContentOrmEntity>,
  ) {
    return await this.find(options, populate);
  }

  /**
   * Counts the filtered number of contents based on the provided options.
   *
   * @param options - Filters applied to the count query.
   *
   * @returns The count of content matching the filters.
   */
  @Get('count')
  async filterCount(
    @Query(
      new TypeOrmSearchFilterPipe<ContentOrmEntity>({
        allowedFields: ['contentType.id', 'title'],
      }),
    )
    options: FindManyOptions<ContentOrmEntity> = {},
  ) {
    return this.count(options);
  }

  /**
   * Retrieves a single content by ID, with optional population of related entities.
   *
   * @param id - The ID of the content to retrieve.
   * @param populate - Fields to populate in the query.
   *
   * @returns The requested content record.
   */
  @Get(':id')
  async findContent(
    @UuidParam('id') id: string,
    @Query(PopulatePipe) populate: string[],
  ) {
    const content = await this.findOne(id, populate);

    if (!content) {
      this.logger.warn(
        `Failed to fetch content with id ${id}. Content not found.`,
      );
      throw new NotFoundException(`Content of id ${id} not found`);
    }

    return content;
  }

  /**
   * Deletes a content record by ID.
   *
   * @param id - The ID of the content to delete.
   *
   * @returns The result of the delete operation.
   */
  @Delete(':id')
  @HttpCode(204)
  async deleteContent(@UuidParam('id') id: string) {
    return await this.deleteOne(id);
  }

  /**
   * Retrieves content based on content type ID with optional pagination.
   *
   * @param contentTypeId - The content type ID to filter by.
   * @param options - Query options applied to the lookup.
   *
   * @returns List of content records matching the content type.
   */
  @Get('/type/:id')
  async findByType(
    @UuidParam('id') contentTypeId: string,
    @Query(
      new TypeOrmSearchFilterPipe<ContentOrmEntity>({
        allowedFields: [],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<ContentOrmEntity>,
  ): Promise<Content[]> {
    const type = await this.contentTypeService.findOne(contentTypeId);
    if (!type) {
      this.logger.warn(
        `Failed to find content with contentType ${contentTypeId}. ContentType not found.`,
      );
      throw new NotFoundException(
        `ContentType of id ${contentTypeId} not found`,
      );
    }

    return await this.contentService.find({
      ...options,
      where: {
        ...(options?.where ?? {}),
        contentType: { id: contentTypeId },
      },
    });
  }

  /**
   * Updates a content record by ID, after filtering content properties to match the associated content type.
   *
   * @param contentDto - The DTO containing the updated content data.
   * @param id - The ID of the content to update.
   *
   * @returns The updated content record.
   */
  @Patch(':id')
  async updateOne(
    @Body() contentDto: ContentUpdateDto,
    @UuidParam('id') id: string,
  ): Promise<Content> {
    return await this.contentService.updateOne(id, contentDto);
  }
}

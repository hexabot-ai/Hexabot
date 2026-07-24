/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ContentFull,
  ContentType,
  StdOutgoingListMessageData,
  ContentOptions,
} from '@hexabot-ai/types';
import { BadRequestException, Injectable } from '@nestjs/common';
import Papa from 'papaparse';
import { FindManyOptions, FindOptionsWhere } from 'typeorm';

import { HelperService } from '@/helper/helper.service';
import { HelperType } from '@/helper/types';
import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { ContentCreateDto } from '../dto/content.dto';
import { ContentOrmEntity } from '../entities/content.entity';
import { RagHelperConfigurationError } from '../errors/rag.errors';
import { ContentRepository } from '../repositories/content.repository';
import { RagHit, RagQueryOptions } from '../types/rag';

@Injectable()
export class ContentService extends BaseOrmService<ContentOrmEntity> {
  constructor(
    readonly repository: ContentRepository,
    private readonly helperService: HelperService,
  ) {
    super(repository);
  }

  /**
   * Retrieves RAG hits for the provided query using the configured default RAG
   * helper (lexical full-text search by default).
   *
   * @param query - User query text.
   * @param options - Optional retrieval options.
   *
   * @returns Matching RAG hits.
   */
  async retrieve(
    query: string,
    options: RagQueryOptions = {},
  ): Promise<RagHit[]> {
    let helper;
    try {
      helper = await this.helperService.getDefaultHelper(HelperType.RAG);
    } catch (error) {
      const reason = error instanceof Error ? ` ${error.message}` : '';
      throw new RagHelperConfigurationError(
        `The configured default RAG helper is unavailable.${reason}`,
      );
    }

    return await helper.retrieve(query, options);
  }

  /**
   * Performs a text search on the content repository.
   *
   * @param query - The text query to search for.
   * @param options - Optional filtering options.
   *
   * @return A list of content matching the search query.
   */
  async textSearch(
    query: string,
    options?: {
      status?: boolean;
      contentTypeId?: string;
      limit?: number;
    },
  ): Promise<ContentFull[]> {
    return await this.repository.textSearch(query, options);
  }

  /**
   * Retrieves content based on the provided options and pagination settings.
   *
   * @param options - Options that define how content should be fetched.
   * @param skip - Pagination offset, indicating the number of records to skip.
   *
   * @return The content with pagination info, or undefined if none found.
   */
  async getContent(
    options: ContentOptions,
    skip: number,
  ): Promise<Omit<StdOutgoingListMessageData, 'options'>> {
    const where: FindOptionsWhere<ContentOrmEntity> = {
      status: true,
      ...(options.query as FindOptionsWhere<ContentOrmEntity> | undefined),
    };
    const limit = options.limit;

    if (typeof options.contentType === 'string') {
      where.contentType = {
        id: options.contentType,
      };
    }

    try {
      const countOptions: FindManyOptions<ContentOrmEntity> = { where };
      const total = await this.count(countOptions);

      if (total === 0) {
        this.logger.warn('No content found', where);
        throw new Error('No content found');
      }

      try {
        const findOptions: FindManyOptions<ContentOrmEntity> = {
          where,
          skip,
          take: limit,
          order: { createdAt: 'DESC' },
        };
        const contents = await this.find(findOptions);
        const elements = contents.map(ContentOrmEntity.toElement);

        return {
          elements,
          pagination: {
            total,
            skip,
            limit,
          },
        };
      } catch (err) {
        this.logger.error('Unable to retrieve content', err, where);
        throw err;
      }
    } catch (err) {
      this.logger.error('Unable to count content', err, where);
      throw err;
    }
  }

  /**
   * Parses a CSV dataset and saves the content in the repository.
   *
   * @param data - The CSV data as a string to be parsed.
   * @param contentType - The content type metadata, including properties to validate the parsed data.
   * @return A promise resolving to the created content objects.
   */
  async parseAndSaveDataset(data: string, contentType: ContentType) {
    // Parse local CSV file
    const result: {
      errors: any[];
      data: Array<Record<string, string>>;
    } = Papa.parse(data, {
      header: true,
      skipEmptyLines: true,
    });

    if (result.errors && result.errors.length > 0) {
      this.logger.warn(
        `Errors parsing the file: ${JSON.stringify(result.errors)}`,
      );
      throw new BadRequestException(result.errors, {
        cause: result.errors,
        description: 'Error while parsing CSV',
      });
    }
    if (!result.data.every((row) => row.title && row.status)) {
      throw new BadRequestException(
        'Missing required fields: "title" or "status"',
        {
          cause: 'Invalid CSV data',
          description: 'CSV must include "title" and "status" columns',
        },
      );
    }

    const contentsDto = result.data.reduce(
      (acc, { title, status, ...rest }) => [
        ...acc,
        {
          title: String(title),
          status: status.trim().toLowerCase() === 'true',
          contentType: contentType.id,
          properties: Object.keys(rest)
            .filter((key) =>
              Object.entries(contentType.schema.properties || {})
                ?.map(([key]) => key)
                .includes(key),
            )
            .reduce(
              (filtered, key) => ({ ...filtered, [key]: rest[key] }),
              {} as Record<string, string>,
            ),
        } satisfies ContentCreateDto,
      ],
      [] as ContentCreateDto[],
    );
    this.logger.log(`Parsed ${result.data.length} rows from CSV.`);
    try {
      return await this.createMany(contentsDto);
    } catch (err) {
      this.logger.error('Error occurred when extracting data. ', err);
    }
  }
}

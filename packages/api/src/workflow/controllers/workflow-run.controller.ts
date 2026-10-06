/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowRun, WorkflowRunFull } from '@hexabot-ai/types';
import { Controller, Get, Query } from '@nestjs/common';
import { FindManyOptions } from 'typeorm';

import { UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import { WorkflowRunService } from '../services/workflow-run.service';

@Controller('workflowrun')
export class WorkflowRunController extends BaseOrmController<WorkflowRunOrmEntity> {
  constructor(private readonly workflowRunService: WorkflowRunService) {
    super(workflowRunService);
  }

  /**
   * Retrieves workflow runs matching the provided filters.
   *
   * @param options - Combined filters, pagination, and sorting for the query.
   * @param populate - Relations to populate when supported.
   *
   * @returns Workflow runs that satisfy the provided options.
   */
  @Get()
  async findWorkflowRuns(
    @Query(
      new TypeOrmSearchFilterPipe<WorkflowRunOrmEntity>({
        allowedFields: [
          'workflow.id',
          'workflow.name',
          'workflow.type',
          'workflowVersion.id',
          'workflowVersion.version',
          'triggeredBy.id',
          'thread.id',
          'parentRun.id',
          'status',
          'error',
        ],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<WorkflowRunOrmEntity> = {},
    @Query(PopulatePipe)
    populate: string[] = [],
  ): Promise<WorkflowRun[] | WorkflowRunFull[]> {
    return await this.find(options, populate);
  }

  /**
   * Counts the number of workflow runs matching the provided filters.
   *
   * @param options - Filters applied to the count query.
   *
   * @returns The count of workflow runs matching the filters.
   */
  @Get('count')
  async filterCount(
    @Query(
      new TypeOrmSearchFilterPipe<WorkflowRunOrmEntity>({
        allowedFields: [
          'workflow.id',
          'workflow.name',
          'workflow.type',
          'workflowVersion.id',
          'workflowVersion.version',
          'triggeredBy.id',
          'thread.id',
          'parentRun.id',
          'status',
          'error',
        ],
      }),
    )
    options: FindManyOptions<WorkflowRunOrmEntity> = {},
  ) {
    return await this.count(options);
  }

  /**
   * Retrieves a workflow run by its identifier.
   *
   * @param id - The workflow run ID.
   * @param populate - Relations to populate when supported.
   *
   * @returns The workflow run matching the provided ID.
   */
  @Get(':id')
  async findWorkflowRun(
    @UuidParam('id') id: string,
    @Query(PopulatePipe)
    populate: string[] = [],
  ): Promise<WorkflowRun | WorkflowRunFull> {
    return await this.findOne(id, populate);
  }
}

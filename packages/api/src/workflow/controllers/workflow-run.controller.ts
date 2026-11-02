/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowRun, WorkflowRunFull } from '@hexabot-ai/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { FindManyOptions } from 'typeorm';

import { AuditWorkflowRunOperation } from '@/audit/decorators/audit-log.decorators';
import { UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import {
  WorkflowRunCancelDto,
  WorkflowRunDecisionDto,
  WorkflowRunResumeDto,
} from '../dto/workflow-run-operator.dto';
import { WorkflowRunOrmEntity } from '../entities/workflow-run.entity';
import {
  OperatorActor,
  toOperatorActor,
} from '../schemas/operator-wait-schemas';
import { WorkflowRunOperatorService } from '../services/workflow-run-operator.service';
import { WorkflowRunService } from '../services/workflow-run.service';

@Controller('workflowrun')
export class WorkflowRunController extends BaseOrmController<WorkflowRunOrmEntity> {
  constructor(
    private readonly workflowRunService: WorkflowRunService,
    private readonly workflowRunOperatorService: WorkflowRunOperatorService,
  ) {
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
   * Retrieves the runs waiting on an admin: suspended runs with an open
   * `await_approval` or `suspend_workflow` wait, latest suspension first.
   *
   * @param options - Combined filters, pagination, and sorting for the query.
   * @param populate - Relations to populate when supported.
   *
   * @returns Workflow runs waiting on an admin.
   */
  @Get('pending')
  async findPendingWorkflowRuns(
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
        ],
        defaultSort: ['suspendedAt', 'desc'],
      }),
    )
    options: FindManyOptions<WorkflowRunOrmEntity> = {},
    @Query(PopulatePipe)
    populate: string[] = [],
  ): Promise<WorkflowRun[] | WorkflowRunFull[]> {
    return await this.find(
      this.workflowRunService.withAwaitingOperatorScope(options),
      populate,
    );
  }

  /**
   * Counts the runs waiting on an admin.
   *
   * @param options - Filters applied to the count query.
   *
   * @returns The count of workflow runs waiting on an admin.
   */
  @Get('pending/count')
  async filterPendingCount(
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
        ],
      }),
    )
    options: FindManyOptions<WorkflowRunOrmEntity> = {},
  ) {
    return await this.count(
      this.workflowRunService.withAwaitingOperatorScope(options),
    );
  }

  /**
   * Approves an `await_approval` wait of a suspended run, then lets the run
   * go on.
   *
   * @param id - The workflow run ID.
   * @param body - Wait to approve (optional with a single approval wait) and
   * an optional comment.
   *
   * @returns `202` with the run once claimed (`running`). The rest of the
   * run goes on in the background, since it may last longer than a request;
   * the run's updates report whether it waits again, finishes or fails.
   */
  @Patch(':id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuditWorkflowRunOperation('approve')
  async approve(
    @UuidParam('id') id: string,
    @Body() body: WorkflowRunDecisionDto,
    @Req() req: Request,
  ): Promise<WorkflowRunFull> {
    return await this.workflowRunOperatorService.decide(
      id,
      'approved',
      body,
      this.getActor(req),
    );
  }

  /**
   * Rejects an `await_approval` wait of a suspended run. The step's
   * `on_reject` setting decides whether the run goes on or fails.
   *
   * @param id - The workflow run ID.
   * @param body - Wait to reject (optional with a single approval wait) and
   * an optional comment.
   *
   * @returns `202` with the run once claimed (`running`). The rest of the
   * run goes on in the background, since it may last longer than a request;
   * the run's updates report whether it waits again, finishes or fails.
   */
  @Patch(':id/reject')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuditWorkflowRunOperation('reject')
  async reject(
    @UuidParam('id') id: string,
    @Body() body: WorkflowRunDecisionDto,
    @Req() req: Request,
  ): Promise<WorkflowRunFull> {
    return await this.workflowRunOperatorService.decide(
      id,
      'rejected',
      body,
      this.getActor(req),
    );
  }

  /**
   * Resumes a `suspend_workflow` wait of a suspended run with data.
   *
   * @param id - The workflow run ID.
   * @param body - Wait to resume (optional with a single resume wait) and the
   * data passed on to the workflow.
   *
   * @returns `202` with the run once claimed (`running`). The rest of the
   * run goes on in the background, since it may last longer than a request;
   * the run's updates report whether it waits again, finishes or fails.
   */
  @Patch(':id/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuditWorkflowRunOperation('resume')
  async resume(
    @UuidParam('id') id: string,
    @Body() body: WorkflowRunResumeDto,
    @Req() req: Request,
  ): Promise<WorkflowRunFull> {
    return await this.workflowRunOperatorService.resume(
      id,
      body,
      this.getActor(req),
    );
  }

  /**
   * Cancels a suspended run, whatever it waits on: the run and its suspended
   * descendants fail, and a waiting parent receives a failed result.
   *
   * @param id - The workflow run ID.
   * @param body - Optional reason stored on the run.
   *
   * @returns The failed run. A waiting parent receives the failed result in
   * the background.
   */
  @Patch(':id/cancel')
  @AuditWorkflowRunOperation('cancel')
  async cancel(
    @UuidParam('id') id: string,
    @Body() body: WorkflowRunCancelDto,
    @Req() req: Request,
  ): Promise<WorkflowRunFull> {
    return await this.workflowRunOperatorService.cancel(
      id,
      body,
      this.getActor(req),
    );
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

  /**
   * Describe the authenticated admin performing an operation.
   */
  private getActor(req: Request): OperatorActor {
    const user = req.session?.passport?.user;
    if (!user?.id) {
      throw new UnauthorizedException(
        'Only authenticated users can resolve workflow runs',
      );
    }

    return toOperatorActor({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
    });
  }
}

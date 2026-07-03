/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Workflow, WorkflowFull } from '@hexabot-ai/types';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { I18nContext } from 'nestjs-i18n';
import { FindManyOptions } from 'typeorm';
import { DeleteResult } from 'typeorm/driver/mongodb/typings';

import { ActionService } from '@/actions/actions.service';
import { I18nService } from '@/i18n/services/i18n.service';
import { UuidParam } from '@/utils/decorators/uuid-param.decorator';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import { RuntimeBindingsService } from '../../bindings/runtime-bindings.service';
import { WorkflowCreateDto, WorkflowUpdateDto } from '../dto/workflow.dto';
import { WorkflowOrmEntity } from '../entities/workflow.entity';
import {
  ManualEventWrapper,
  ScheduledEventWrapper,
} from '../lib/trigger-event-wrapper';
import { WebhookTriggerService } from '../services/webhook-trigger.service';
import { WorkflowService } from '../services/workflow.service';
import { WorkflowType } from '../types';

@Controller('workflow')
export class WorkflowController extends BaseOrmController<WorkflowOrmEntity> {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly webhookTriggerService: WebhookTriggerService,
    private readonly actionService: ActionService,
    private readonly runtimeBindingsService: RuntimeBindingsService,
    private readonly i18nService: I18nService,
  ) {
    super(workflowService);
  }

  /**
   * Creates a new workflow.
   *
   * @param workflowCreateDto - Workflow properties object to persist.
   *
   * @returns The newly created workflow.
   */
  @Post()
  async create(
    @Body() workflowCreateDto: WorkflowCreateDto,
    @Req() req: Request,
  ): Promise<Workflow> {
    const userId = req.session?.passport?.user?.id;

    if (!userId) {
      throw new UnauthorizedException(
        'Only authenticated users can create workflows',
      );
    }

    return await this.workflowService.create({
      ...workflowCreateDto,
      createdBy: userId,
    });
  }

  /**
   * Retrieves workflows matching the provided filters.
   *
   * @param options - Combined filters, pagination, and sorting for the query.
   *
   * @returns Workflows that satisfy the provided options.
   */
  @Get()
  async findWorkflows(
    @Query(
      new TypeOrmSearchFilterPipe<WorkflowOrmEntity>({
        allowedFields: [
          'name',
          'description',
          'type',
          'schedule',
          'createdBy.id',
        ],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<WorkflowOrmEntity> = {},
    @Query(PopulatePipe)
    populate: string[] = [],
  ) {
    return await this.find(options, populate);
  }

  /**
   * Retrieves actions with JSON schemas for input, output, and settings,
   * optionally filtered by workflow type.
   *
   * @param type - Optional workflow type to filter actions.
   *
   * @returns Action metadata with JSON schemas.
   */
  @Get('actions{/:type}')
  findActions(@Param('type') type?: WorkflowType | undefined) {
    if (type && !Object.values(WorkflowType).includes(type)) {
      throw new BadRequestException(`Invalid workflow type "${type}"`);
    }

    const lang = I18nContext.current()?.lang;
    const actions = this.actionService.getAllSchemaDefinitions(type);

    return actions.map((action) => {
      const namespace = action.name;

      return {
        ...action,
        description: this.i18nService.t(action.description, {
          ns: namespace,
          ...(lang ? { lang } : {}),
          defaultValue: action.description,
        }),
      };
    });
  }

  /**
   * Retrieves runtime bindings with Draft-07 JSON schemas.
   *
   * @returns Runtime bindings metadata with JSON schemas.
   */
  @Get('bindings')
  findBindings() {
    return this.runtimeBindingsService.getAllSchemaDefinitions();
  }

  /**
   * Finds a single workflow by its identifier.
   *
   * @param id - The workflow ID.
   *
   * @returns The workflow matching the provided ID.
   */
  @Get(':id')
  async findWorkflow(
    @UuidParam('id') id: string,
    @Query(PopulatePipe)
    populate: string[] = [],
  ): Promise<Workflow | WorkflowFull> {
    return await this.findOne(id, populate);
  }

  /**
   * Updates an existing workflow definition.
   *
   * @param id - The workflow ID to update.
   * @param workflowUpdateDto - Partial workflow attributes (including definition) to apply.
   *
   * @returns The updated workflow definition.
   */
  @Patch(':id')
  async updateOne(
    @UuidParam('id') id: string,
    @Body() workflowUpdateDto: WorkflowUpdateDto,
  ): Promise<Workflow> {
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to update Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    return await this.workflowService.updateOne(id, workflowUpdateDto);
  }

  /**
   * Deletes a workflow definition.
   *
   * @param id - The workflow ID to delete.
   *
   * @returns Deletion result indicating how many records were removed.
   */
  @Delete(':id')
  @HttpCode(204)
  async deleteWorkflow(@UuidParam('id') id: string): Promise<DeleteResult> {
    return await this.deleteOne(id);
  }

  /**
   * Publishes the current workflow version.
   *
   * @param id - The workflow ID.
   * @param req - Express request containing the authenticated session.
   *
   * @returns The updated workflow with publishedVersion set to currentVersion.
   */
  @Post(':id/publish')
  async publish(
    @UuidParam('id') id: string,
    @Req() req: Request,
  ): Promise<Workflow> {
    const userId = req.session?.passport?.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Only authenticated users can publish workflows',
      );
    }

    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to publish Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    if (!workflow.currentVersion) {
      throw new BadRequestException(
        'Workflow must have a current version to be published',
      );
    }

    return await this.workflowService.updateOne(id, {
      publishedVersion: workflow.currentVersion,
    });
  }

  /**
   * Unpublishes a workflow.
   *
   * @param id - The workflow ID.
   * @param req - Express request containing the authenticated session.
   *
   * @returns The updated workflow with publishedVersion cleared.
   */
  @Post(':id/unpublish')
  async unpublish(
    @UuidParam('id') id: string,
    @Req() req: Request,
  ): Promise<Workflow> {
    const userId = req.session?.passport?.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Only authenticated users can unpublish workflows',
      );
    }

    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to unpublish Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    const updated = await this.workflowService.updateOne(id, {
      publishedVersion: null,
    });

    return {
      ...updated,
      currentVersion: updated.currentVersion ?? workflow.currentVersion,
      publishedVersion: null,
    };
  }

  /**
   * Manually triggers a workflow run for manual or scheduled workflows.
   *
   * @param id - The workflow ID to execute.
   * @param input - Optional workflow input payload (manual workflows only).
   * @param req - Express request containing the authenticated session.
   */
  @Post(':id/run')
  @HttpCode(202)
  async runManually(
    @UuidParam('id') id: string,
    @Body('input') input: unknown = {},
    @Req() req: Request,
  ): Promise<{ accepted: true }> {
    const userId = req.session?.passport?.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Only authenticated users can run workflows manually',
      );
    }

    const workflow = await this.workflowService.findOneAndPopulate(id);
    if (!workflow) {
      this.logger.warn(`Unable to run Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    if (
      workflow.type !== WorkflowType.manual &&
      workflow.type !== WorkflowType.scheduled
    ) {
      throw new BadRequestException(
        'Workflow must be manual or scheduled to run manually',
      );
    }

    const manualInput =
      workflow.type === WorkflowType.manual
        ? this.workflowService.validateManualInput(
            input ?? {},
            workflow.inputSchema,
          )
        : {};
    const event =
      workflow.type === WorkflowType.scheduled
        ? new ScheduledEventWrapper({
            schedule: workflow.schedule ?? null,
            triggeredAt: new Date(),
          })
        : new ManualEventWrapper(manualInput, userId);

    await this.webhookTriggerService.dispatchTriggerEvent(
      workflow,
      event,
      userId,
    );

    return { accepted: true };
  }
}

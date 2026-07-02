/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowVersion } from '@hexabot-ai/types';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { FindManyOptions } from 'typeorm';

import { requireAuthenticatedUserId } from '@/user/utils/authenticated-user';
import { TypeOrmSearchFilterPipe, UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';

import {
  WorkflowNewVersionDto,
  WorkflowVersionUpdateDto,
} from '../dto/workflow-version.dto';
import { WorkflowVersionOrmEntity } from '../entities/workflow-version.entity';
import { WorkflowVersionService } from '../services/workflow-version.service';
import { WorkflowService } from '../services/workflow.service';
import { WorkflowVersionAction } from '../types';

@Controller('workflow')
export class WorkflowVersionController extends BaseOrmController<WorkflowVersionOrmEntity> {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowVersionService: WorkflowVersionService,
  ) {
    super(workflowVersionService);
  }

  /**
   * Counts the versions.
   *
   * @returns A promise that resolves to an object representing the total number of versions.
   */
  @Get(':id/versions/count')
  async countAll(@UuidParam('id') id: string) {
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to find Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    return await this.count({ where: { workflow: { id } } });
  }

  /**
   * Creates a new workflow definition version.
   *
   * @param dto - Workflow definition version object to persist.
   *
   * @returns The newly created workflow.
   */
  @Post(':id/versions')
  async commit(
    @UuidParam('id') id: string,
    @Body() dto: WorkflowNewVersionDto,
    @Req() req: Request,
  ): Promise<WorkflowVersion> {
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to find Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }
    const userId = requireAuthenticatedUserId(
      req,
      'Only authenticated users can create workflows',
    );

    if (dto.action === WorkflowVersionAction.restore) {
      if (!dto.parentVersion) {
        throw new UnauthorizedException('Parent version must be supplied ');
      }

      return await this.workflowVersionService.restoreVersion(
        id,
        dto.parentVersion,
        {
          updatedBy: userId,
          message: dto?.message ?? null,
        },
      );
    }

    return await this.workflowVersionService.commit({
      ...dto,
      workflow: id,
      parentVersion: workflow.currentVersion,
      createdBy: userId,
    });
  }

  /**
   * Retrieves versions for a workflow.
   *
   * @param id - The workflow ID.
   */
  @Get(':id/versions')
  async findWorkflowVersions(
    @UuidParam('id') id: string,
    @Query(
      new TypeOrmSearchFilterPipe<WorkflowVersionOrmEntity>({
        allowedFields: ['message', 'action'],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<WorkflowVersionOrmEntity> = {},
    @Query(PopulatePipe)
    populate: string[] = [],
  ) {
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to find Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    return await this.find(
      {
        ...(options ?? {}),
        where: {
          ...(options.where ?? {}),
          workflow: { id },
        },
      },
      populate,
    );
  }

  /**
   * Retrieves a specific workflow version.
   *
   * @param id - The workflow ID.
   * @param versionId - The version identifier.
   */
  @Get(':id/versions/:versionId')
  async findWorkflowVersion(
    @UuidParam('id') id: string,
    @UuidParam('versionId') versionId: string,
    @Query(PopulatePipe)
    populate: string[] = [],
  ) {
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to find Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    return await this.findOne(versionId, populate);
  }

  /**
   * Updates metadata of a specific workflow version.
   *
   * @param id - The workflow ID.
   * @param versionId - The version identifier.
   * @param dto - Updatable version metadata payload.
   */
  @Patch(':id/versions/:versionId')
  async updateOne(
    @UuidParam('id') id: string,
    @UuidParam('versionId') versionId: string,
    @Body() dto: WorkflowVersionUpdateDto,
  ): Promise<WorkflowVersion> {
    const workflow = await this.workflowService.findOne(id);
    if (!workflow) {
      this.logger.warn(`Unable to find Workflow by id ${id}`);
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    const version = await this.workflowVersionService.findOne({
      where: {
        id: versionId,
        workflow: { id },
      },
    });
    if (!version) {
      throw new NotFoundException(
        `Workflow version with ID ${versionId} not found`,
      );
    }

    return await this.workflowVersionService.updateOne(versionId, dto);
  }
}

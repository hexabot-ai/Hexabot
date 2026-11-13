/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { validateWorkflow } from '@hexabot-ai/agentic';
import { WorkflowVersion } from '@hexabot-ai/types';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { ActionService } from '@/actions/actions.service';
import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { WorkflowNewVersionDto } from '../dto/workflow-version.dto';
import { WorkflowVersionOrmEntity } from '../entities/workflow-version.entity';
import { WorkflowOrmEntity } from '../entities/workflow.entity';
import {
  assertInputsDeclarable,
  assertTaskActionsSupported,
} from '../lib/workflow-definition';
import { WorkflowVersionRepository } from '../repositories/workflow-version.repository';
import { WorkflowType, WorkflowVersionAction } from '../types';

import { WorkflowService } from './workflow.service';

@Injectable()
export class WorkflowVersionService extends BaseOrmService<WorkflowVersionOrmEntity> {
  /**
   * Create the service with a workflow version repository.
   * @param repository Repository for workflow version entities.
   */
  constructor(
    readonly repository: WorkflowVersionRepository,
    private readonly workflowService: WorkflowService,
    private readonly actionService: ActionService,
  ) {
    super(repository);
  }

  /**
   * Persist the version snapshot and mark as current version.
   *
   * @param payload - Workflow creation payload including the definition.
   * @returns The current version set.
   */
  async commit(payload: WorkflowNewVersionDto) {
    return await this.createSnapshot({
      ...payload,
    });
  }

  /**
   * Create a new workflow snapshot with the next version number.
   * @param params Snapshot creation parameters.
   * @returns The created workflow version.
   */
  public async createSnapshot(
    params: WorkflowNewVersionDto,
  ): Promise<WorkflowVersion> {
    const workflow = params.workflow
      ? await this.workflowService.findOne(params.workflow)
      : null;
    this.assertDefinitionSupported(params.definitionYml, workflow?.type);
    const latestVersion = await this.findOne({
      where: { workflow: { id: params.workflow } },
      order: { version: 'DESC' },
    });
    const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

    return await this.create({
      ...params,
      version: nextVersion,
      parentVersion: params.parentVersion,
      createdBy: params.createdBy,
    });
  }

  /**
   * Persist a workflow version snapshot with the provided transaction manager.
   *
   * This method mirrors createSnapshot's version-number behavior without
   * escaping the caller's transaction or emitting repository-level events.
   */
  public async createSnapshotWithManager(
    manager: EntityManager,
    params: WorkflowNewVersionDto,
  ): Promise<WorkflowVersionOrmEntity> {
    const workflow = params.workflow
      ? await manager.findOne(WorkflowOrmEntity, {
          where: { id: params.workflow },
        })
      : null;
    this.assertDefinitionSupported(params.definitionYml, workflow?.type);
    const latestVersion = await manager.findOne(WorkflowVersionOrmEntity, {
      where: { workflow: { id: params.workflow } },
      order: { version: 'DESC' },
    });
    const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

    return await manager.save(
      WorkflowVersionOrmEntity,
      manager.create(WorkflowVersionOrmEntity, {
        workflow: { id: params.workflow },
        version: nextVersion,
        definitionYml: params.definitionYml,
        action: params.action,
        message: params.message,
        parentVersion: params.parentVersion
          ? { id: params.parentVersion }
          : null,
        createdBy: params.createdBy ? { id: params.createdBy } : null,
      }),
    );
  }

  /**
   * Restore a workflow to a prior version by creating a new snapshot.
   *
   * @param workflowId - Workflow identifier.
   * @param versionId - Version identifier to restore.
   * @param payload - Optional restore metadata.
   * @returns The updated workflow pointing at the restored version.
   */
  async restoreVersion(
    workflowId: string,
    versionId: string,
    payload: {
      updatedBy: string;
      message?: string | null;
    },
  ): Promise<WorkflowVersion> {
    const targetVersion = await this.findOne({
      where: { id: versionId, workflow: { id: workflowId } },
    });

    if (!targetVersion) {
      throw new NotFoundException(
        `Workflow version with ID ${versionId} not found`,
      );
    }

    const restoredVersion = await this.createSnapshot({
      workflow: workflowId,
      definitionYml: targetVersion.definitionYml,
      message: payload?.message ?? undefined,
      action: WorkflowVersionAction.restore,
      createdBy: payload?.updatedBy ?? null,
      parentVersion: targetVersion.id,
    });

    await this.workflowService.updateOne(workflowId, {
      currentVersion: restoredVersion.id,
    });

    return restoredVersion;
  }

  /**
   * Refuse a definition its workflow's type cannot run: one that uses an
   * action the type does not support (`BaseAction.workflowTypes`), since no
   * run of it could compile, or one that declares `inputs` although the type
   * fixes the input. Run by every snapshot, and by callers that check a
   * definition before creating its workflow.
   *
   * @param definitionYml The definition to save.
   * @param workflowType The type of its workflow; nothing is checked without
   * it, as the version cannot be saved anyway.
   * @throws {BadRequestException} Saying what the type does not support.
   */
  assertDefinitionSupported(
    definitionYml: string,
    workflowType: WorkflowType | undefined,
  ): void {
    // A definition that does not parse is refused by the YAML validation of
    // the callers.
    const parsed = validateWorkflow(definitionYml);
    if (!workflowType || !parsed.success) {
      return;
    }

    try {
      assertInputsDeclarable(parsed.data, workflowType);
      assertTaskActionsSupported(
        parsed.data,
        workflowType,
        this.actionService.getRegistry(),
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

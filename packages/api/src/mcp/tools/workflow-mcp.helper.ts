/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type WorkflowFull,
  type WorkflowVersion,
  type WorkflowVersionFull,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { WorkflowNewVersionDto } from '@/workflow/dto/workflow-version.dto';
import { parseWorkflowDefinition } from '@/workflow/lib/workflow-definition';
import { WorkflowVersionService } from '@/workflow/services/workflow-version.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { WorkflowType, WorkflowVersionAction } from '@/workflow/types';

import { McpUserRef, resolveRelationId, toUserRef } from './hexabot-mcp.utils';

type WorkflowVersionLike = WorkflowVersion | WorkflowVersionFull;

type WorkflowVersionSummary = Pick<
  WorkflowVersion,
  | 'id'
  | 'version'
  | 'checksum'
  | 'message'
  | 'action'
  | 'createdAt'
  | 'updatedAt'
> & {
  parentVersion:
    | WorkflowVersion['parentVersion']
    | WorkflowVersionFull['parentVersion'];
  workflow: WorkflowVersion['workflow'] | WorkflowVersionFull['workflow'];
  createdBy: McpUserRef | string | null;
  definitionYmlByteLength?: number;
};

type WorkflowSummary = Omit<
  WorkflowFull,
  | 'currentVersion'
  | 'publishedVersion'
  | 'createdBy'
  | 'definitionYml'
  | 'definition'
> & {
  createdBy: McpUserRef | string | null;
  currentVersion: WorkflowVersionSummary | null;
  publishedVersion: WorkflowVersionSummary | null;
  currentVersionId: string | null;
  publishedVersionId: string | null;
};

@Injectable()
export class HexabotWorkflowMcpHelper {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowVersionService: WorkflowVersionService,
  ) {}

  async requireWorkflow(id: string) {
    const workflow = await this.workflowService.findOneAndPopulate(id);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }

    return workflow;
  }

  async commitWorkflowDefinition(params: {
    workflowId: string;
    definitionYml: string;
    message?: string | null;
    parentVersion?: string | null;
    action?: WorkflowVersionAction;
    createdBy: string;
  }) {
    const workflow = await this.requireWorkflow(params.workflowId);
    this.assertDefinitionParses(params.definitionYml);
    const parentVersion =
      params.parentVersion === undefined
        ? resolveRelationId(workflow.currentVersion)
        : params.parentVersion;
    const payload: WorkflowNewVersionDto = {
      workflow: params.workflowId,
      definitionYml: params.definitionYml,
      message: params.message ?? undefined,
      parentVersion: parentVersion ?? undefined,
      action: params.action ?? WorkflowVersionAction.update,
      createdBy: params.createdBy,
    };

    return await this.workflowVersionService.commit(payload);
  }

  /**
   * Run the checks `commitWorkflowDefinition` runs on a definition, for a
   * workflow of the given type that does not exist yet: a definition refused
   * after its workflow was created would leave the workflow behind.
   *
   * @throws {BadRequestException} When the YAML is invalid or uses an action
   * the workflow type cannot run.
   */
  assertDefinitionCommittable(
    definitionYml: string,
    workflowType: WorkflowType,
  ): void {
    this.assertDefinitionParses(definitionYml);
    this.workflowVersionService.assertActionsSupported(
      definitionYml,
      workflowType,
    );
  }

  private assertDefinitionParses(definitionYml: string): void {
    try {
      parseWorkflowDefinition(definitionYml);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid workflow YAML',
      );
    }
  }

  async restoreWorkflowVersionSnapshot(
    args: { workflowId: string; versionId: string; message?: string },
    updatedBy: string,
  ) {
    return await this.workflowVersionService.restoreVersion(
      args.workflowId,
      args.versionId,
      {
        updatedBy,
        message: args.message,
      },
    );
  }

  buildWorkflowVersionStatus(workflow: WorkflowFull) {
    const currentVersion = this.summarizeWorkflowVersion(
      workflow.currentVersion,
    );
    const publishedVersion = this.summarizeWorkflowVersion(
      workflow.publishedVersion,
    );
    const currentVersionId = currentVersion?.id ?? null;
    const publishedVersionId = publishedVersion?.id ?? null;

    return {
      workflow: {
        id: workflow.id,
        name: workflow.name,
        type: workflow.type,
      },
      currentVersion,
      publishedVersion,
      currentVersionId,
      publishedVersionId,
      isPublished: Boolean(publishedVersionId),
      isCurrentVersionPublished:
        Boolean(currentVersionId) && currentVersionId === publishedVersionId,
      hasUnpublishedChanges:
        Boolean(currentVersionId) && currentVersionId !== publishedVersionId,
    };
  }

  summarizeWorkflow(workflow: WorkflowFull): WorkflowSummary {
    const {
      currentVersion,
      publishedVersion,
      createdBy,
      definitionYml: _definitionYml,
      definition: _definition,
      ...metadata
    } = workflow;
    const currentVersionSummary = this.summarizeWorkflowVersion(currentVersion);
    const publishedVersionSummary =
      this.summarizeWorkflowVersion(publishedVersion);

    return {
      ...metadata,
      createdBy: toUserRef(createdBy) ?? null,
      currentVersion: currentVersionSummary,
      publishedVersion: publishedVersionSummary,
      currentVersionId: currentVersionSummary?.id ?? null,
      publishedVersionId: publishedVersionSummary?.id ?? null,
    };
  }

  summarizeWorkflowVersion(
    version: WorkflowVersionLike | null | undefined,
    options?: { includeDefinitionYmlByteLength?: boolean },
  ): WorkflowVersionSummary | null {
    if (!version) {
      return null;
    }
    const {
      id,
      version: versionNumber,
      checksum,
      message,
      action,
      parentVersion,
      workflow,
      createdBy,
      createdAt,
      updatedAt,
    } = version;
    const summary = {
      id,
      version: versionNumber,
      checksum,
      message,
      action,
      parentVersion,
      workflow,
      createdBy: toUserRef(createdBy),
      createdAt,
      updatedAt,
      ...(options?.includeDefinitionYmlByteLength
        ? {
            definitionYmlByteLength:
              typeof version.definitionYml === 'string'
                ? Buffer.byteLength(version.definitionYml, 'utf8')
                : undefined,
          }
        : {}),
    };

    return Object.fromEntries(
      Object.entries(summary).filter(([, value]) => value !== undefined),
    ) as WorkflowVersionSummary;
  }
}

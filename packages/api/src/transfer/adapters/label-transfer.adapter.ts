/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type WorkflowExportBundle,
  type WorkflowExportBundleLabel,
  type WorkflowExportBundleLabelGroup,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EntityManager, In } from 'typeorm';

import { LabelGroupOrmEntity } from '@/chat/entities/label-group.entity';
import { LabelOrmEntity } from '@/chat/entities/label.entity';
import { LabelService } from '@/chat/services/label.service';

import {
  WorkflowTransferAdapter,
  WorkflowTransferExportContext,
  WorkflowTransferImportContext,
  WorkflowTransferImportResults,
  WorkflowTransferResourceAdapter,
} from '../workflow-transfer-resource-adapter';
import {
  findAllForExport,
  type WorkflowTransferImportAdapterResult,
} from '../workflow-transfer.types';

type LabelExportResources = {
  labelGroups: WorkflowExportBundleLabelGroup[];
  labels: WorkflowExportBundleLabel[];
};

@WorkflowTransferAdapter()
@Injectable()
export class LabelTransferAdapter extends WorkflowTransferResourceAdapter {
  override readonly kind = 'label';

  override readonly resourceKeys = ['labels', 'labelGroups'];

  constructor(private readonly labelService: LabelService) {
    super();
  }

  override async buildExportResources(
    ctx: WorkflowTransferExportContext,
  ): Promise<Record<string, unknown[]>> {
    return this.buildLabelExportResources(ctx.getRefs(this.kind));
  }

  private async buildLabelExportResources(
    ids: string[],
  ): Promise<LabelExportResources> {
    const labels = await findAllForExport('label', ids, (uniqueIds) =>
      this.labelService.findAndPopulate({ where: { id: In(uniqueIds) } }),
    );
    const groupsById = new Map<string, WorkflowExportBundleLabelGroup>();
    for (const label of labels) {
      if (label.group?.id) {
        groupsById.set(label.group.id, {
          exportId: label.group.id,
          name: label.group.name,
        });
      }
    }

    return {
      labelGroups: Array.from(groupsById.values()),
      labels: labels.map((label) => ({
        exportId: label.id,
        title: label.title,
        name: label.name,
        description: label.description ?? null,
        groupExportId: label.group?.id ?? null,
      })),
    };
  }

  override async importResources(
    ctx: WorkflowTransferImportContext,
  ): Promise<WorkflowTransferImportAdapterResult> {
    const labelGroups =
      ctx.getResources<
        WorkflowExportBundle['resources']['labelGroups'][number]
      >('labelGroups');
    const labels =
      ctx.getResources<WorkflowExportBundle['resources']['labels'][number]>(
        'labels',
      );
    const groupResult = await this.importLabelGroups(ctx.manager, labelGroups);
    const labelResult = await this.importLabels(
      ctx.manager,
      labels,
      groupResult.idMap,
    );

    return {
      idMap: labelResult.idMap,
      resources: [...groupResult.resources, ...labelResult.resources],
      warnings: [],
      postCreateEvents: [
        ...groupResult.postCreateEvents,
        ...labelResult.postCreateEvents,
      ],
    };
  }

  private async importLabelGroups(
    manager: EntityManager,
    labelGroups: WorkflowExportBundle['resources']['labelGroups'],
  ): Promise<WorkflowTransferImportAdapterResult> {
    const results = new WorkflowTransferImportResults('labelGroup');

    for (const labelGroup of labelGroups) {
      const existing = await manager.findOne(LabelGroupOrmEntity, {
        where: { name: labelGroup.name },
      });

      if (existing) {
        results.reused(labelGroup, existing.id);
        continue;
      }

      const payload = {
        name: labelGroup.name,
      };
      const created = await manager.save(
        LabelGroupOrmEntity,
        manager.create(LabelGroupOrmEntity, payload),
      );

      results.created(labelGroup, created, payload);
    }

    return results.toResult();
  }

  private async importLabels(
    manager: EntityManager,
    labels: WorkflowExportBundle['resources']['labels'],
    labelGroupIdMap: Record<string, string>,
  ): Promise<WorkflowTransferImportAdapterResult> {
    const results = new WorkflowTransferImportResults(this.kind);

    for (const label of labels) {
      const groupId = label.groupExportId
        ? labelGroupIdMap[label.groupExportId]
        : null;

      if (label.groupExportId && !groupId) {
        throw new BadRequestException(
          `Workflow bundle is missing label group "${label.groupExportId}" required by label "${label.name}"`,
        );
      }

      const existingByName = await manager.findOne(LabelOrmEntity, {
        where: { name: label.name },
        relations: ['group'],
      });

      if (existingByName) {
        if (!this.isEquivalentLabel(existingByName, label, groupId)) {
          throw new ConflictException(
            `Label "${label.name}" already exists with different configuration`,
          );
        }

        results.reused(label, existingByName.id);
        continue;
      }

      const existingByTitle = await manager.findOne(LabelOrmEntity, {
        where: { title: label.title },
      });
      if (existingByTitle) {
        throw new ConflictException(
          `Label title "${label.title}" already exists with a different name`,
        );
      }

      const payload = {
        title: label.title,
        name: label.name,
        description: label.description ?? null,
        group: groupId ? { id: groupId } : null,
        builtin: false,
      };
      const created = await manager.save(
        LabelOrmEntity,
        manager.create(LabelOrmEntity, payload),
      );

      results.created(label, created, payload);
    }

    return results.toResult();
  }

  private isEquivalentLabel(
    existing: LabelOrmEntity,
    imported: WorkflowExportBundle['resources']['labels'][number],
    importedGroupId: string | null,
  ): boolean {
    const existingGroupId =
      existing.group && typeof existing.group === 'object'
        ? existing.group.id
        : null;

    return (
      existing.title === imported.title &&
      (existing.description ?? null) === (imported.description ?? null) &&
      existingGroupId === importedGroupId
    );
  }
}

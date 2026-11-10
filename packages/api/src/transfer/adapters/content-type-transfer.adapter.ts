/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  normalizeContentTypeSchema,
  type WorkflowExportBundle,
  type WorkflowExportBundleContentType,
  type WorkflowImportResourceResult,
} from '@hexabot-ai/types';
import { ConflictException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import { ContentTypeService } from '@/cms/services/content-type.service';

import {
  WorkflowTransferAdapter,
  WorkflowTransferExportContext,
  WorkflowTransferImportContext,
  WorkflowTransferResourceAdapter,
} from '../workflow-transfer-resource-adapter';
import {
  assertFoundAll,
  buildPostCreateEvent,
  buildResourceResult,
  uniqueResourceIds,
  type WorkflowTransferImportAdapterResult,
} from '../workflow-transfer.types';

@WorkflowTransferAdapter()
@Injectable()
export class ContentTypeTransferAdapter extends WorkflowTransferResourceAdapter {
  override readonly kind = 'contentType';

  override readonly resourceKeys = ['contentTypes'];

  constructor(private readonly contentTypeService: ContentTypeService) {
    super();
  }

  override async buildExportResources(
    ctx: WorkflowTransferExportContext,
  ): Promise<Record<string, WorkflowExportBundleContentType[]>> {
    return {
      contentTypes: await this.buildContentTypeExportResources(
        ctx.getRefs(this.kind),
      ),
    };
  }

  private async buildContentTypeExportResources(
    ids: string[],
  ): Promise<WorkflowExportBundleContentType[]> {
    const uniqueIds = uniqueResourceIds(ids);
    if (uniqueIds.length === 0) {
      return [];
    }

    const contentTypes = await this.contentTypeService.find({
      where: { id: In(uniqueIds) },
    });
    assertFoundAll(
      'content type',
      uniqueIds,
      contentTypes.map((contentType) => contentType.id),
    );

    return contentTypes.map((contentType) => ({
      exportId: contentType.id,
      name: contentType.name,
      schema: contentType.schema,
    }));
  }

  override async importResources(
    ctx: WorkflowTransferImportContext,
  ): Promise<WorkflowTransferImportAdapterResult> {
    const contentTypes =
      ctx.getResources<
        WorkflowExportBundle['resources']['contentTypes'][number]
      >('contentTypes');
    const idMap: Record<string, string> = {};
    const resources: WorkflowImportResourceResult[] = [];
    const postCreateEvents: WorkflowTransferImportAdapterResult['postCreateEvents'] =
      [];

    for (const contentType of contentTypes) {
      const existing = await ctx.manager.findOne(ContentTypeOrmEntity, {
        where: { name: contentType.name },
      });

      if (existing) {
        if (!this.isEquivalentContentType(existing, contentType)) {
          throw new ConflictException(
            `Content type "${contentType.name}" already exists with different configuration`,
          );
        }

        idMap[contentType.exportId] = existing.id;
        resources.push(
          buildResourceResult({
            kind: 'contentType',
            exportId: contentType.exportId,
            localId: existing.id,
            name: contentType.name,
            action: 'reused',
          }),
        );
        continue;
      }

      // Bundles exported before may hold fields with a former spelling (e.g.
      // the "html" field type): they are imported with their current type.
      const payload = {
        name: contentType.name,
        schema: normalizeContentTypeSchema(contentType.schema),
      };
      const created = await ctx.manager.save(
        ContentTypeOrmEntity,
        ctx.manager.create(ContentTypeOrmEntity, payload),
      );

      idMap[contentType.exportId] = created.id;
      resources.push(
        buildResourceResult({
          kind: 'contentType',
          exportId: contentType.exportId,
          localId: created.id,
          name: contentType.name,
          action: 'created',
        }),
      );
      postCreateEvents.push(
        buildPostCreateEvent('contentType', created, payload),
      );
    }

    return {
      idMap,
      resources,
      warnings: [],
      postCreateEvents,
    };
  }

  private isEquivalentContentType(
    existing: ContentTypeOrmEntity,
    imported: WorkflowExportBundle['resources']['contentTypes'][number],
  ): boolean {
    return isDeepStrictEqual(
      normalizeContentTypeSchema(existing.schema),
      normalizeContentTypeSchema(imported.schema),
    );
  }
}

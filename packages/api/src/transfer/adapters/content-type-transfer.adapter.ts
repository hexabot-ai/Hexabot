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
} from '@hexabot-ai/types';
import { ConflictException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import { ContentTypeService } from '@/cms/services/content-type.service';

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
    const contentTypes = await findAllForExport(
      'content type',
      ids,
      (uniqueIds) =>
        this.contentTypeService.find({ where: { id: In(uniqueIds) } }),
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
    const results = new WorkflowTransferImportResults(this.kind);

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

        results.reused(contentType, existing.id);
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

      results.created(contentType, created, payload);
    }

    return results.toResult();
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

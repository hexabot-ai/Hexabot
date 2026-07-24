/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Setting } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { HelperService } from '@/helper/helper.service';
import { BaseRagHelper } from '@/helper/lib/base-rag-helper';
import { HelperType } from '@/helper/types';
import { LoggerService } from '@/logger/logger.service';
import {
  DeleteEntityEvent,
  InsertEntityEvent,
  UpdateEntityEvent,
} from '@/utils/types/entity-event.types';

import { ContentTypeOrmEntity } from '../entities/content-type.entity';
import { ContentOrmEntity } from '../entities/content.entity';

import { ContentService } from './content.service';

/**
 * Forwards content lifecycle events to the configured default RAG helper.
 *
 * The built-in full-text helper keeps its search corpus (the `contents` table)
 * consistent inside the database itself, so it implements none of the optional
 * write hooks and this orchestrator becomes a no-op for it. The forwarding
 * exists solely so that downstream helpers backed by an **external** index can
 * stay in sync — including across content-type cascade deletes, which the
 * database performs without emitting per-content delete hooks.
 */
@Injectable()
export class RagService {
  /**
   * Content ids captured at content type preDelete, keyed by content type id.
   * A content type deletion cascade-deletes its contents at the database level
   * without per-content postDelete hooks, so ids must be captured while the
   * rows still exist and removed from the external index after deletion.
   */
  private readonly pendingContentTypeDeletions = new Map<string, string[]>();

  private readonly reindexPromises = new Map<string, Promise<void>>();

  constructor(
    private readonly helperService: HelperService,
    private readonly contentService: ContentService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Resolves the default RAG helper, or `undefined` when it cannot be resolved.
   * RAG synchronization must never break content operations.
   */
  private async getHelper(name?: string): Promise<BaseRagHelper | undefined> {
    try {
      return name
        ? this.helperService.get(HelperType.RAG, name)
        : await this.helperService.getDefaultHelper(HelperType.RAG);
    } catch (error) {
      this.logger.error('Unable to resolve the default RAG helper.', error);

      return undefined;
    }
  }

  /**
   * Reconciles the selected helper when it supports rebuilding.
   */
  async reindexAll(helperName?: string): Promise<void> {
    const helper = await this.getHelper(helperName);
    if (!helper?.reindex) {
      return;
    }

    const name = helper.getName();
    const inFlight = this.reindexPromises.get(name);
    if (inFlight) {
      await inFlight;

      return;
    }

    const promise = helper
      .reindex()
      .catch((error) => {
        this.logger.error(`Unable to reindex RAG helper "${name}".`, error);
      })
      .finally(() => {
        this.reindexPromises.delete(name);
      });
    this.reindexPromises.set(name, promise);
    await promise;
  }

  /**
   * Starts a reconciliation without blocking an HTTP request.
   */
  scheduleReindexAll(): void {
    void this.reindexAll();
  }

  /**
   * Indexes created or updated content in the external index (if any).
   */
  @OnEvent('hook:content:postCreate')
  @OnEvent('hook:content:postUpdate')
  async handleContentUpserted(
    event:
      | InsertEntityEvent<ContentOrmEntity>
      | UpdateEntityEvent<ContentOrmEntity>,
  ): Promise<void> {
    const contentId = event.entity?.id;
    if (!contentId) {
      return;
    }

    const helper = await this.getHelper();
    if (!helper?.index) {
      return;
    }

    try {
      const content = await this.contentService.findOneAndPopulate(contentId);
      if (content) {
        await helper.index(content);
      }
    } catch (error) {
      this.logger.error('Unable to index content in the RAG helper.', error, {
        contentId,
      });
    }
  }

  /**
   * Removes deleted content from the external index (if any).
   */
  @OnEvent('hook:content:postDelete')
  async handleContentDeleted(
    event: DeleteEntityEvent<ContentOrmEntity>,
  ): Promise<void> {
    const contentId = event.entity?.id ?? event.databaseEntity?.id;
    if (!contentId) {
      return;
    }

    const helper = await this.getHelper();
    if (!helper?.remove) {
      return;
    }

    try {
      await helper.remove(contentId);
    } catch (error) {
      this.logger.error(
        'Unable to remove deleted content from the RAG helper.',
        error,
        { contentId },
      );
    }
  }

  /**
   * Captures content ids before their content type is cascade-deleted.
   */
  @OnEvent('hook:contentType:preDelete')
  async handleContentTypeDeleting(
    event: DeleteEntityEvent<ContentTypeOrmEntity>,
  ): Promise<void> {
    const contentTypeId = event.databaseEntity?.id;
    if (!contentTypeId) {
      return;
    }

    // Only pay the capture cost when the active helper maintains an index.
    const helper = await this.getHelper();
    if (!helper?.remove) {
      return;
    }

    try {
      const contents = await this.contentService.find({
        where: { contentType: { id: contentTypeId } },
      });
      this.pendingContentTypeDeletions.set(
        contentTypeId,
        contents.map(({ id }) => id),
      );
    } catch (error) {
      this.logger.error(
        'Unable to capture content ids before content type deletion.',
        error,
        { contentTypeId },
      );
    }
  }

  /**
   * Removes contents of a deleted content type from the external index (if any).
   */
  @OnEvent('hook:contentType:postDelete')
  async handleContentTypeDeleted(
    event: DeleteEntityEvent<ContentTypeOrmEntity>,
  ): Promise<void> {
    const contentTypeId = event.entity?.id ?? event.databaseEntity?.id;
    if (!contentTypeId) {
      return;
    }

    const contentIds = this.pendingContentTypeDeletions.get(contentTypeId);
    this.pendingContentTypeDeletions.delete(contentTypeId);
    if (!contentIds?.length) {
      return;
    }

    const helper = await this.getHelper();
    if (!helper?.remove) {
      return;
    }

    for (const contentId of contentIds) {
      try {
        await helper.remove(contentId);
      } catch (error) {
        this.logger.error(
          'Unable to remove content of a deleted content type from the RAG helper.',
          error,
          { contentId, contentTypeId },
        );
      }
    }
  }

  /**
   * Rebuilds the external index when the default RAG helper is switched, so a
   * newly selected helper can populate its index from the database.
   */
  @OnEvent('hook:global_settings:default_rag_helper')
  async handleDefaultRagHelperChanged(
    setting?: Pick<Setting, 'value'>,
  ): Promise<void> {
    const helperName =
      typeof setting?.value === 'string' ? setting.value : undefined;
    await this.reindexAll(helperName);
  }
}

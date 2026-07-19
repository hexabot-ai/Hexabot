/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';
import type { UserOrmEntity } from '@/user/entities/user.entity';
import {
  DeleteEntityEvent,
  InsertEntityEvent,
  UpdateEntityEvent,
} from '@/utils/types/entity-event.types';

import { ContentTypeOrmEntity } from '../entities/content-type.entity';
import { ContentOrmEntity } from '../entities/content.entity';
import { RagHit, RagQueryOptions } from '../types/rag';

import { ContentService } from './content.service';
import { RagBackendService } from './rag-backend.service';
import { RagIndexerService } from './rag-indexer.service';
import { RagRetrieverService } from './rag-retriever.service';

@Injectable()
export class RagService {
  private ragSettingsReindexPromise?: Promise<void>;

  private manualReindexPromise?: Promise<void>;

  /**
   * Content ids captured at content type preDelete, keyed by content type id.
   * Deleting a content type cascade-deletes its contents at the database
   * level without per-content postDelete hooks, so ids must be captured
   * while the rows still exist and cleaned from indexes after deletion.
   */
  private readonly pendingContentTypeDeletions = new Map<string, string[]>();

  constructor(
    private readonly retrieverService: RagRetrieverService,
    private readonly indexerService: RagIndexerService,
    private readonly embeddingBackendService: RagBackendService,
    private readonly contentService: ContentService,
    private readonly settingService: SettingService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Retrieves RAG hits for the provided query.
   * @param query User query text.
   * @param options Retrieval options.
   * @returns Matching RAG hits.
   */
  async retrieve(
    query: string,
    options: RagQueryOptions = {},
  ): Promise<RagHit[]> {
    return await this.retrieverService.retrieve(query, options);
  }

  /**
   * Upserts one content item in RAG indexes.
   * @param contentId Content identifier.
   * @returns Resolves when indexing is complete.
   */
  async upsertContentIndex(contentId: string): Promise<void> {
    await this.indexerService.upsertContentIndex(contentId);
  }

  /**
   * Removes one content item from RAG indexes.
   * @param contentId Content identifier.
   * @returns Resolves when removal is complete.
   */
  async removeContentIndex(contentId: string): Promise<void> {
    await this.indexerService.removeContentIndex(contentId);
  }

  /**
   * Rebuilds RAG indexes for all content.
   * @returns Resolves when reindexing is complete.
   */
  async reindexAll(): Promise<void> {
    await this.indexerService.reindexAll();
  }

  /**
   * Schedules a full manual reindex if one is not already running.
   * @returns No return value.
   */
  scheduleReindexAll(): void {
    if (!this.manualReindexPromise) {
      this.manualReindexPromise = this.reindexAll()
        .catch((error) => {
          this.logger.error(
            'Unable to complete manual RAG reindex request.',
            error,
          );
        })
        .finally(() => {
          this.manualReindexPromise = undefined;
        });
    }
  }

  /**
   * Handles changes to the RAG enabled setting.
   * @returns Resolves when follow-up reindex handling completes.
   */
  @OnEvent('hook:rag_settings:enabled')
  async handleRagEnabledSettingChanged(): Promise<void> {
    await this.reindexAfterRagSettingChange('enabled');
  }

  /**
   * Handles changes to RAG backend settings that require reindexing.
   * @returns Resolves when follow-up reindex handling completes.
   */
  @OnEvent('hook:rag_settings:embedding_model')
  @OnEvent('hook:rag_settings:embedding_provider')
  @OnEvent('hook:rag_settings:embedding_api_key')
  @OnEvent('hook:rag_settings:embedding_base_url')
  @OnEvent('hook:rag_settings:embedding_dimensions')
  @OnEvent('hook:rag_settings:index_only_active_content')
  async handleRagBackendSettingChanged(): Promise<void> {
    await this.reindexAfterRagSettingChange('backend');
  }

  /**
   * Handles content creation events and indexes the new content.
   * @param event Insert event payload.
   * @returns Resolves when event handling completes.
   */
  @OnEvent('hook:content:postCreate')
  async handleContentCreated(
    event: InsertEntityEvent<UserOrmEntity>,
  ): Promise<void> {
    const contentId = event.entity?.id;
    if (!contentId) {
      return;
    }

    try {
      await this.upsertContentIndex(contentId);
    } catch (error) {
      this.logger.error('Unable to index created content', error, {
        contentId,
      });
    }
  }

  /**
   * Handles content update events and reindexes the updated content.
   * @param event Update event payload.
   * @returns Resolves when event handling completes.
   */
  @OnEvent('hook:content:postUpdate')
  async handleContentUpdated(
    event: UpdateEntityEvent<ContentOrmEntity>,
  ): Promise<void> {
    const contentId = event.entity?.id;
    if (!contentId) {
      return;
    }

    try {
      await this.upsertContentIndex(contentId);
    } catch (error) {
      this.logger.error('Unable to index updated content', error, {
        contentId,
      });
    }
  }

  /**
   * Handles content deletion events and removes deleted content from indexes.
   * @param event Remove event payload.
   * @returns Resolves when event handling completes.
   */
  @OnEvent('hook:content:postDelete')
  async handleContentDeleted(
    event: DeleteEntityEvent<ContentOrmEntity>,
  ): Promise<void> {
    const contentId = event.entity?.id;
    if (!contentId) {
      return;
    }

    try {
      await this.removeContentIndex(contentId);
    } catch (error) {
      this.logger.error('Unable to remove deleted content from index', error, {
        contentId,
      });
    }
  }

  /**
   * Captures content ids of a content type before it is deleted.
   *
   * Content rows are cascade-deleted with their content type at the
   * database level, which bypasses per-content postDelete hooks, so the
   * ids must be captured while the rows still exist.
   * @param event Pre-delete event payload.
   * @returns Resolves when capture completes.
   */
  @OnEvent('hook:contentType:preDelete')
  async handleContentTypeDeleting(
    event: DeleteEntityEvent<ContentTypeOrmEntity>,
  ): Promise<void> {
    const contentTypeId = event.databaseEntity?.id;
    if (!contentTypeId) {
      return;
    }

    const settings = await this.settingService.getSettings();
    if (!settings.rag_settings.enabled) {
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
        'Unable to capture content ids before content type deletion',
        error,
        { contentTypeId },
      );
    }
  }

  /**
   * Removes contents of a deleted content type from RAG indexes.
   * @param event Remove event payload.
   * @returns Resolves when event handling completes.
   */
  @OnEvent('hook:contentType:postDelete')
  async handleContentTypeDeleted(
    event: DeleteEntityEvent<ContentTypeOrmEntity>,
  ): Promise<void> {
    const contentTypeId = event.entity?.id;
    if (!contentTypeId) {
      return;
    }

    const contentIds = this.pendingContentTypeDeletions.get(contentTypeId);
    this.pendingContentTypeDeletions.delete(contentTypeId);
    if (!contentIds?.length) {
      return;
    }

    for (const contentId of contentIds) {
      try {
        await this.removeContentIndex(contentId);
      } catch (error) {
        this.logger.error(
          'Unable to remove content of deleted content type from index',
          error,
          { contentId, contentTypeId },
        );
      }
    }
  }

  /**
   * Queues a reindex after a relevant RAG setting change.
   * @param trigger Setting key that triggered reindexing.
   * @returns Resolves when the queued reindex attempt finishes.
   */
  private async reindexAfterRagSettingChange(trigger: string): Promise<void> {
    if (!this.ragSettingsReindexPromise) {
      this.ragSettingsReindexPromise = this.performRagSettingsReindex()
        .catch((error) => {
          this.logger.error(
            `Unable to reindex content after RAG setting change (${trigger}).`,
            error,
          );
        })
        .finally(() => {
          this.ragSettingsReindexPromise = undefined;
        });
    }

    await this.ragSettingsReindexPromise;
  }

  /**
   * Resets RAG backend state and performs a full reindex when RAG is enabled.
   * @returns Resolves when reset and reindexing complete.
   */
  private async performRagSettingsReindex(): Promise<void> {
    const settings = await this.settingService.getSettings();

    if (!settings.rag_settings.enabled) {
      return;
    }

    this.embeddingBackendService.reset();
    await this.reindexAll();
  }
}

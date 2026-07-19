/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ContentFull } from '@hexabot-ai/types';
import {
  Document,
  MetadataMode,
  NodeRelationship,
} from '@llamaindex/core/schema';
import { Injectable } from '@nestjs/common';
import {
  KeywordTableIndex,
  simpleExtractKeywords,
  VectorStoreIndex,
} from 'llamaindex';
import pLimit from 'p-limit';

import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';

import { ContentService } from './content.service';
import { RagBackendService } from './rag-backend.service';

@Injectable()
export class RagIndexerService {
  private static readonly REINDEX_CONCURRENCY = 8;

  constructor(
    private readonly contentService: ContentService,
    private readonly settingService: SettingService,
    private readonly embeddingBackendService: RagBackendService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Upserts a single content item into embedding and lexical indexes.
   * @param contentId Content identifier.
   * @returns Resolves when indexing is complete.
   */
  async upsertContentIndex(contentId: string): Promise<void> {
    const ragSettings = await this.getRagSettings();
    if (!ragSettings) {
      return;
    }

    const [embeddingIndex, lexicalIndex] = await Promise.all([
      this.getEmbeddingIndexOrNull(),
      this.embeddingBackendService.getLexicalIndex(),
    ]);
    const content = await this.contentService.findOneAndPopulate(contentId);

    if (!content) {
      await this.removeContentFromIndexes(
        contentId,
        embeddingIndex,
        lexicalIndex,
      );

      return;
    }

    await this.upsertContent(
      content,
      ragSettings,
      embeddingIndex,
      lexicalIndex,
    );
  }

  /**
   * Removes a single content item from embedding and lexical indexes.
   * @param contentId Content identifier.
   * @returns Resolves when removal is complete.
   */
  async removeContentIndex(contentId: string): Promise<void> {
    const ragSettings = await this.getRagSettings();
    if (!ragSettings) {
      return;
    }

    const [embeddingIndex, lexicalIndex] = await Promise.all([
      this.getEmbeddingIndexOrNull(),
      this.embeddingBackendService.getLexicalIndex(),
    ]);

    await this.removeContentFromIndexes(
      contentId,
      embeddingIndex,
      lexicalIndex,
    );
  }

  /**
   * Rebuilds indexes for all content items allowed by current RAG settings.
   * @returns Resolves when reindexing completes.
   */
  async reindexAll(): Promise<void> {
    const settings = await this.getRagSettings();
    if (!settings) {
      return;
    }

    const embeddingIndex = await this.getEmbeddingIndexOrNull();
    const lexicalIndex = await this.embeddingBackendService.getLexicalIndex();
    const contents = await this.contentService.findAndPopulate({
      ...(settings.index_only_active_content
        ? { where: { status: true } }
        : {}),
      order: { createdAt: 'DESC' },
    });
    const concurrencyLimit = pLimit(RagIndexerService.REINDEX_CONCURRENCY);
    const failedContentIds: string[] = [];
    const results = await Promise.allSettled(
      contents.map((content) =>
        concurrencyLimit(() =>
          this.upsertContent(content, settings, embeddingIndex, lexicalIndex),
        ),
      ),
    );

    for (const [resultIndex, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        continue;
      }

      const contentId = contents[resultIndex]?.id ?? 'unknown';
      failedContentIds.push(contentId);
      this.logger.error(
        'Unable to reindex content in RAG batch',
        result.reason,
        {
          contentId,
        },
      );
    }

    if (failedContentIds.length > 0) {
      throw new Error(
        `RAG reindex completed with ${failedContentIds.length} failed content item(s).`,
      );
    }
  }

  /**
   * Upserts a content document into configured RAG indexes.
   * @param content Full content payload.
   * @param settings Active RAG settings.
   * @param embeddingIndex Embedding index instance.
   * @param lexicalIndex Lexical index instance.
   * @returns Resolves when upsert processing completes.
   */
  private async upsertContent(
    content: ContentFull,
    settings: Settings['rag_settings'],
    embeddingIndex: VectorStoreIndex | null,
    lexicalIndex: KeywordTableIndex,
  ): Promise<void> {
    if (settings.index_only_active_content && !content.status) {
      await this.removeContentFromIndexes(
        content.id,
        embeddingIndex,
        lexicalIndex,
      );

      return;
    }

    const document = this.toDocument(content);

    if (embeddingIndex) {
      await this.upsertContentInEmbeddingIndex(
        content.id,
        document,
        embeddingIndex,
      );
    }

    await this.upsertContentInLexicalIndex(content.id, document, lexicalIndex);
  }

  /**
   * Upserts a content document in the embedding index with hash-based deduplication.
   * @param contentId Content identifier.
   * @param document Document to upsert.
   * @param embeddingIndex Embedding index instance.
   * @returns Resolves when embedding upsert is complete.
   */
  private async upsertContentInEmbeddingIndex(
    contentId: string,
    document: Document,
    embeddingIndex: VectorStoreIndex,
  ): Promise<void> {
    const existingHash =
      await embeddingIndex.docStore.getDocumentHash(contentId);
    if (existingHash === document.hash) {
      return;
    }

    if (typeof existingHash !== 'undefined') {
      await embeddingIndex.deleteRefDoc(contentId);
    }

    await embeddingIndex.insertNodes([document]);
    await embeddingIndex.docStore.setDocumentHash(contentId, document.hash);
  }

  /**
   * Upserts a content document in the lexical index with extracted keywords.
   * @param contentId Content identifier.
   * @param document Document to upsert.
   * @param lexicalIndex Lexical index instance.
   * @returns Resolves when lexical upsert is complete.
   */
  private async upsertContentInLexicalIndex(
    contentId: string,
    document: Document,
    lexicalIndex: KeywordTableIndex,
  ): Promise<void> {
    const existingHash = await lexicalIndex.docStore.getDocumentHash(contentId);
    if (existingHash === document.hash) {
      return;
    }

    if (typeof existingHash !== 'undefined') {
      await this.removeContentFromLexicalIndex(contentId, lexicalIndex);
    }

    await lexicalIndex.docStore.addDocuments([document], true);

    const keywords = this.extractKeywords(
      document.getContent(MetadataMode.NONE),
    );
    if (keywords.length > 0) {
      lexicalIndex.indexStruct.addNode(keywords, document.id_);
    }
    await lexicalIndex.indexStore?.addIndexStruct(lexicalIndex.indexStruct);
  }

  /**
   * Extracts lexical keywords from raw text.
   * @param text Source text.
   * @returns Extracted keywords.
   */
  private extractKeywords(text: string): string[] {
    return [...simpleExtractKeywords(text)];
  }

  /**
   * Removes a content item from all available indexes.
   * @param contentId Content identifier.
   * @param embeddingIndex Embedding index instance.
   * @param lexicalIndex Lexical index instance.
   * @returns Resolves when removal from indexes completes.
   */
  private async removeContentFromIndexes(
    contentId: string,
    embeddingIndex: VectorStoreIndex | null,
    lexicalIndex: KeywordTableIndex,
  ): Promise<void> {
    if (embeddingIndex) {
      await embeddingIndex.deleteRefDoc(contentId);
    }

    await this.removeContentFromLexicalIndex(contentId, lexicalIndex);
  }

  /**
   * Removes a content document from the lexical keyword index.
   *
   * Documents are inserted into the lexical index manually (raw document plus
   * keyword table entries), so no ref-doc info is registered and
   * `KeywordTableIndex.deleteRefDoc` would silently no-op. Removal must
   * mirror the manual insertion instead.
   * @param contentId Content identifier.
   * @param lexicalIndex Lexical index instance.
   * @returns Resolves when lexical removal completes.
   */
  private async removeContentFromLexicalIndex(
    contentId: string,
    lexicalIndex: KeywordTableIndex,
  ): Promise<void> {
    for (const [keyword, nodeIds] of lexicalIndex.indexStruct.table) {
      nodeIds.delete(contentId);
      if (nodeIds.size === 0) {
        lexicalIndex.indexStruct.table.delete(keyword);
      }
    }

    await lexicalIndex.docStore.deleteDocument(contentId, false);
    await lexicalIndex.indexStore?.addIndexStruct(lexicalIndex.indexStruct);
  }

  /**
   * Converts a content entity into a LlamaIndex document.
   * @param content Full content payload.
   * @returns Document ready for indexing.
   */
  private toDocument(content: ContentFull): Document {
    return new Document({
      id_: content.id,
      text: content.searchText ?? '',
      metadata: {
        contentId: content.id,
        title: content.title,
        contentTypeId: content.contentType.id,
        status: content.status ? 1 : 0,
      },
      relationships: {
        [NodeRelationship.SOURCE]: {
          nodeId: content.id,
          metadata: {
            contentId: content.id,
          },
        },
      },
    });
  }

  /**
   * Returns the embedding index, or null when initialization fails.
   * @returns Embedding index instance or null.
   */
  private async getEmbeddingIndexOrNull(): Promise<VectorStoreIndex | null> {
    try {
      return await this.embeddingBackendService.getEmbeddingIndex();
    } catch (error) {
      this.logger.warn(
        'Unable to initialize embedding index. Continuing lexical indexing only.',
        error,
      );

      return null;
    }
  }

  /**
   * Returns enabled RAG settings.
   * @returns Enabled settings or null.
   */
  private async getRagSettings(): Promise<Settings['rag_settings'] | null> {
    const settings = await this.settingService.getSettings();
    const ragSettings = settings.rag_settings;
    if (!ragSettings.enabled) {
      return null;
    }

    return ragSettings;
  }
}

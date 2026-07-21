/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Settings } from '@llamaindex/core/global';
import { MetadataMode } from '@llamaindex/core/schema';
import {
  FilterCondition,
  FilterOperator,
  MetadataFilters,
} from '@llamaindex/core/vector-store';
import { Injectable } from '@nestjs/common';
import { KeywordTableRetrieverMode } from 'llamaindex';

import { SettingService } from '@/setting/services/setting.service';

import { RagHit, RagMode, RagQueryOptions } from '../types/rag';

import { RagBackendService } from './rag-backend.service';

type ResolvedRagQueryOptions = Omit<RagQueryOptions, 'limit'> & {
  limit: number;
};

type RagCandidateHit = RagHit & { _status: number };

type RetrieverEntry = {
  node: {
    id_: string;
    metadata: Record<string, unknown>;
    getContent(mode: MetadataMode): string;
  };
  score?: number;
};

@Injectable()
export class RagRetrieverService {
  constructor(
    private readonly settingService: SettingService,
    private readonly ragBackendService: RagBackendService,
  ) {}

  /**
   * Checks whether RAG retrieval is enabled at the settings level.
   * @returns True when rag_settings.enabled is on.
   */
  async isEnabled(): Promise<boolean> {
    const settings = await this.settingService.getSettings();

    return settings.rag_settings.enabled;
  }

  /**
   * Retrieves RAG hits using the requested retrieval mode.
   * @param query Query text.
   * @param options Retrieval options.
   * @returns Matching RAG hits.
   */
  async retrieve(
    query: string,
    options: RagQueryOptions = {},
  ): Promise<RagHit[]> {
    const settings = await this.settingService.getSettings();
    const ragSettings = settings.rag_settings;
    if (!ragSettings.enabled || !query?.trim()) {
      return [];
    }

    const resolvedOptions = this.resolveQueryOptions(options, ragSettings);
    if (resolvedOptions.mode !== 'embedding') {
      return await this.retrieveLexical(query, resolvedOptions);
    }

    return await this.retrieveEmbedding(query, resolvedOptions);
  }

  /**
   * Retrieves lexical matches from the keyword index.
   * @param query Query text.
   * @param options Resolved query options.
   * @returns Lexical retrieval hits.
   */
  private async retrieveLexical(
    query: string,
    options: ResolvedRagQueryOptions,
  ): Promise<RagHit[]> {
    const index = await this.ragBackendService.getLexicalIndex();
    const entries = await Settings.withLLM({} as any, async () => {
      const retriever = index.asRetriever({
        mode: KeywordTableRetrieverMode.SIMPLE,
        numChunksPerQuery: options.limit,
      });

      return (await retriever.retrieve(query)) as RetrieverEntry[];
    });
    const filteredHits = entries
      .map((entry) => this.toCandidateHit(entry, 'lexical'))
      .filter((hit) => this.shouldIncludeHit(hit, options));

    return this.dedupeLexicalHits(filteredHits).slice(0, options.limit);
  }

  /**
   * Retrieves semantic matches from the embedding index.
   * @param query Query text.
   * @param options Resolved query options.
   * @returns Embedding retrieval hits.
   */
  private async retrieveEmbedding(
    query: string,
    options: ResolvedRagQueryOptions,
  ): Promise<RagHit[]> {
    const embeddingIndex = await this.ragBackendService.getEmbeddingIndex();
    const filters = this.buildEmbeddingFilters(options);
    const retriever = embeddingIndex.asRetriever({
      similarityTopK: options.limit,
      ...(filters ? { filters } : {}),
    });
    const entries = (await retriever.retrieve(query)) as RetrieverEntry[];
    const filteredHits = entries
      .map((entry) => this.toCandidateHit(entry, 'embedding'))
      .filter((hit) => this.shouldIncludeHit(hit, options));

    return this.dedupeEmbeddingHits(filteredHits).slice(0, options.limit);
  }

  /**
   * Builds metadata filters for embedding retrieval.
   * @param options Query options.
   * @returns Metadata filters or undefined when none are needed.
   */
  private buildEmbeddingFilters(
    options: RagQueryOptions,
  ): MetadataFilters | undefined {
    const filters: MetadataFilters['filters'] = [];
    const includeInactive = options.includeInactive ?? false;

    if (!includeInactive) {
      filters.push({
        key: 'status',
        value: 1,
        operator: FilterOperator.EQ,
      });
    }

    if (options.contentTypeId) {
      filters.push({
        key: 'contentTypeId',
        value: options.contentTypeId,
        operator: FilterOperator.EQ,
      });
    }

    if (filters.length === 0) {
      return undefined;
    }

    return {
      filters,
      condition: FilterCondition.AND,
    };
  }

  /**
   * Resolves query options with defaults from RAG settings.
   * @param options User-provided options.
   * @param ragSettings RAG defaults.
   * @returns Fully resolved query options.
   */
  private resolveQueryOptions(
    options: RagQueryOptions,
    ragSettings: {
      default_mode: RagMode;
      top_k: number;
    },
  ): ResolvedRagQueryOptions {
    return {
      ...options,
      mode: options.mode ?? ragSettings.default_mode,
      limit: options.limit ?? ragSettings.top_k,
    };
  }

  /**
   * Converts a retriever entry to an internal candidate hit.
   * @param entry Retriever entry.
   * @param source Retrieval mode source.
   * @returns Parsed candidate hit.
   */
  private toCandidateHit(
    entry: RetrieverEntry,
    source: RagMode,
  ): RagCandidateHit {
    const metadata = entry.node.metadata;
    const contentId = this.parseContentId(metadata.contentId, entry.node.id_);
    const title = this.parseTitle(metadata.title, contentId);

    return {
      contentId,
      title,
      text: entry.node.getContent(MetadataMode.NONE),
      score: source === 'embedding' ? this.parseScore(entry.score) : undefined,
      contentTypeId: this.parseContentTypeId(metadata.contentTypeId),
      source,
      _status: this.parseStatus(metadata.status),
    };
  }

  /**
   * Parses a content identifier with fallback support.
   * @param contentId Candidate content identifier.
   * @param fallback Fallback identifier.
   * @returns Parsed content identifier.
   */
  private parseContentId(contentId: unknown, fallback: string): string {
    return this.isNonEmptyString(contentId) ? contentId : fallback;
  }

  /**
   * Parses a title with fallback support.
   * @param title Candidate title value.
   * @param fallback Fallback title.
   * @returns Parsed title.
   */
  private parseTitle(title: unknown, fallback: string): string {
    return this.isNonEmptyString(title) ? title : fallback;
  }

  /**
   * Parses a content type identifier.
   * @param contentTypeId Candidate content type value.
   * @returns Parsed content type identifier.
   */
  private parseContentTypeId(contentTypeId: unknown): string | undefined {
    return this.isNonEmptyString(contentTypeId) ? contentTypeId : undefined;
  }

  /**
   * Parses a content status value.
   * @param status Candidate status value.
   * @returns Parsed status value.
   */
  private parseStatus(status: unknown): number {
    const statusValue = typeof status === 'number' ? status : Number(status);

    return Number.isFinite(statusValue) ? statusValue : 1;
  }

  /**
   * Parses a numeric relevance score.
   * @param score Candidate score value.
   * @returns Parsed score.
   */
  private parseScore(score: unknown): number | undefined {
    return typeof score === 'number' ? score : undefined;
  }

  /**
   * Checks whether a candidate hit satisfies query filters.
   * @param hit Candidate hit.
   * @param options Query options.
   * @returns True when the hit should be included.
   */
  private shouldIncludeHit(
    hit: RagCandidateHit,
    options: RagQueryOptions,
  ): boolean {
    const includeInactive = options.includeInactive ?? false;
    if (!includeInactive && hit._status !== 1) {
      return false;
    }

    if (options.contentTypeId && hit.contentTypeId !== options.contentTypeId) {
      return false;
    }

    return true;
  }

  /**
   * Deduplicates lexical hits by content identifier.
   * @param hits Candidate hits.
   * @returns Deduplicated lexical hits.
   */
  private dedupeLexicalHits(hits: RagCandidateHit[]): RagHit[] {
    const byContentId = new Map<string, RagHit>();
    for (const hit of hits) {
      if (byContentId.has(hit.contentId)) {
        continue;
      }

      byContentId.set(hit.contentId, this.toPublicHit(hit));
    }

    return Array.from(byContentId.values());
  }

  /**
   * Deduplicates embedding hits and keeps the highest score per content item.
   * @param hits Candidate hits.
   * @returns Deduplicated and score-sorted embedding hits.
   */
  private dedupeEmbeddingHits(hits: RagCandidateHit[]): RagHit[] {
    const byContentId = new Map<string, RagHit>();
    for (const hit of hits) {
      const currentHit = byContentId.get(hit.contentId);
      if (!currentHit) {
        byContentId.set(hit.contentId, this.toPublicHit(hit));
        continue;
      }

      if (this.getScore(hit) > this.getScore(currentHit)) {
        byContentId.set(hit.contentId, this.toPublicHit(hit));
      }
    }

    return Array.from(byContentId.values()).sort(
      (left, right) => this.getScore(right) - this.getScore(left),
    );
  }

  /**
   * Removes internal fields from a candidate hit.
   * @param hit Candidate hit.
   * @returns Public hit representation.
   */
  private toPublicHit(hit: RagCandidateHit): RagHit {
    const { _status: _, ...publicHit } = hit;

    return publicHit;
  }

  /**
   * Returns a comparable score value for sorting.
   * @param hit Hit with optional score.
   * @returns Comparable score value.
   */
  private getScore(hit: Pick<RagHit, 'score'>): number {
    return hit.score ?? Number.NEGATIVE_INFINITY;
  }

  /**
   * Checks whether a value is a non-empty string.
   * @param value Candidate value.
   * @returns True when the value is a non-empty string.
   */
  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }
}

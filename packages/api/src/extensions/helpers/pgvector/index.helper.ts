/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHash, randomUUID } from 'node:crypto';

import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ContentFull, Setting } from '@hexabot-ai/types';
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmbeddingModel, embed, embedMany } from 'ai';
import { DataSource } from 'typeorm';

import {
  RagHelperConfigurationError,
  RagHelperUnavailableError,
} from '@/cms/errors/rag.errors';
import { RagHit, RagQueryOptions } from '@/cms/types/rag';
import { BaseRagHelper } from '@/helper/lib/base-rag-helper';
import { HelperType } from '@/helper/types';
import { CredentialService } from '@/user/services/credential.service';

import { chunkSearchText } from './chunker';
import {
  PGVECTOR_RAG_HELPER_NAME,
  pgvectorSettingsSchema,
} from './pgvector.settings';
import {
  PgvectorEmbeddedChunk,
  PgvectorJob,
  PgvectorStore,
} from './pgvector.store';

const WORKER_INTERVAL_MS = 2000;
const RECONCILIATION_INTERVAL_MS = 60000;
const WORKER_CONCURRENCY = 2;
const EMBEDDING_TIMEOUT_MS = 60000;

type PgvectorSettings = {
  embedding_provider: string;
  embedding_model: string;
  embedding_api_key: string;
  embedding_base_url: string;
  embedding_dimensions: number;
  chunk_size: number;
  chunk_overlap: number;
  index_only_active_content: boolean;
};

type EmbeddingProviderInitOptions = {
  apiKey?: string;
  baseURL?: string;
};

type EmbeddingProvider = {
  embeddingModel?: (modelId: string) => EmbeddingModel;
  textEmbeddingModel?: (modelId: string) => EmbeddingModel;
  embedding?: (modelId: string) => EmbeddingModel;
};

type EmbeddingProviderFactory = (
  options: EmbeddingProviderInitOptions,
) => unknown;

@Injectable()
export default class PgvectorRagHelper
  extends BaseRagHelper<typeof PGVECTOR_RAG_HELPER_NAME>
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly store: PgvectorStore;

  private readonly workerId = randomUUID();

  private workerTimer?: NodeJS.Timeout;

  private processing = false;

  private wakeScheduled = false;

  private lastReconciliationAt = 0;

  private infrastructureWarningLogged = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly credentialService: CredentialService,
  ) {
    super(PGVECTOR_RAG_HELPER_NAME);
    this.store = new PgvectorStore(dataSource);
  }

  public override isAvailable(): boolean {
    return this.dataSource.options.type === 'postgres';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    this.workerTimer = setInterval(() => this.wakeWorker(), WORKER_INTERVAL_MS);
    this.workerTimer.unref();
    this.wakeWorker();
  }

  onApplicationShutdown(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = undefined;
    }
  }

  async retrieve(
    query: string,
    options: RagQueryOptions = {},
  ): Promise<RagHit[]> {
    const trimmed = query?.trim();
    if (!trimmed) {
      return [];
    }

    const settings = await this.getConfiguration();
    await this.store.assertInfrastructure();
    const embedding = await this.embedQuery(trimmed, settings);
    const profile = this.getProfile(settings);
    const { rag_settings } = await this.settingService.getSettings();
    const limit = options.limit ?? rag_settings.top_k;
    const hits = await this.store.search(embedding, profile, {
      status: options.includeInactive ? undefined : true,
      contentTypeId: options.contentTypeId,
      limit,
    });

    return hits.map((hit) => ({
      ...hit,
      source: PGVECTOR_RAG_HELPER_NAME,
    }));
  }

  /**
   * Content triggers already enqueue durable work in the same transaction.
   * This lifecycle hook only reduces the worker's wake-up latency.
   */
  async index(_content: ContentFull): Promise<void> {
    this.wakeWorker();
  }

  /**
   * Enqueues a bounded job per live content row. Existing embeddings remain
   * usable until their replacement profile succeeds.
   */
  async reindex(): Promise<void> {
    await this.store.enqueueAll();
    this.wakeWorker();
  }

  @OnEvent('hook:pgvector:*')
  async handleSettingsChanged(setting?: Pick<Setting, 'label'>): Promise<void> {
    if (!this.isAvailable() || !setting?.label) {
      return;
    }

    try {
      if (setting.label === 'embedding_api_key') {
        await this.store.wakePendingRetries();
      } else if (
        [
          'embedding_provider',
          'embedding_model',
          'embedding_base_url',
          'embedding_dimensions',
          'chunk_size',
          'chunk_overlap',
          // Re-evaluate every row: the worker embeds active content and drops
          // inactive content, so toggling in either direction converges the
          // index (purging inactive rows when enabled, backfilling them when
          // disabled).
          'index_only_active_content',
        ].includes(setting.label)
      ) {
        await this.store.enqueueAll();
      }
      this.wakeWorker();
    } catch (error) {
      this.logger.error(
        'Unable to schedule pgvector RAG work after a settings change.',
        error,
      );
    }
  }

  private wakeWorker(): void {
    if (this.wakeScheduled || this.processing || !this.isAvailable()) {
      return;
    }

    this.wakeScheduled = true;
    queueMicrotask(() => {
      this.wakeScheduled = false;
      void this.processJobs();
    });
  }

  private async processJobs(): Promise<void> {
    if (this.processing || !(await this.isSelected())) {
      return;
    }

    this.processing = true;
    let claimedJobs = 0;
    try {
      const settings = await this.getConfiguration();
      const profile = this.getProfile(settings);
      if (
        Date.now() - this.lastReconciliationAt >=
        RECONCILIATION_INTERVAL_MS
      ) {
        await this.store.enqueueMissing(
          profile,
          settings.index_only_active_content,
        );
        this.lastReconciliationAt = Date.now();
      }

      const jobs = await this.store.claimJobs(
        this.workerId,
        WORKER_CONCURRENCY,
      );
      claimedJobs = jobs.length;
      await Promise.all(
        jobs.map((job) => this.processJob(job, settings, profile)),
      );
      this.infrastructureWarningLogged = false;
    } catch (error) {
      if (error instanceof RagHelperConfigurationError) {
        return;
      }

      if (
        error instanceof RagHelperUnavailableError &&
        this.infrastructureWarningLogged
      ) {
        return;
      }
      this.infrastructureWarningLogged =
        error instanceof RagHelperUnavailableError;
      this.logger.error('Unable to process the pgvector RAG queue.', error);
    } finally {
      this.processing = false;
      if (claimedJobs === WORKER_CONCURRENCY) {
        this.wakeWorker();
      }
    }
  }

  private async processJob(
    job: PgvectorJob,
    settings: PgvectorSettings,
    profile: string,
  ): Promise<void> {
    try {
      const content = await this.store.loadContent(job.contentId);
      if (!content) {
        return;
      }

      // Never embed (i.e. transmit to the external provider) inactive content
      // when the operator opted to index only active content. Drop any existing
      // embeddings and clear the job instead.
      if (settings.index_only_active_content && !content.status) {
        await this.store.discardInactive(job, this.workerId);

        return;
      }

      const chunks = chunkSearchText(
        content.searchText,
        settings.chunk_size,
        settings.chunk_overlap,
      );
      const embeddings = chunks.length
        ? await this.embedChunks(
            chunks.map(({ text }) => text),
            settings,
          )
        : [];
      const embeddedChunks: PgvectorEmbeddedChunk[] = chunks.map(
        (chunk, index) => ({
          ...chunk,
          embedding: embeddings[index],
        }),
      );
      await this.store.save(
        job,
        this.workerId,
        profile,
        content.searchText,
        embeddedChunks,
      );
    } catch (error) {
      await this.store.fail(job, this.workerId, error);
      this.logger.warn(
        `Unable to embed content "${job.contentId}"; the durable RAG job will be retried.`,
        error,
      );
    }
  }

  private async isSelected(): Promise<boolean> {
    try {
      const helper = await this.helperService.getDefaultHelper(HelperType.RAG);

      return helper.getName() === PGVECTOR_RAG_HELPER_NAME;
    } catch {
      return false;
    }
  }

  private async getConfiguration(): Promise<PgvectorSettings> {
    const result = pgvectorSettingsSchema.safeParse(
      await this.getSettings<typeof PGVECTOR_RAG_HELPER_NAME>(),
    );
    if (!result.success) {
      throw new RagHelperConfigurationError(
        'The pgvector RAG helper settings are missing or invalid.',
      );
    }

    const settings = result.data;
    const credentialId = settings.embedding_api_key.trim();
    if (!credentialId) {
      throw new RagHelperConfigurationError(
        'The pgvector RAG helper requires an embedding credential.',
      );
    }
    const apiKey = (
      await this.credentialService.findOneValue(credentialId)
    ).trim();
    if (!apiKey) {
      throw new RagHelperConfigurationError(
        'The selected pgvector embedding credential is missing or empty.',
      );
    }

    return {
      ...settings,
      embedding_provider: settings.embedding_provider.trim(),
      embedding_api_key: apiKey,
      embedding_model: settings.embedding_model.trim(),
      embedding_base_url: settings.embedding_base_url.replace(/\/+$/, ''),
    };
  }

  private getProfile(settings: PgvectorSettings): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          provider: settings.embedding_provider,
          baseUrl: settings.embedding_base_url,
          model: settings.embedding_model,
          dimensions: settings.embedding_dimensions,
          chunkSize: settings.chunk_size,
          chunkOverlap: settings.chunk_overlap,
        }),
      )
      .digest('hex');
  }

  private async getEmbeddingModel(
    settings: PgvectorSettings,
  ): Promise<EmbeddingModel> {
    const provider = await this.loadEmbeddingProvider(settings);
    const embeddingModel = provider.embeddingModel;
    if (typeof embeddingModel === 'function') {
      return embeddingModel.call(provider, settings.embedding_model);
    }
    const textEmbeddingModel = provider.textEmbeddingModel;
    if (typeof textEmbeddingModel === 'function') {
      return textEmbeddingModel.call(provider, settings.embedding_model);
    }
    const embedding = provider.embedding;
    if (typeof embedding === 'function') {
      return embedding.call(provider, settings.embedding_model);
    }

    throw new RagHelperConfigurationError(
      `Provider "${settings.embedding_provider}" does not expose an embedding model.`,
    );
  }

  private async embedQuery(
    value: string,
    settings: PgvectorSettings,
  ): Promise<number[]> {
    const providerOptions = this.getEmbeddingProviderOptions(settings);
    const result = await embed({
      model: await this.getEmbeddingModel(settings),
      value,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      ...(providerOptions ? { providerOptions } : {}),
    });

    return this.validateEmbedding(result.embedding, settings);
  }

  private async embedChunks(
    values: string[],
    settings: PgvectorSettings,
  ): Promise<number[][]> {
    const providerOptions = this.getEmbeddingProviderOptions(settings);
    const result = await embedMany({
      model: await this.getEmbeddingModel(settings),
      values,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      ...(providerOptions ? { providerOptions } : {}),
    });
    if (result.embeddings.length !== values.length) {
      throw new RagHelperConfigurationError(
        `The embedding endpoint returned ${result.embeddings.length} vectors for ${values.length} chunks.`,
      );
    }

    return result.embeddings.map((embedding) =>
      this.validateEmbedding(embedding, settings),
    );
  }

  private getEmbeddingProviderOptions(
    settings: PgvectorSettings,
  ): Record<string, { dimensions: number }> | undefined {
    return this.getProviderId(settings.embedding_provider) === 'openai'
      ? {
          openai: {
            dimensions: settings.embedding_dimensions,
          },
        }
      : undefined;
  }

  private async loadEmbeddingProvider(
    settings: PgvectorSettings,
  ): Promise<EmbeddingProvider> {
    const provider = settings.embedding_provider;
    const providerId = this.getProviderId(provider);
    const options: EmbeddingProviderInitOptions = {
      apiKey: settings.embedding_api_key,
      baseURL: settings.embedding_base_url || undefined,
    };

    if (providerId === 'openai') {
      return createOpenAI(options);
    }

    if (providerId === 'gateway') {
      const { createGatewayProvider } = await import('@ai-sdk/gateway');

      return createGatewayProvider(options);
    }

    if (providerId === 'litellm' || providerId === 'openai-compatible') {
      if (!options.baseURL) {
        throw new RagHelperConfigurationError(
          `Provider "${provider}" requires an embedding base URL.`,
        );
      }

      return createOpenAICompatible({
        ...options,
        name: providerId,
        baseURL: options.baseURL,
      });
    }

    const normalized = provider.trim().toLowerCase();
    const moduleCandidates = new Set([
      provider,
      normalized,
      providerId,
      `@ai-sdk/${providerId}`,
    ]);
    let lastError: unknown;

    for (const moduleName of moduleCandidates) {
      try {
        const providerModule = await import(moduleName);
        const resolved = this.instantiateEmbeddingProvider(
          providerModule,
          providerId,
          options,
        );
        if (resolved) {
          return resolved;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw new RagHelperConfigurationError(
      `Unsupported embedding provider "${provider}". Install the matching AI SDK provider package (for example @ai-sdk/${providerId}) and ensure it supports embeddings.` +
        (lastError ? ` Last error: ${(lastError as Error).message}` : ''),
    );
  }

  private instantiateEmbeddingProvider(
    providerModule: Record<string, unknown>,
    provider: string,
    options: EmbeddingProviderInitOptions,
  ): EmbeddingProvider | undefined {
    for (const factory of this.getProviderFactories(providerModule, provider)) {
      try {
        const created = factory(options);
        if (this.isEmbeddingProvider(created)) {
          return created;
        }
      } catch {
        // Try the next matching provider factory.
      }
    }

    const candidates = [
      providerModule[provider],
      providerModule.default,
      ...Object.values(providerModule),
    ];

    return candidates.find((candidate) =>
      this.isEmbeddingProvider(candidate),
    ) as EmbeddingProvider | undefined;
  }

  private getProviderFactories(
    providerModule: Record<string, unknown>,
    provider: string,
  ): EmbeddingProviderFactory[] {
    const pascalName = provider
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('');
    const preferredNames = [
      `create${pascalName}`,
      `create${pascalName}Provider`,
      `create${pascalName}AI`,
      'createProvider',
    ];
    const factories: EmbeddingProviderFactory[] = [];
    const seen = new Set<unknown>();

    for (const name of preferredNames) {
      const candidate = providerModule[name];
      if (typeof candidate === 'function' && !seen.has(candidate)) {
        factories.push(candidate as EmbeddingProviderFactory);
        seen.add(candidate);
      }
    }
    for (const [name, candidate] of Object.entries(providerModule)) {
      if (
        typeof candidate === 'function' &&
        name.startsWith('create') &&
        name.toLowerCase().includes(provider) &&
        !seen.has(candidate)
      ) {
        factories.push(candidate as EmbeddingProviderFactory);
        seen.add(candidate);
      }
    }

    return factories;
  }

  private isEmbeddingProvider(
    candidate: unknown,
  ): candidate is EmbeddingProvider {
    if (
      !candidate ||
      (typeof candidate !== 'function' && typeof candidate !== 'object')
    ) {
      return false;
    }
    const provider = candidate as EmbeddingProvider;

    return (
      typeof provider.embeddingModel === 'function' ||
      typeof provider.textEmbeddingModel === 'function' ||
      typeof provider.embedding === 'function'
    );
  }

  private getProviderId(provider: string): string {
    const normalized = provider
      .trim()
      .toLowerCase()
      .replace(/^@ai-sdk\//, '')
      .replace(/^ai-sdk\//, '');
    const aliases: Record<string, string> = {
      claude: 'anthropic',
      gemini: 'google',
      'google-generative-ai': 'google',
      'google-vertex-ai': 'google-vertex',
      'azure-openai': 'azure',
    };

    return aliases[normalized] ?? normalized;
  }

  private validateEmbedding(
    embedding: number[],
    settings: PgvectorSettings,
  ): number[] {
    if (embedding.length !== settings.embedding_dimensions) {
      throw new RagHelperConfigurationError(
        `Embedding dimension mismatch: expected ${settings.embedding_dimensions}, received ${embedding.length}.`,
      );
    }
    if (
      embedding.some((value) => !Number.isFinite(value)) ||
      !embedding.some((value) => value !== 0)
    ) {
      throw new RagHelperConfigurationError(
        'The embedding endpoint returned an invalid or zero vector.',
      );
    }

    return embedding;
  }
}

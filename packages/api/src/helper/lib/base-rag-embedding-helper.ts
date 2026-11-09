/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHash } from 'node:crypto';

import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  APICallError,
  EmbeddingModel,
  RetryError,
  embed,
  embedMany,
  wrapEmbeddingModel,
} from 'ai';

import { RagHelperConfigurationError } from '@/cms/errors/rag.errors';

import { HelperName } from '../types';

import BaseRagHelper from './base-rag-helper';

const EMBEDDING_TIMEOUT_MS = 60000;
const DEFAULT_EMBEDDING_MAX_PARALLEL_CALLS = 4;
const DEFAULT_EMBEDDING_MAX_RETRIES = 2;

/**
 * The embedding configuration every vector RAG helper exposes. Helpers declare
 * their own settings schema (and may add fields of their own); this is the
 * subset the shared embedding layer reads.
 */
/** One window of content text, ready to be embedded and stored. */
export interface RagChunk {
  index: number;
  text: string;
}

export interface RagEmbeddingSettings {
  embedding_provider: string;
  embedding_model: string;
  embedding_api_key: string;
  embedding_base_url: string;
  embedding_dimensions: number;
  chunk_size: number;
  chunk_overlap: number;
  /**
   * Embedding requests `embedChunks` sends at once. Providers without batch
   * embedding (e.g. Amazon Bedrock Titan) send one request per chunk.
   * Defaults to 4.
   */
  embedding_max_parallel_calls?: number;
  /**
   * Retries of a rate-limited (429) or failed (5xx) chunk embedding request,
   * with exponential backoff. Defaults to 2.
   */
  embedding_max_retries?: number;
}

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

/**
 * Base class for RAG helpers that build their index from an external embedding
 * provider.
 *
 * It owns everything that must stay identical between such helpers: chunking
 * the content text, resolving a Vercel AI SDK provider from the operator's
 * settings, embedding queries and chunks, validating the returned vectors, and
 * deriving the profile hash that keys stored vectors to the configuration that
 * produced them. Two helpers that disagreed on any of these would produce
 * indexes that cannot be compared or migrated between.
 *
 * Subclasses own their storage, their lifecycle strategy (durable queue vs.
 * direct indexing) and their settings schema.
 */
export abstract class BaseRagEmbeddingHelper<
  N extends HelperName = HelperName,
> extends BaseRagHelper<N> {
  /** Set once the "requested dimension not honored" warning has been logged. */
  protected dimensionMismatchWarned = false;

  /**
   * Splits canonical content text into deterministic, overlapping character
   * windows. Newline boundaries are preferred in the latter half of a window;
   * oversized lines are hard-split at the configured size.
   *
   * Lives here so every embedding-backed helper chunks identically: the window
   * boundaries are baked into each stored vector, so two helpers that disagreed
   * about them would produce indexes that cannot be compared or migrated
   * between. `getProfile` hashes the chunk settings for the same reason.
   * Determinism matters too — re-chunking unchanged text must yield
   * byte-identical windows, or every reconciliation pass would consider the
   * whole corpus stale.
   *
   * @throws RangeError when the chunk size or overlap is not usable.
   */
  protected chunkSearchText(
    source: string,
    chunkSize: number,
    overlap: number,
  ): RagChunk[] {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      throw new RangeError('Chunk size must be a positive integer.');
    }
    if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
      throw new RangeError(
        'Chunk overlap must be a non-negative integer smaller than chunk size.',
      );
    }

    const text = source.replace(/\r\n?/g, '\n');
    const chunks: RagChunk[] = [];
    let start = 0;

    while (start < text.length) {
      const hardEnd = Math.min(start + chunkSize, text.length);
      let end = hardEnd;

      if (hardEnd < text.length) {
        const minimumBoundary = start + Math.floor(chunkSize / 2);
        const paragraphBoundary = text.lastIndexOf('\n\n', hardEnd - 1);
        const lineBoundary = text.lastIndexOf('\n', hardEnd - 1);
        if (paragraphBoundary >= minimumBoundary) {
          end = paragraphBoundary + 2;
        } else if (lineBoundary >= minimumBoundary) {
          end = lineBoundary + 1;
        }
      }

      const value = text.slice(start, end).trim();
      if (value) {
        chunks.push({
          index: chunks.length,
          text: value,
        });
      }

      if (end >= text.length) {
        break;
      }

      const nextStart = Math.max(0, end - overlap);
      start = nextStart > start ? nextStart : end;
    }

    return chunks;
  }

  protected getProfile(settings: RagEmbeddingSettings): string {
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

  protected async getEmbeddingModel(
    settings: RagEmbeddingSettings,
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

  protected async embedQuery(
    value: string,
    settings: RagEmbeddingSettings,
  ): Promise<number[]> {
    const providerOptions = this.getEmbeddingProviderOptions(settings);
    const result = await embed({
      model: await this.getEmbeddingModel(settings),
      value,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      ...(providerOptions ? { providerOptions } : {}),
    });
    const embedding = this.validateEmbedding(result.embedding);
    this.warnIfRequestedDimensionIgnored(settings, embedding.length);

    return embedding;
  }

  protected async embedChunks(
    values: string[],
    settings: RagEmbeddingSettings,
  ): Promise<number[][]> {
    const providerOptions = this.getEmbeddingProviderOptions(settings);
    const result = await embedMany({
      model: this.withRequestTimeout(await this.getEmbeddingModel(settings)),
      values,
      maxParallelCalls:
        settings.embedding_max_parallel_calls ??
        DEFAULT_EMBEDDING_MAX_PARALLEL_CALLS,
      maxRetries:
        settings.embedding_max_retries ?? DEFAULT_EMBEDDING_MAX_RETRIES,
      ...(providerOptions ? { providerOptions } : {}),
    });
    if (result.embeddings.length !== values.length) {
      throw new RagHelperConfigurationError(
        `The embedding endpoint returned ${result.embeddings.length} vectors for ${values.length} chunks.`,
      );
    }

    const embeddings = result.embeddings.map((embedding) =>
      this.validateEmbedding(embedding),
    );
    // The stored chunks of one document must share a dimension so cosine search
    // can compare them against a query vector of the same size.
    const dimension = embeddings[0]?.length;
    if (
      dimension !== undefined &&
      embeddings.some((embedding) => embedding.length !== dimension)
    ) {
      throw new RagHelperConfigurationError(
        'The embedding endpoint returned vectors of inconsistent dimensions.',
      );
    }
    if (dimension !== undefined) {
      this.warnIfRequestedDimensionIgnored(settings, dimension);
    }

    return embeddings;
  }

  /**
   * Applies the embedding timeout to each provider request instead of the
   * whole `embedMany` call: with bounded parallelism and retries, a long
   * document takes several rounds of requests, which must not share one budget.
   * The SDK transforms the parameters on every attempt, so each retry gets a
   * fresh timeout.
   *
   * `wrapEmbeddingModel` only accepts V3 models, which every AI SDK v6
   * provider returns; other models are passed through unchanged.
   */
  protected withRequestTimeout(model: EmbeddingModel): EmbeddingModel {
    if (typeof model === 'string' || model.specificationVersion !== 'v3') {
      return model;
    }

    return wrapEmbeddingModel({
      model,
      middleware: {
        specificationVersion: 'v3',
        transformParams: async ({ params }) => {
          const timeout = AbortSignal.timeout(EMBEDDING_TIMEOUT_MS);

          return {
            ...params,
            abortSignal: params.abortSignal
              ? AbortSignal.any([params.abortSignal, timeout])
              : timeout,
          };
        },
      },
    });
  }

  /**
   * Whether an embedding call failed because the provider is rate limiting
   * requests (HTTP 429), including after the SDK exhausted its retries.
   */
  protected isRateLimitError(error: unknown): boolean {
    const cause = RetryError.isInstance(error) ? error.lastError : error;

    return APICallError.isInstance(cause) && cause.statusCode === 429;
  }

  protected getEmbeddingProviderOptions(
    settings: RagEmbeddingSettings,
  ): Record<string, { dimensions: number }> | undefined {
    return this.getProviderId(settings.embedding_provider) === 'openai'
      ? {
          openai: {
            dimensions: settings.embedding_dimensions,
          },
        }
      : undefined;
  }

  protected async loadEmbeddingProvider(
    settings: RagEmbeddingSettings,
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

  protected instantiateEmbeddingProvider(
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

  protected getProviderFactories(
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

  protected isEmbeddingProvider(
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

  protected getProviderId(provider: string): string {
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

  /**
   * Validates the structure of an embedding vector. The dimension is treated as
   * an output of the model, not a value the operator must match: consistency
   * between the query vector and the stored chunks is guaranteed by the profile
   * hash (which includes provider, model, and requested dimensions), so we only
   * reject empty, non-finite, or all-zero vectors here.
   */
  protected validateEmbedding(embedding: number[]): number[] {
    if (
      embedding.length === 0 ||
      embedding.some((value) => !Number.isFinite(value)) ||
      !embedding.some((value) => value !== 0)
    ) {
      throw new RagHelperConfigurationError(
        'The embedding endpoint returned an invalid, empty, or zero vector.',
      );
    }

    return embedding;
  }

  /**
   * The "Embedding dimensions" setting is only a *request*: providers that
   * support dimension reduction (e.g. OpenAI) honor it, others return their
   * model's native size. When a non-zero request is not honored we log once so
   * the discrepancy is visible without failing indexing or retrieval.
   */
  protected warnIfRequestedDimensionIgnored(
    settings: RagEmbeddingSettings,
    actualDimension: number,
  ): void {
    const requested = settings.embedding_dimensions;
    if (
      this.dimensionMismatchWarned ||
      !requested ||
      requested === actualDimension
    ) {
      return;
    }
    this.dimensionMismatchWarned = true;
    this.logger.warn(
      `The embedding model returned ${actualDimension}-dimensional vectors, ` +
        `but "Embedding dimensions" is set to ${requested}. The requested size ` +
        `is only applied by providers that support dimension reduction; the ` +
        `model's ${actualDimension}-dimensional output is being used.`,
    );
  }
}

export default BaseRagEmbeddingHelper;

/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
} from '@ai-sdk/provider';
import { APICallError, RetryError } from 'ai';

import { RagHit } from '@/cms/types/rag';

import BaseRagEmbeddingHelper, {
  RagChunk,
  RagEmbeddingSettings,
} from './base-rag-embedding-helper';

class ChunkingRagHelper extends BaseRagEmbeddingHelper {
  constructor() {
    super('chunking-rag-helper');
  }

  async retrieve(): Promise<RagHit[]> {
    return [];
  }

  /** Exposes the inherited protected chunker to the assertions below. */
  chunk(source: string, chunkSize: number, overlap: number): RagChunk[] {
    return this.chunkSearchText(source, chunkSize, overlap);
  }
}

const baseSettings: RagEmbeddingSettings = {
  embedding_provider: 'fake',
  embedding_model: 'fake-embedding',
  embedding_api_key: 'secret',
  embedding_base_url: '',
  embedding_dimensions: 2,
  chunk_size: 2000,
  chunk_overlap: 200,
};

/** Embeds with a fake provider model instead of resolving a real provider. */
class FakeProviderRagHelper extends BaseRagEmbeddingHelper {
  constructor(private readonly model: EmbeddingModelV3) {
    super('fake-provider-rag-helper');
  }

  async retrieve(): Promise<RagHit[]> {
    return [];
  }

  protected override async getEmbeddingModel(): Promise<EmbeddingModelV3> {
    return this.model;
  }

  embed(values: string[], settings: Partial<RagEmbeddingSettings> = {}) {
    return this.embedChunks(values, { ...baseSettings, ...settings });
  }

  isRateLimited(error: unknown): boolean {
    return this.isRateLimitError(error);
  }
}

/** Like Amazon Bedrock Titan: one value per request, parallel calls allowed. */
const createSingleValueModel = (
  doEmbed: EmbeddingModelV3['doEmbed'],
): EmbeddingModelV3 => ({
  specificationVersion: 'v3',
  provider: 'fake',
  modelId: 'fake-embedding',
  maxEmbeddingsPerCall: 1,
  supportsParallelCalls: true,
  doEmbed,
});
const apiCallError = (statusCode: number) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://embeddings.test',
    requestBodyValues: {},
    statusCode,
    // Retry right away instead of after the SDK's 2 s backoff.
    responseHeaders: { 'retry-after-ms': '0' },
  });

describe('BaseRagEmbeddingHelper chunking', () => {
  const helper = new ChunkingRagHelper();

  it('prefers paragraph and line boundaries with deterministic overlap', () => {
    const source =
      'First paragraph line.\nSecond paragraph line.\nThird paragraph line.';
    const first = helper.chunk(source, 50, 8);
    const second = helper.chunk(source, 50, 8);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0].text).toBe('First paragraph line.\nSecond paragraph line.');
    expect(first[1].text).toContain('Third paragraph line.');
    expect(first.map(({ index }) => index)).toEqual([0, 1]);
  });

  it('hard-splits oversized lines while retaining overlap', () => {
    expect(helper.chunk('abcdefghij', 4, 1)).toEqual([
      { index: 0, text: 'abcd' },
      { index: 1, text: 'defg' },
      { index: 2, text: 'ghij' },
    ]);
  });

  it('normalizes line endings and discards blank chunks', () => {
    const chunks = helper.chunk('alpha\r\n\r\nbeta', 7, 1);

    expect(chunks.every(({ text }) => text.length > 0)).toBe(true);
    expect(chunks.map(({ text }) => text).join(' ')).not.toContain('\r');
  });

  it('rejects invalid chunking settings', () => {
    expect(() => helper.chunk('text', 0, 0)).toThrow(RangeError);
    expect(() => helper.chunk('text', 4, 4)).toThrow(RangeError);
    expect(() => helper.chunk('text', 4, -1)).toThrow(RangeError);
  });

  it('chunks identically for every helper that inherits it', () => {
    // The window boundaries are baked into stored vectors, so two embedding
    // helpers must never disagree about them.
    const other = new ChunkingRagHelper();
    const source = 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta';

    expect(helper.chunk(source, 12, 3)).toEqual(other.chunk(source, 12, 3));
  });
});

describe('BaseRagEmbeddingHelper chunk embedding', () => {
  const values = Array.from({ length: 10 }, (_, index) => `chunk ${index}`);
  /** Records the peak number of provider requests in flight at once. */
  const trackConcurrency = () => {
    let inFlight = 0;
    const tracker = { peak: 0, calls: [] as EmbeddingModelV3CallOptions[] };
    const model = createSingleValueModel(async (options) => {
      tracker.calls.push(options);
      inFlight += 1;
      tracker.peak = Math.max(tracker.peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;

      return { embeddings: [[1, 0]], warnings: [] };
    });

    return { model, tracker };
  };

  it('caps parallel provider requests at 4 by default', async () => {
    const { model, tracker } = trackConcurrency();
    const embeddings = await new FakeProviderRagHelper(model).embed(values);

    expect(embeddings).toHaveLength(values.length);
    expect(tracker.calls).toHaveLength(values.length);
    expect(tracker.peak).toBe(4);
  });

  it('caps parallel provider requests at the configured value', async () => {
    const { model, tracker } = trackConcurrency();

    await new FakeProviderRagHelper(model).embed(values, {
      embedding_max_parallel_calls: 2,
    });

    expect(tracker.peak).toBe(2);
  });

  it('applies a timeout to every provider request', async () => {
    const { model, tracker } = trackConcurrency();

    await new FakeProviderRagHelper(model).embed(values);

    expect(
      tracker.calls.every(
        ({ abortSignal }) => abortSignal && !abortSignal.aborted,
      ),
    ).toBe(true);
  });

  it('retries a rate-limited request', async () => {
    const doEmbed = jest
      .fn()
      .mockRejectedValueOnce(apiCallError(429))
      .mockResolvedValue({ embeddings: [[1, 0]], warnings: [] });
    const helper = new FakeProviderRagHelper(createSingleValueModel(doEmbed));

    await expect(helper.embed(['chunk'])).resolves.toEqual([[1, 0]]);
    expect(doEmbed).toHaveBeenCalledTimes(2);
  });

  it('fails on the first rate-limited request when retries are disabled', async () => {
    const doEmbed = jest
      .fn()
      .mockRejectedValueOnce(apiCallError(429))
      .mockResolvedValue({ embeddings: [[1, 0]], warnings: [] });
    const helper = new FakeProviderRagHelper(createSingleValueModel(doEmbed));
    const failure = helper.embed(['chunk'], { embedding_max_retries: 0 });

    await expect(failure).rejects.toThrow('HTTP 429');
    expect(doEmbed).toHaveBeenCalledTimes(1);
  });

  it('recognizes rate-limit errors, including after exhausted retries', async () => {
    const helper = new FakeProviderRagHelper(
      createSingleValueModel(() => Promise.reject(apiCallError(429))),
    );
    const exhausted = await helper
      .embed(['chunk'], { embedding_max_retries: 1 })
      .catch((error: unknown) => error);

    expect(RetryError.isInstance(exhausted)).toBe(true);
    expect(helper.isRateLimited(exhausted)).toBe(true);
    expect(helper.isRateLimited(apiCallError(429))).toBe(true);
    expect(helper.isRateLimited(apiCallError(401))).toBe(false);
    expect(helper.isRateLimited(apiCallError(500))).toBe(false);
    expect(helper.isRateLimited(new Error('Too many requests'))).toBe(false);
  });
});

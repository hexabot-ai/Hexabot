/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

/**
 * Raised when RAG embedding retrieval is requested but the embedding
 * settings (provider, API key) are incomplete. Distinguishes a
 * configuration gap from genuine backend/infrastructure failures so
 * callers can degrade gracefully instead of failing hard.
 */
export class RagEmbeddingNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RagEmbeddingNotConfiguredError';
  }
}

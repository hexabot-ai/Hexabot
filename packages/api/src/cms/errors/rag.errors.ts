/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

/**
 * Raised when the selected RAG helper needs user-supplied configuration before
 * it can serve queries.
 */
export class RagHelperConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RagHelperConfigurationError';
  }
}

/**
 * Raised when a RAG helper cannot run against the current database or when its
 * required database structures are unavailable.
 */
export class RagHelperUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RagHelperUnavailableError';
  }
}

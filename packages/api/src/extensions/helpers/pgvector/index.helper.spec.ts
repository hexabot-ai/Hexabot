/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(),
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(),
}));
jest.mock('ai', () => ({
  embed: jest.fn(),
  embedMany: jest.fn(),
}));

import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany } from 'ai';
import { DataSource } from 'typeorm';

import { RagHelperConfigurationError } from '@/cms/errors/rag.errors';

import PgvectorRagHelper from './index.helper';

const validSettings = {
  pgvector: {
    embedding_provider: 'openai',
    embedding_model: 'text-embedding-3-small',
    embedding_api_key: 'credential-id',
    embedding_base_url: '',
    embedding_dimensions: 2,
    chunk_size: 2000,
    chunk_overlap: 200,
  },
  rag_settings: {
    top_k: 3,
  },
};
const createHelper = (type: 'postgres' | 'better-sqlite3' = 'postgres') => {
  const credentialService = {
    findOneValue: jest.fn().mockResolvedValue('secret'),
  };
  const helper = new PgvectorRagHelper(
    {
      options: { type },
    } as DataSource,
    credentialService as never,
  );
  const store = {
    assertInfrastructure: jest.fn(),
    search: jest.fn().mockResolvedValue([]),
    enqueueAll: jest.fn(),
    enqueueMissing: jest.fn(),
    wakePendingRetries: jest.fn(),
    claimJobs: jest.fn().mockResolvedValue([]),
    loadContent: jest.fn(),
    discardInactive: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(true),
    fail: jest.fn(),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  (helper as unknown as { store: unknown }).store = store;
  (helper as unknown as { settingService: unknown }).settingService = {
    getSettings: jest.fn().mockResolvedValue(validSettings),
  };
  (helper as unknown as { logger: unknown }).logger = logger;
  (helper as unknown as { wakeWorker: jest.Mock }).wakeWorker = jest.fn();

  return { credentialService, helper, store, logger };
};

describe('PgvectorRagHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createOpenAI as jest.Mock).mockReturnValue({
      embedding: jest.fn().mockReturnValue({ modelId: 'embedding-model' }),
    });
    (embed as jest.Mock).mockResolvedValue({ embedding: [1, 0] });
  });

  it('is registered only for PostgreSQL environments', () => {
    expect(createHelper('postgres').helper.isAvailable()).toBe(true);
    expect(createHelper('better-sqlite3').helper.isAvailable()).toBe(false);
  });

  it('embeds the query and performs exact profile-scoped retrieval', async () => {
    const { helper, store } = createHelper();
    store.search.mockResolvedValue([
      {
        contentId: 'c1',
        title: 'Content',
        text: 'best chunk',
        score: 0.8,
      },
    ]);

    await expect(helper.retrieve('semantic query')).resolves.toEqual([
      {
        contentId: 'c1',
        title: 'Content',
        text: 'best chunk',
        score: 0.8,
        source: 'pgvector',
      },
    ]);

    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'semantic query',
        maxRetries: 0,
        providerOptions: {
          openai: {
            dimensions: 2,
          },
        },
      }),
    );
    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: 'secret',
      baseURL: undefined,
    });
    expect(store.search).toHaveBeenCalledWith(
      [1, 0],
      expect.stringMatching(/^[a-f0-9]{64}$/),
      {
        status: true,
        contentTypeId: undefined,
        limit: 3,
      },
    );
  });

  it('uses the selected embedding provider', async () => {
    const { helper } = createHelper();
    (
      helper as unknown as {
        settingService: { getSettings: jest.Mock };
      }
    ).settingService.getSettings.mockResolvedValue({
      ...validSettings,
      pgvector: {
        ...validSettings.pgvector,
        embedding_provider: 'openai-compatible',
        embedding_base_url: 'https://embeddings.example/v1',
      },
    });
    (createOpenAICompatible as jest.Mock).mockReturnValue({
      embeddingModel: jest.fn().mockReturnValue({
        modelId: 'compatible-embedding-model',
      }),
    });

    await helper.retrieve('semantic query');

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      apiKey: 'secret',
      baseURL: 'https://embeddings.example/v1',
      name: 'openai-compatible',
    });
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('fails explicitly when the embedding credential is missing', async () => {
    const { helper, store } = createHelper();
    (
      helper as unknown as {
        settingService: { getSettings: jest.Mock };
      }
    ).settingService.getSettings.mockResolvedValue({
      ...validSettings,
      pgvector: {
        ...validSettings.pgvector,
        embedding_api_key: '',
      },
    });

    await expect(helper.retrieve('query')).rejects.toBeInstanceOf(
      RagHelperConfigurationError,
    );
    expect(store.assertInfrastructure).not.toHaveBeenCalled();
  });

  it('fails explicitly when the selected credential is empty', async () => {
    const { credentialService, helper, store } = createHelper();
    credentialService.findOneValue.mockResolvedValue('');

    await expect(helper.retrieve('query')).rejects.toThrow(
      'credential is missing or empty',
    );
    expect(credentialService.findOneValue).toHaveBeenCalledWith(
      'credential-id',
    );
    expect(store.assertInfrastructure).not.toHaveBeenCalled();
  });

  it('accepts an embedding whose size differs from the requested dimension', async () => {
    const { helper, store, logger } = createHelper();
    // "embedding_dimensions" is 2 but the model returns a 3-dim vector: this is
    // a request the provider did not honor, not an error.
    (embed as jest.Mock).mockResolvedValueOnce({ embedding: [1, 2, 3] });

    await expect(helper.retrieve('query')).resolves.toEqual([]);
    expect(store.search).toHaveBeenCalledWith(
      [1, 2, 3],
      expect.any(String),
      expect.objectContaining({ status: true }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Embedding dimensions'),
    );
  });

  it('rejects empty and zero vectors', async () => {
    const { helper } = createHelper();
    (embed as jest.Mock).mockResolvedValueOnce({ embedding: [] });
    await expect(helper.retrieve('query')).rejects.toThrow(
      /invalid, empty, or zero vector/,
    );

    (embed as jest.Mock).mockResolvedValueOnce({ embedding: [0, 0] });
    await expect(helper.retrieve('query')).rejects.toThrow('zero vector');
  });

  it('enqueues corpus work for profile changes and only wakes retries for key changes', async () => {
    const { helper, store } = createHelper();

    await helper.handleSettingsChanged({ label: 'embedding_model' } as never);
    expect(store.enqueueAll).toHaveBeenCalledTimes(1);
    expect(store.wakePendingRetries).not.toHaveBeenCalled();

    await helper.handleSettingsChanged({
      label: 'embedding_provider',
    } as never);
    expect(store.enqueueAll).toHaveBeenCalledTimes(2);

    await helper.handleSettingsChanged({ label: 'embedding_api_key' } as never);
    expect(store.wakePendingRetries).toHaveBeenCalledTimes(1);
    expect(store.enqueueAll).toHaveBeenCalledTimes(2);
  });

  it('implements non-destructive reindexing by enqueuing the corpus', async () => {
    const { helper, store } = createHelper();

    await helper.reindex();

    expect(store.enqueueAll).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates the corpus when index_only_active_content is toggled', async () => {
    const { helper, store } = createHelper();

    await helper.handleSettingsChanged({
      label: 'index_only_active_content',
    } as never);

    expect(store.enqueueAll).toHaveBeenCalledTimes(1);
  });

  it('discards inactive content instead of transmitting it to the provider', async () => {
    const { helper, store } = createHelper();
    const job = { contentId: 'c1', revision: 1, attempts: 0 };
    store.claimJobs.mockResolvedValue([job]);
    store.loadContent.mockResolvedValue({
      id: 'c1',
      searchText: 'draft body',
      status: false,
    });
    jest
      .spyOn(
        helper as unknown as { isSelected: () => Promise<boolean> },
        'isSelected',
      )
      .mockResolvedValue(true);

    await (
      helper as unknown as { processJobs: () => Promise<void> }
    ).processJobs();

    expect(store.enqueueMissing).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      true,
    );
    expect(store.discardInactive).toHaveBeenCalledWith(job, expect.any(String));
    expect(store.save).not.toHaveBeenCalled();
    expect(embedMany).not.toHaveBeenCalled();
  });

  it('embeds inactive content when index_only_active_content is disabled', async () => {
    const { helper, store } = createHelper();
    (
      helper as unknown as {
        settingService: { getSettings: jest.Mock };
      }
    ).settingService.getSettings.mockResolvedValue({
      ...validSettings,
      pgvector: {
        ...validSettings.pgvector,
        index_only_active_content: false,
      },
    });
    (embedMany as jest.Mock).mockResolvedValue({ embeddings: [[1, 0]] });
    const job = { contentId: 'c1', revision: 1, attempts: 0 };
    store.claimJobs.mockResolvedValue([job]);
    store.loadContent.mockResolvedValue({
      id: 'c1',
      searchText: 'draft body',
      status: false,
    });
    jest
      .spyOn(
        helper as unknown as { isSelected: () => Promise<boolean> },
        'isSelected',
      )
      .mockResolvedValue(true);

    await (
      helper as unknown as { processJobs: () => Promise<void> }
    ).processJobs();

    expect(store.enqueueMissing).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      false,
    );
    expect(store.discardInactive).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalled();
  });
});

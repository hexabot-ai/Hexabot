/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource } from 'typeorm';

import FullTextSearchRagHelper, {
  FULLTEXT_SEARCH_RAG_HELPER_NAME,
} from './index.helper';

describe('FullTextSearchRagHelper', () => {
  let helper: FullTextSearchRagHelper;
  let store: {
    search: jest.Mock;
    reindex: jest.Mock;
  };

  beforeEach(() => {
    store = {
      search: jest.fn().mockResolvedValue([]),
      reindex: jest.fn().mockResolvedValue(undefined),
    };
    helper = new FullTextSearchRagHelper({} as DataSource);
    (helper as unknown as { store: unknown }).store = store;
    (helper as unknown as { settingService: unknown }).settingService = {
      getSettings: jest.fn().mockResolvedValue({ rag_settings: { top_k: 3 } }),
    };
  });

  it('exposes the expected helper name', () => {
    expect(helper.getName()).toBe(FULLTEXT_SEARCH_RAG_HELPER_NAME);
  });

  it('retrieves active content with the default top_k and stamps the source', async () => {
    store.search.mockResolvedValue([
      { contentId: 'c1', title: 'T', text: 'body', score: 0.5 },
    ]);

    const hits = await helper.retrieve('needle');

    expect(store.search).toHaveBeenCalledWith('needle', {
      status: true,
      contentTypeId: undefined,
      limit: 3,
    });
    expect(hits).toEqual([
      {
        contentId: 'c1',
        title: 'T',
        text: 'body',
        score: 0.5,
        source: FULLTEXT_SEARCH_RAG_HELPER_NAME,
      },
    ]);
  });

  it('honors includeInactive, explicit limit and content type filter', async () => {
    await helper.retrieve('needle', {
      includeInactive: true,
      limit: 10,
      contentTypeId: 'ct-1',
    });

    expect(store.search).toHaveBeenCalledWith('needle', {
      status: undefined,
      contentTypeId: 'ct-1',
      limit: 10,
    });
  });

  it('short-circuits empty queries', async () => {
    const hits = await helper.retrieve('   ');
    expect(hits).toEqual([]);
    expect(store.search).not.toHaveBeenCalled();
  });

  it('propagates retrieval infrastructure failures', async () => {
    store.search.mockRejectedValue(new Error('boom'));
    await expect(helper.retrieve('needle')).rejects.toThrow('boom');
  });

  it('rebuilds the index on reindex', async () => {
    await helper.reindex();
    expect(store.reindex).toHaveBeenCalledTimes(1);
  });
});

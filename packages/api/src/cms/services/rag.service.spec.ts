/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import path from 'path';

import { config } from '@/config';
import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';

import { RagEmbeddingNotConfiguredError } from '../errors/rag.errors';

import { ContentService } from './content.service';
import { RagBackendService } from './rag-backend.service';
import { RagIndexerService } from './rag-indexer.service';
import { RagRetrieverService } from './rag-retriever.service';
import { RagService } from './rag.service';

jest.mock('llamaindex', () => {
  const retrieve = jest.fn();
  const asRetriever = jest.fn(() => ({
    retrieve,
  }));
  const insertNodes = jest.fn();
  const deleteRefDoc = jest.fn();
  const getDocumentHash = jest.fn();
  const setDocumentHash = jest.fn();
  const keywordSimpleRetrieve = jest.fn();
  const keywordRakeRetrieve = jest.fn();
  const simpleKeywordHashes = new Map<string, string>();
  const rakeKeywordHashes = new Map<string, string>();
  const simpleKeywordIndexStruct = {
    table: new Map<string, Set<string>>(),
    addNode: jest.fn(),
  };
  const rakeKeywordIndexStruct = {
    table: new Map<string, Set<string>>(),
    addNode: jest.fn(),
  };
  const simpleKeywordDocStore = {
    getDocumentHash: jest.fn(async (docId: string) =>
      simpleKeywordHashes.get(docId),
    ),
    deleteDocument: jest.fn(async (docId: string) => {
      simpleKeywordHashes.delete(docId);
    }),
    addDocuments: jest.fn(
      async (documents: Array<{ id_: string; hash: string }>) => {
        for (const document of documents) {
          simpleKeywordHashes.set(document.id_, document.hash);
        }
      },
    ),
    getAllRefDocInfo: jest.fn(async () => {
      if (simpleKeywordHashes.size === 0) {
        return undefined;
      }

      return Object.fromEntries(
        Array.from(simpleKeywordHashes.keys()).map((contentId) => [
          contentId,
          { nodeIds: [contentId], extraInfo: {} },
        ]),
      );
    }),
  };
  const rakeKeywordDocStore = {
    getDocumentHash: jest.fn(async (docId: string) =>
      rakeKeywordHashes.get(docId),
    ),
    deleteDocument: jest.fn(async (docId: string) => {
      rakeKeywordHashes.delete(docId);
    }),
    addDocuments: jest.fn(
      async (documents: Array<{ id_: string; hash: string }>) => {
        for (const document of documents) {
          rakeKeywordHashes.set(document.id_, document.hash);
        }
      },
    ),
    getAllRefDocInfo: jest.fn(async () => {
      if (rakeKeywordHashes.size === 0) {
        return undefined;
      }

      return Object.fromEntries(
        Array.from(rakeKeywordHashes.keys()).map((contentId) => [
          contentId,
          { nodeIds: [contentId], extraInfo: {} },
        ]),
      );
    }),
  };
  const simpleKeywordIndexStore = {
    __retriever: 'simple',
    getIndexStructs: jest.fn(async () => []),
    addIndexStruct: jest.fn(async () => undefined),
  };
  const rakeKeywordIndexStore = {
    __retriever: 'rake',
    getIndexStructs: jest.fn(async () => []),
    addIndexStruct: jest.fn(async () => undefined),
  };
  const simpleKeywordDeleteRefDoc = jest.fn(async (contentId: string) => {
    simpleKeywordHashes.delete(contentId);
  });
  const rakeKeywordDeleteRefDoc = jest.fn(async (contentId: string) => {
    rakeKeywordHashes.delete(contentId);
  });
  const simpleKeywordAsRetriever = jest.fn(() => ({
    retrieve: keywordSimpleRetrieve,
  }));
  const rakeKeywordAsRetriever = jest.fn(() => ({
    retrieve: keywordRakeRetrieve,
  }));
  const simpleKeywordIndex = {
    asRetriever: simpleKeywordAsRetriever,
    deleteRefDoc: simpleKeywordDeleteRefDoc,
    docStore: simpleKeywordDocStore,
    indexStore: simpleKeywordIndexStore,
    indexStruct: simpleKeywordIndexStruct,
  };
  const rakeKeywordIndex = {
    asRetriever: rakeKeywordAsRetriever,
    deleteRefDoc: rakeKeywordDeleteRefDoc,
    docStore: rakeKeywordDocStore,
    indexStore: rakeKeywordIndexStore,
    indexStruct: rakeKeywordIndexStruct,
  };
  const keywordTableIndexInit = jest.fn(async ({ storageContext }: any) => {
    if (storageContext?.indexStore?.__retriever === 'rake') {
      return rakeKeywordIndex;
    }

    return simpleKeywordIndex;
  });
  const keywordTableIndexConstructor = jest.fn(function ({
    indexStore,
    indexStruct,
  }: {
    indexStore?: { __retriever?: string };
    indexStruct: {
      table: Map<string, Set<string>>;
      addNode: jest.Mock;
    };
  }) {
    if (indexStore?.__retriever === 'rake') {
      return {
        ...rakeKeywordIndex,
        indexStruct,
      };
    }

    return {
      ...simpleKeywordIndex,
      indexStruct,
    };
  }) as jest.Mock & { init?: jest.Mock };
  keywordTableIndexConstructor.init = keywordTableIndexInit;
  const simpleDocumentStoreFromPersistDir = jest.fn(
    async (persistDir: string) => {
      if (persistDir.includes('rake')) {
        return rakeKeywordDocStore;
      }

      return simpleKeywordDocStore;
    },
  );
  const simpleIndexStoreFromPersistDir = jest.fn(async (persistDir: string) => {
    if (persistDir.includes('rake')) {
      return rakeKeywordIndexStore;
    }

    return simpleKeywordIndexStore;
  });
  const storageContextFromDefaults = jest.fn(async (params: any = {}) => {
    if (params.vectorStore) {
      return {};
    }

    if (params.docStore || params.indexStore) {
      return {
        docStore: params.docStore,
        indexStore: params.indexStore,
        vectorStores: {},
      };
    }

    return {};
  });
  const simpleExtractKeywords = jest.fn((text: string) => {
    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 0);

    return new Set(words);
  });
  const rakeExtractKeywords = jest.fn((text: string) => {
    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 2);

    return new Set(words.slice(0, 10));
  });

  return {
    SimpleVectorStore: {
      fromPersistDir: jest.fn(async () => ({})),
    },
    SimpleDocumentStore: {
      fromPersistDir: simpleDocumentStoreFromPersistDir,
    },
    SimpleIndexStore: {
      fromPersistDir: simpleIndexStoreFromPersistDir,
    },
    KeywordTableRetrieverMode: {
      DEFAULT: 'DEFAULT',
      SIMPLE: 'SIMPLE',
      RAKE: 'RAKE',
    },
    KeywordTableIndex: keywordTableIndexConstructor,
    VectorStoreIndex: {
      init: jest.fn(async () => ({
        asRetriever,
        insertNodes,
        deleteRefDoc,
        docStore: {
          getDocumentHash,
          setDocumentHash,
        },
      })),
    },
    storageContextFromDefaults,
    simpleExtractKeywords,
    rakeExtractKeywords,
    __mocks: {
      retrieve,
      asRetriever,
      insertNodes,
      deleteRefDoc,
      getDocumentHash,
      setDocumentHash,
      keywordSimpleRetrieve,
      keywordRakeRetrieve,
      simpleKeywordAsRetriever,
      rakeKeywordAsRetriever,
      simpleKeywordDeleteRefDoc,
      rakeKeywordDeleteRefDoc,
      simpleKeywordDocStore,
      rakeKeywordDocStore,
      simpleKeywordIndexStore,
      rakeKeywordIndexStore,
      simpleKeywordHashes,
      rakeKeywordHashes,
      keywordTableIndexInit,
      simpleDocumentStoreFromPersistDir,
      simpleIndexStoreFromPersistDir,
      simpleExtractKeywords,
      rakeExtractKeywords,
    },
  };
});

jest.mock('@llamaindex/postgres', () => {
  const setCollection = jest.fn();
  const simpleHashes = new Map<string, string>();
  const rakeHashes = new Map<string, string>();
  const PostgresDocumentStore = jest.fn(
    ({ namespace }: { namespace: string }) => {
      const hashes = namespace.includes('rake') ? rakeHashes : simpleHashes;

      return {
        getDocumentHash: jest.fn(async (docId: string) => hashes.get(docId)),
        addDocuments: jest.fn(
          async (documents: Array<{ id_: string; hash: string }>) => {
            for (const document of documents) {
              hashes.set(document.id_, document.hash);
            }
          },
        ),
        getAllRefDocInfo: jest.fn(async () => {
          if (hashes.size === 0) {
            return undefined;
          }

          return Object.fromEntries(
            Array.from(hashes.keys()).map((contentId) => [
              contentId,
              { nodeIds: [contentId], extraInfo: {} },
            ]),
          );
        }),
      };
    },
  );
  const PostgresIndexStore = jest.fn(
    ({ namespace }: { namespace: string }) => ({
      __retriever: namespace.includes('rake') ? 'rake' : 'simple',
      getIndexStructs: jest.fn(async () => []),
      addIndexStruct: jest.fn(async () => undefined),
    }),
  );

  return {
    PGVectorStore: jest.fn(() => ({
      setCollection,
    })),
    PostgresDocumentStore,
    PostgresIndexStore,
    __mocks: {
      setCollection,
      PostgresDocumentStore,
      PostgresIndexStore,
    },
  };
});

jest.mock('@llamaindex/openai', () => ({
  OpenAIEmbedding: jest.fn(() => ({})),
}));

jest.mock('@llamaindex/core/global', () => {
  const withEmbedModel = jest.fn((_embedModel, fn) => fn());
  const withLLM = jest.fn((_llm, fn) => fn());

  return {
    Settings: {
      withEmbedModel,
      withLLM,
    },
    __mocks: {
      withEmbedModel,
      withLLM,
    },
  };
});

const llamaindexMock = jest.requireMock('llamaindex') as {
  SimpleVectorStore: { fromPersistDir: jest.Mock };
  SimpleDocumentStore: { fromPersistDir: jest.Mock };
  SimpleIndexStore: { fromPersistDir: jest.Mock };
  VectorStoreIndex: { init: jest.Mock };
  KeywordTableIndex: jest.Mock & { init: jest.Mock };
  storageContextFromDefaults: jest.Mock;
  simpleExtractKeywords: jest.Mock;
  rakeExtractKeywords: jest.Mock;
  __mocks: {
    retrieve: jest.Mock;
    asRetriever: jest.Mock;
    insertNodes: jest.Mock;
    deleteRefDoc: jest.Mock;
    getDocumentHash: jest.Mock;
    setDocumentHash: jest.Mock;
    keywordSimpleRetrieve: jest.Mock;
    keywordRakeRetrieve: jest.Mock;
    simpleKeywordAsRetriever: jest.Mock;
    rakeKeywordAsRetriever: jest.Mock;
    simpleKeywordDeleteRefDoc: jest.Mock;
    rakeKeywordDeleteRefDoc: jest.Mock;
    simpleKeywordDocStore: {
      getDocumentHash: jest.Mock;
      deleteDocument: jest.Mock;
      addDocuments: jest.Mock;
      getAllRefDocInfo: jest.Mock;
    };
    rakeKeywordDocStore: {
      getDocumentHash: jest.Mock;
      deleteDocument: jest.Mock;
      addDocuments: jest.Mock;
      getAllRefDocInfo: jest.Mock;
    };
    simpleKeywordIndexStore: {
      getIndexStructs: jest.Mock;
      addIndexStruct: jest.Mock;
      _kvStore?: {
        getAll: jest.Mock;
      };
      _collection?: string;
    };
    rakeKeywordIndexStore: {
      getIndexStructs: jest.Mock;
      addIndexStruct: jest.Mock;
    };
    simpleKeywordHashes: Map<string, string>;
    rakeKeywordHashes: Map<string, string>;
    keywordTableIndexInit: jest.Mock;
    simpleDocumentStoreFromPersistDir: jest.Mock;
    simpleIndexStoreFromPersistDir: jest.Mock;
    simpleExtractKeywords: jest.Mock;
    rakeExtractKeywords: jest.Mock;
  };
};
const postgresMock = jest.requireMock('@llamaindex/postgres') as {
  PGVectorStore: jest.Mock;
  PostgresDocumentStore: jest.Mock;
  PostgresIndexStore: jest.Mock;
  __mocks: {
    setCollection: jest.Mock;
    PostgresDocumentStore: jest.Mock;
    PostgresIndexStore: jest.Mock;
  };
};
const coreGlobalMock = jest.requireMock('@llamaindex/core/global') as {
  __mocks: {
    withEmbedModel: jest.Mock;
  };
};
const retrieveMock = llamaindexMock.__mocks.retrieve;
const asRetrieverMock = llamaindexMock.__mocks.asRetriever;
const insertNodesMock = llamaindexMock.__mocks.insertNodes;
const deleteRefDocMock = llamaindexMock.__mocks.deleteRefDoc;
const getDocumentHashMock = llamaindexMock.__mocks.getDocumentHash;
const setDocumentHashMock = llamaindexMock.__mocks.setDocumentHash;
const keywordSimpleRetrieveMock = llamaindexMock.__mocks.keywordSimpleRetrieve;
const keywordRakeRetrieveMock = llamaindexMock.__mocks.keywordRakeRetrieve;
const simpleKeywordAsRetrieverMock =
  llamaindexMock.__mocks.simpleKeywordAsRetriever;
const simpleKeywordDocStoreMock = llamaindexMock.__mocks.simpleKeywordDocStore;
const simpleKeywordHashes = llamaindexMock.__mocks.simpleKeywordHashes;
const rakeKeywordHashes = llamaindexMock.__mocks.rakeKeywordHashes;
const vectorStoreIndexInitMock = llamaindexMock.VectorStoreIndex.init;
const keywordTableIndexInitMock = llamaindexMock.KeywordTableIndex.init;
const simpleVectorStoreFromPersistDirMock =
  llamaindexMock.SimpleVectorStore.fromPersistDir;
const simpleDocumentStoreFromPersistDirMock =
  llamaindexMock.SimpleDocumentStore.fromPersistDir;
const simpleIndexStoreFromPersistDirMock =
  llamaindexMock.SimpleIndexStore.fromPersistDir;
const storageContextFromDefaultsMock =
  llamaindexMock.storageContextFromDefaults;
const pgVectorStoreConstructorMock = postgresMock.PGVectorStore;
const setCollectionMock = postgresMock.__mocks.setCollection;
const postgresDocumentStoreConstructorMock =
  postgresMock.__mocks.PostgresDocumentStore;
const postgresIndexStoreConstructorMock =
  postgresMock.__mocks.PostgresIndexStore;
const withEmbedModelMock = coreGlobalMock.__mocks.withEmbedModel;

type ContentServiceMock = jest.Mocked<
  Pick<ContentService, 'findOneAndPopulate' | 'findAndPopulate' | 'find'>
>;

type SettingServiceMock = jest.Mocked<Pick<SettingService, 'getSettings'>>;

type LoggerServiceMock = jest.Mocked<
  Pick<LoggerService, 'error' | 'warn' | 'log' | 'debug'>
>;

const makeSettings = (overrides?: Record<string, unknown>) =>
  ({
    rag_settings: {
      enabled: true,
      default_mode: 'lexical',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      embedding_api_key: 'test-key',
      embedding_base_url: '',
      embedding_dimensions: 1536,
      top_k: 5,
      index_only_active_content: true,
      ...(overrides ?? {}),
    },
  }) as unknown as Settings;

describe('RagService', () => {
  let service: RagService;
  let backendService: RagBackendService;
  let indexerService: RagIndexerService;
  let retrieverService: RagRetrieverService;
  let contentService: ContentServiceMock;
  let settingService: SettingServiceMock;
  let logger: LoggerServiceMock;
  let originalDbType: typeof config.database.type;
  let originalDbUrl: string | undefined;

  beforeEach(() => {
    contentService = {
      findOneAndPopulate: jest.fn(),
      findAndPopulate: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockResolvedValue([]),
    };
    settingService = {
      getSettings: jest.fn().mockResolvedValue(makeSettings()),
    };
    logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    };
    backendService = new RagBackendService(
      settingService as unknown as SettingService,
      logger as unknown as LoggerService,
    );
    indexerService = new RagIndexerService(
      contentService as unknown as ContentService,
      settingService as unknown as SettingService,
      backendService,
      logger as unknown as LoggerService,
    );
    retrieverService = new RagRetrieverService(
      settingService as unknown as SettingService,
      backendService,
    );
    service = new RagService(
      retrieverService,
      indexerService,
      backendService,
      contentService as unknown as ContentService,
      settingService as unknown as SettingService,
      logger as unknown as LoggerService,
    );
    originalDbType = config.database.type;
    originalDbUrl = config.database.url;
    config.database.type = 'sqlite';
    config.database.url = undefined;
    retrieveMock.mockResolvedValue([]);
    keywordSimpleRetrieveMock.mockResolvedValue([]);
    keywordRakeRetrieveMock.mockResolvedValue([]);
    getDocumentHashMock.mockResolvedValue(undefined);
    simpleKeywordHashes.clear();
    rakeKeywordHashes.clear();
    delete llamaindexMock.__mocks.simpleKeywordIndexStore._kvStore;
    delete llamaindexMock.__mocks.simpleKeywordIndexStore._collection;
  });

  afterEach(() => {
    config.database.type = originalDbType;
    config.database.url = originalDbUrl;
    jest.clearAllMocks();
  });

  it('uses lexical retrieval when mode is lexical', async () => {
    keywordSimpleRetrieveMock.mockResolvedValue([
      {
        node: {
          id_: 'content-1',
          metadata: {
            contentId: 'content-1',
            title: 'Product A',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'title: Product A\nsummary: Great product',
        },
      },
    ]);

    const hits = await service.retrieve('product', { mode: 'lexical' });

    expect(simpleKeywordAsRetrieverMock).toHaveBeenCalledWith({
      mode: 'SIMPLE',
      numChunksPerQuery: 5,
    });
    expect(hits).toEqual([
      {
        contentId: 'content-1',
        title: 'Product A',
        text: 'title: Product A\nsummary: Great product',
        contentTypeId: 'ct-1',
        source: 'lexical',
      },
    ]);
  });

  it('applies lexical filters in simple mode', async () => {
    keywordSimpleRetrieveMock.mockResolvedValue([
      {
        node: {
          id_: 'content-1',
          metadata: {
            contentId: 'content-1',
            title: 'Inactive Product',
            status: 0,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'inactive text',
        },
      },
      {
        node: {
          id_: 'content-2',
          metadata: {
            contentId: 'content-2',
            title: 'Product B',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'product b text',
        },
      },
      {
        node: {
          id_: 'content-3',
          metadata: {
            contentId: 'content-3',
            title: 'Product C',
            status: 1,
            contentTypeId: 'ct-2',
          },
          getContent: () => 'product c text',
        },
      },
    ]);

    const hits = await service.retrieve('product', {
      mode: 'lexical',
      contentTypeId: 'ct-1',
      limit: 2,
    });

    expect(simpleKeywordAsRetrieverMock).toHaveBeenCalledWith({
      mode: 'SIMPLE',
      numChunksPerQuery: 2,
    });
    expect(hits).toEqual([
      {
        contentId: 'content-2',
        title: 'Product B',
        text: 'product b text',
        contentTypeId: 'ct-1',
        source: 'lexical',
      },
    ]);
  });

  it('initializes lexical indexes with dedicated sqlite persist dirs', async () => {
    await service.retrieve('product', { mode: 'lexical' });

    expect(simpleDocumentStoreFromPersistDirMock).toHaveBeenCalledWith(
      path.join(process.cwd(), 'storage/content-rag', 'lexical'),
    );
    expect(simpleIndexStoreFromPersistDirMock).toHaveBeenCalledWith(
      path.join(process.cwd(), 'storage/content-rag', 'lexical'),
    );
    expect(keywordTableIndexInitMock).toHaveBeenCalledTimes(1);
  });

  it('recovers persisted lexical keyword tables when llamaindex cannot deserialize keyword_table', async () => {
    const recoveredKvStore = {
      data: {
        'mock/keyword/data': {
          'keyword-index-1': {
            type: 'keyword_table',
            indexId: 'keyword-index-1',
            table: {
              product: ['content-1'],
              catalog: ['content-2', 'content-3'],
            },
          },
        },
      },
      getAll: jest.fn(function (
        this: { data: Record<string, Record<string, unknown>> },
        collection = 'mock/keyword/data',
      ) {
        return Promise.resolve(this.data[collection] ?? {});
      }),
    };
    llamaindexMock.__mocks.simpleKeywordIndexStore.getIndexStructs.mockRejectedValueOnce(
      new Error('Unknown index struct type: keyword_table'),
    );
    llamaindexMock.__mocks.simpleKeywordIndexStore._collection =
      'mock/keyword/data';
    llamaindexMock.__mocks.simpleKeywordIndexStore._kvStore = recoveredKvStore;

    const lexicalIndex = await backendService.getLexicalIndex();

    expect(recoveredKvStore.getAll).toHaveBeenCalledWith('mock/keyword/data');
    expect(keywordTableIndexInitMock).not.toHaveBeenCalled();
    expect(lexicalIndex.indexStruct.table.get('product')).toEqual(
      new Set(['content-1']),
    );
    expect(lexicalIndex.indexStruct.table.get('catalog')).toEqual(
      new Set(['content-2', 'content-3']),
    );
  });

  it('initializes lexical postgres backend with per-retriever namespaces', async () => {
    config.database.type = 'postgres';
    config.database.url = 'postgres://user:pass@localhost:5432/hexabot';

    await service.retrieve('query', { mode: 'lexical' });

    expect(postgresDocumentStoreConstructorMock).toHaveBeenCalledWith({
      clientConfig: {
        connectionString: 'postgres://user:pass@localhost:5432/hexabot',
      },
      schemaName: 'public',
      namespace: 'cms_content_lexical_simple',
    });
    expect(postgresIndexStoreConstructorMock).toHaveBeenCalledWith({
      clientConfig: {
        connectionString: 'postgres://user:pass@localhost:5432/hexabot',
      },
      schemaName: 'public',
      namespace: 'cms_content_lexical_simple',
    });
  });

  it('uses embedding retrieval when mode is embedding', async () => {
    retrieveMock.mockResolvedValue([
      {
        node: {
          id_: 'content-1',
          metadata: {
            contentId: 'content-1',
            title: 'Product A',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'indexed text',
        },
        score: 0.92,
      },
    ]);

    const hits = await service.retrieve('product', {
      mode: 'embedding',
      limit: 3,
      contentTypeId: 'ct-1',
    });

    expect(vectorStoreIndexInitMock).toHaveBeenCalledTimes(1);
    expect(asRetrieverMock).toHaveBeenCalledWith({
      similarityTopK: 3,
      filters: {
        condition: 'and',
        filters: [
          { key: 'status', operator: '==', value: 1 },
          { key: 'contentTypeId', operator: '==', value: 'ct-1' },
        ],
      },
    });
    expect(hits).toEqual([
      {
        contentId: 'content-1',
        title: 'Product A',
        text: 'indexed text',
        score: 0.92,
        contentTypeId: 'ct-1',
        source: 'embedding',
      },
    ]);
  });

  it('reports RAG enablement from settings', async () => {
    await expect(retrieverService.isEnabled()).resolves.toBe(true);

    settingService.getSettings.mockResolvedValue(
      makeSettings({ enabled: false }),
    );

    await expect(retrieverService.isEnabled()).resolves.toBe(false);
  });

  it('returns empty hits when RAG is disabled', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ enabled: false }),
    );

    await expect(service.retrieve('product')).resolves.toEqual([]);
    expect(simpleKeywordAsRetrieverMock).not.toHaveBeenCalled();
    expect(asRetrieverMock).not.toHaveBeenCalled();
  });

  it('rejects embedding retrieval with a typed error when the API key is missing', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ embedding_api_key: '' }),
    );

    await expect(
      service.retrieve('product', { mode: 'embedding' }),
    ).rejects.toBeInstanceOf(RagEmbeddingNotConfiguredError);
  });

  it('rejects embedding retrieval with a typed error when the provider is missing', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ embedding_provider: '' }),
    );

    await expect(
      service.retrieve('product', { mode: 'embedding' }),
    ).rejects.toBeInstanceOf(RagEmbeddingNotConfiguredError);
  });

  it('initializes sqlite backend with persisted local store', async () => {
    await service.retrieve('query', {
      mode: 'embedding',
    });

    expect(withEmbedModelMock).toHaveBeenCalledTimes(1);
    expect(withEmbedModelMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
    );
    expect(simpleVectorStoreFromPersistDirMock).toHaveBeenCalledWith(
      path.join(process.cwd(), 'storage/content-rag', 'embedding'),
      expect.anything(),
    );
    expect(storageContextFromDefaultsMock).toHaveBeenCalledWith({
      persistDir: path.join(process.cwd(), 'storage/content-rag', 'embedding'),
      vectorStore: {},
    });
    expect(vectorStoreIndexInitMock).toHaveBeenCalledWith({
      nodes: [],
      storageContext: {},
    });
    expect(pgVectorStoreConstructorMock).not.toHaveBeenCalled();
  });

  it('initializes postgres backend with PGVectorStore config', async () => {
    config.database.type = 'postgres';
    config.database.url = 'postgres://user:pass@localhost:5432/hexabot';

    await service.retrieve('query', {
      mode: 'embedding',
    });

    expect(pgVectorStoreConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientConfig: {
          connectionString: 'postgres://user:pass@localhost:5432/hexabot',
        },
        schemaName: 'public',
        tableName: 'llamaindex_embedding',
        dimensions: 1536,
        performSetup: true,
      }),
    );
    expect(setCollectionMock).toHaveBeenCalledWith('cms_content');
    expect(postgresDocumentStoreConstructorMock).toHaveBeenCalledWith({
      clientConfig: {
        connectionString: 'postgres://user:pass@localhost:5432/hexabot',
      },
      schemaName: 'public',
      namespace: 'cms_content',
    });
    expect(postgresIndexStoreConstructorMock).toHaveBeenCalledWith({
      clientConfig: {
        connectionString: 'postgres://user:pass@localhost:5432/hexabot',
      },
      schemaName: 'public',
      namespace: 'cms_content',
    });
    expect(storageContextFromDefaultsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vectorStore: { setCollection: expect.any(Function) },
        docStore: expect.any(Object),
        indexStore: expect.any(Object),
      }),
    );
    expect(vectorStoreIndexInitMock).toHaveBeenCalledWith({
      nodes: [],
      storageContext: {},
    });
  });

  it('warms up embedding backend in onModuleInit', async () => {
    await backendService.onModuleInit();

    expect(vectorStoreIndexInitMock).toHaveBeenCalledTimes(1);
  });

  it('does not crash module init when startup warm-up fails', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ embedding_api_key: '' }),
    );

    await expect(backendService.onModuleInit()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to initialize RAG embedding backend during module startup. It will retry on demand.',
      expect.any(Error),
    );
  });

  it('retries embedding backend init on demand after startup warm-up failure', async () => {
    settingService.getSettings
      .mockResolvedValueOnce(makeSettings({ embedding_api_key: '' }))
      .mockResolvedValue(makeSettings({ default_mode: 'embedding' }));
    retrieveMock.mockResolvedValue([]);

    await backendService.onModuleInit();
    await service.retrieve('query', { mode: 'embedding' });

    expect(vectorStoreIndexInitMock).toHaveBeenCalledTimes(1);
  });

  it('upserts and removes content in embedding index lifecycle', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ default_mode: 'embedding' }),
    );
    contentService.findOneAndPopulate.mockResolvedValue({
      id: 'content-1',
      title: 'Product A',
      status: true,
      properties: { summary: 'Great product' },
      contentType: {
        id: 'ct-1',
        schema: {
          properties: {
            summary: { title: 'Summary' },
          },
        },
      },
    } as any);

    await service.upsertContentIndex('content-1');
    await service.removeContentIndex('content-1');

    expect(deleteRefDocMock).toHaveBeenCalledWith('content-1');
    expect(simpleKeywordDocStoreMock.deleteDocument).toHaveBeenCalledWith(
      'content-1',
      false,
    );
    expect(insertNodesMock).toHaveBeenCalledTimes(1);
    expect(setDocumentHashMock).toHaveBeenCalledTimes(1);
    expect(setDocumentHashMock).toHaveBeenCalledWith(
      'content-1',
      expect.any(String),
    );
    const insertedDocs = insertNodesMock.mock.calls[0][0];
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0].id_).toBe('content-1');
  });

  it('does not delete ref doc before first insert when no stored hash exists', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ default_mode: 'embedding' }),
    );
    contentService.findOneAndPopulate.mockResolvedValue({
      id: 'content-1',
      title: 'Product A',
      status: true,
      searchText: 'title: Product A',
      contentType: {
        id: 'ct-1',
        schema: {
          properties: {},
        },
      },
    } as any);
    getDocumentHashMock.mockResolvedValue(undefined);

    await service.upsertContentIndex('content-1');

    expect(deleteRefDocMock).not.toHaveBeenCalled();
    expect(insertNodesMock).toHaveBeenCalledTimes(1);
    expect(setDocumentHashMock).toHaveBeenCalledTimes(1);
  });

  it('skips reindexing when stored hash matches current content hash', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ default_mode: 'embedding' }),
    );
    contentService.findOneAndPopulate.mockResolvedValue({
      id: 'content-1',
      title: 'Product A',
      status: true,
      searchText: 'title: Product A',
      contentType: {
        id: 'ct-1',
        schema: {
          properties: {},
        },
      },
    } as any);

    await service.upsertContentIndex('content-1');

    const insertedDocs = insertNodesMock.mock.calls[0][0];
    const generatedHash = insertedDocs[0].hash;
    jest.clearAllMocks();
    getDocumentHashMock.mockResolvedValue(generatedHash);
    contentService.findOneAndPopulate.mockResolvedValue({
      id: 'content-1',
      title: 'Product A',
      status: true,
      searchText: 'title: Product A',
      contentType: {
        id: 'ct-1',
        schema: {
          properties: {},
        },
      },
    } as any);

    await service.upsertContentIndex('content-1');

    expect(getDocumentHashMock).toHaveBeenCalledWith('content-1');
    expect(deleteRefDocMock).not.toHaveBeenCalled();
    expect(insertNodesMock).not.toHaveBeenCalled();
    expect(setDocumentHashMock).not.toHaveBeenCalled();
  });

  it('removes content from embedding index when content is inactive', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({
        default_mode: 'embedding',
        index_only_active_content: true,
      }),
    );
    contentService.findOneAndPopulate.mockResolvedValue({
      id: 'content-1',
      title: 'Product A',
      status: false,
      properties: { summary: 'Great product' },
      contentType: {
        id: 'ct-1',
        schema: {
          properties: {
            summary: { title: 'Summary' },
          },
        },
      },
    } as any);

    await service.upsertContentIndex('content-1');

    expect(deleteRefDocMock).toHaveBeenCalledWith('content-1');
    expect(simpleKeywordDocStoreMock.deleteDocument).toHaveBeenCalledWith(
      'content-1',
      false,
    );
    expect(insertNodesMock).not.toHaveBeenCalled();
  });
  it('reindexes content on update even when it was deactivated', async () => {
    const upsertSpy = jest
      .spyOn(indexerService, 'upsertContentIndex')
      .mockResolvedValue(undefined);

    await service.handleContentUpdated({
      entity: { id: 'content-1', status: false },
    } as any);

    expect(upsertSpy).toHaveBeenCalledWith('content-1');
  });

  it('removes contents of a deleted content type from indexes', async () => {
    contentService.find.mockResolvedValue([
      { id: 'content-1' },
      { id: 'content-2' },
    ] as any);
    const removeSpy = jest
      .spyOn(indexerService, 'removeContentIndex')
      .mockResolvedValue(undefined);

    await service.handleContentTypeDeleting({
      databaseEntity: { id: 'ct-1' },
    } as any);
    await service.handleContentTypeDeleted({ entity: { id: 'ct-1' } } as any);

    expect(contentService.find).toHaveBeenCalledWith({
      where: { contentType: { id: 'ct-1' } },
    });
    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledWith('content-1');
    expect(removeSpy).toHaveBeenCalledWith('content-2');
  });

  it('skips content type deletion capture when RAG is disabled', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ enabled: false }),
    );
    const removeSpy = jest
      .spyOn(indexerService, 'removeContentIndex')
      .mockResolvedValue(undefined);

    await service.handleContentTypeDeleting({
      databaseEntity: { id: 'ct-1' },
    } as any);
    await service.handleContentTypeDeleted({ entity: { id: 'ct-1' } } as any);

    expect(contentService.find).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('prunes lexical keyword table entries when content is removed', async () => {
    const lexicalIndex = await backendService.getLexicalIndex();
    lexicalIndex.indexStruct.table.clear();
    lexicalIndex.indexStruct.table.set('quixotic', new Set(['content-1']));
    lexicalIndex.indexStruct.table.set(
      'gadget',
      new Set(['content-1', 'content-2']),
    );

    await service.removeContentIndex('content-1');

    expect(lexicalIndex.indexStruct.table.has('quixotic')).toBe(false);
    expect([...(lexicalIndex.indexStruct.table.get('gadget') ?? [])]).toEqual([
      'content-2',
    ]);
    expect(simpleKeywordDocStoreMock.deleteDocument).toHaveBeenCalledWith(
      'content-1',
      false,
    );
  });

  it('processes reindex with concurrency limit and reports failed items', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ default_mode: 'embedding' }),
    );
    getDocumentHashMock.mockResolvedValue('existing-hash');
    contentService.findAndPopulate.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => ({
        id: `content-${index + 1}`,
        title: `Product ${index + 1}`,
        status: true,
        searchText: `title: Product ${index + 1}`,
        contentType: {
          id: 'ct-1',
          schema: {
            properties: {},
          },
        },
      })) as any,
    );
    deleteRefDocMock.mockImplementation(async (contentId: string) => {
      if (contentId === 'content-3') {
        throw new Error('delete failure');
      }
    });

    await expect(service.reindexAll()).rejects.toThrow(
      'RAG reindex completed with 1 failed content item(s).',
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Unable to reindex content in RAG batch',
      expect.any(Error),
      { contentId: 'content-3' },
    );
    expect(deleteRefDocMock).toHaveBeenCalledTimes(9);
  });

  it('continues lexical-only reindex when embedding is not configured', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ embedding_api_key: '' }),
    );
    contentService.findAndPopulate.mockResolvedValue([
      {
        id: 'content-1',
        title: 'Product A',
        status: true,
        properties: { summary: 'Great product' },
        contentType: {
          id: 'ct-1',
          schema: {
            properties: {
              summary: { title: 'Summary' },
            },
          },
        },
      },
    ] as any);

    await expect(service.reindexAll()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to initialize embedding index. Continuing lexical indexing only.',
      expect.any(Error),
    );
    expect(insertNodesMock).not.toHaveBeenCalled();
    expect(simpleKeywordHashes.size).toBeGreaterThan(0);
  });

  it('does not trigger full reindex during embedding retrieval', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ default_mode: 'embedding' }),
    );

    await service.retrieve('first', { mode: 'embedding' });
    await service.retrieve('second', { mode: 'embedding' });

    expect(contentService.findAndPopulate).not.toHaveBeenCalled();
  });

  it('reindexes after rag enabled setting change when rag is enabled', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ enabled: true }),
    );
    const resetSpy = jest.spyOn(backendService, 'reset');
    const reindexSpy = jest
      .spyOn(indexerService, 'reindexAll')
      .mockResolvedValue(undefined);

    await service.handleRagEnabledSettingChanged();

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(reindexSpy).toHaveBeenCalledTimes(1);
  });

  it('skips reindex after rag setting change when rag is disabled', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ enabled: false }),
    );
    const resetSpy = jest.spyOn(backendService, 'reset');
    const reindexSpy = jest
      .spyOn(indexerService, 'reindexAll')
      .mockResolvedValue(undefined);

    await service.handleRagBackendSettingChanged();

    expect(resetSpy).not.toHaveBeenCalled();
    expect(reindexSpy).not.toHaveBeenCalled();
  });

  it('queues manual reindex requests while one is already running', async () => {
    let resolveReindex: (() => void) | undefined;
    const inFlightReindex = new Promise<void>((resolve) => {
      resolveReindex = resolve;
    });
    const reindexSpy = jest
      .spyOn(indexerService, 'reindexAll')
      .mockImplementation(() => inFlightReindex);

    service.scheduleReindexAll();
    service.scheduleReindexAll();
    expect(reindexSpy).toHaveBeenCalledTimes(1);

    resolveReindex?.();
    await inFlightReindex;
    await new Promise<void>((resolve) => setImmediate(resolve));

    service.scheduleReindexAll();
    expect(reindexSpy).toHaveBeenCalledTimes(2);
  });

  it('filters embedding hits and keeps best score per content', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ default_mode: 'embedding' }),
    );
    retrieveMock.mockResolvedValue([
      {
        node: {
          id_: 'content-1',
          metadata: {
            contentId: 'content-1',
            title: 'Product A',
            status: 0,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'inactive text',
        },
        score: 0.9,
      },
      {
        node: {
          id_: 'content-2',
          metadata: {
            contentId: 'content-2',
            title: 'Product B',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'active text low',
        },
        score: 0.4,
      },
      {
        node: {
          id_: 'content-2',
          metadata: {
            contentId: 'content-2',
            title: 'Product B',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'active text high',
        },
        score: 0.8,
      },
    ]);

    const hits = await service.retrieve('query', { mode: 'embedding' });

    expect(hits).toEqual([
      {
        contentId: 'content-2',
        title: 'Product B',
        text: 'active text high',
        score: 0.8,
        contentTypeId: 'ct-1',
        source: 'embedding',
      },
    ]);
  });

  it('ranks deduped embedding hits by best score before applying limit', async () => {
    settingService.getSettings.mockResolvedValue(
      makeSettings({ default_mode: 'embedding' }),
    );
    retrieveMock.mockResolvedValue([
      {
        node: {
          id_: 'content-1',
          metadata: {
            contentId: 'content-1',
            title: 'Product A',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'product a high',
        },
        score: 0.9,
      },
      {
        node: {
          id_: 'content-2',
          metadata: {
            contentId: 'content-2',
            title: 'Product B',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'product b low',
        },
        score: 0.2,
      },
      {
        node: {
          id_: 'content-2',
          metadata: {
            contentId: 'content-2',
            title: 'Product B',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'product b high',
        },
        score: 0.6,
      },
      {
        node: {
          id_: 'content-3',
          metadata: {
            contentId: 'content-3',
            title: 'Product C',
            status: 1,
            contentTypeId: 'ct-1',
          },
          getContent: () => 'product c medium',
        },
        score: 0.7,
      },
    ]);

    const hits = await service.retrieve('query', {
      mode: 'embedding',
      limit: 2,
    });

    expect(hits).toEqual([
      {
        contentId: 'content-1',
        title: 'Product A',
        text: 'product a high',
        score: 0.9,
        contentTypeId: 'ct-1',
        source: 'embedding',
      },
      {
        contentId: 'content-3',
        title: 'Product C',
        text: 'product c medium',
        score: 0.7,
        contentTypeId: 'ct-1',
        source: 'embedding',
      },
    ]);
  });
});

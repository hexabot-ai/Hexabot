# RAG helpers

Hexabot ships with two database-owned RAG helpers:

- `fulltext-search` is the default. PostgreSQL uses a GIN expression index over
  the canonical `contents.searchText`; SQLite uses an FTS5 table maintained by
  database triggers.
- `pgvector` is PostgreSQL-only. It chunks `searchText`, calls an
  OpenAI-compatible embedding endpoint, and stores exact-search vectors in
  PostgreSQL. A trigger-backed, leased work queue makes indexing durable across
  API restarts and supports multiple API nodes.

The selected helper is controlled by
`global_settings.default_rag_helper`. RAG retrieval is always available through
that helper; there is no feature enable/disable switch.

## Custom helper consistency

A custom RAG helper must extend `BaseRagHelper` and implement `retrieve`.
`index`, `remove`, and `reindex` are optional.

The CMS lifecycle hooks forwarded to `index` and `remove` are best-effort
latency signals. They are not durable change capture: a process failure after
the CMS transaction commits, direct SQL, or another writer can cause an
external index to drift. A custom helper that needs correctness should use a
database outbox, database-native change capture, or an equivalent durable
queue. It should also implement a complete, idempotent `reindex()` so
administrators can reconcile it through `POST /content/rag/reindex`.

## v3.4.0 migration and rollback

The v3.4.0 migration preserves the old LlamaIndex settings and storage for
rollback. It copies embedding configuration into the `pgvector` helper, but
selects `pgvector` only when PostgreSQL, the vector extension, and an API key
are all available. Every other legacy installation moves safely to
`fulltext-search`.

After the new helper has been verified and the rollback window has closed,
operators may remove the dormant LlamaIndex PostgreSQL structures (including
`llamaindex_embedding` and its document/index-store tables) or the old
`storage/content-rag` SQLite files. Cleanup is intentionally not automated by
the migration.

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

## Indexing only active content

The `pgvector` helper exposes an `index_only_active_content` setting (default
`true`). When enabled, inactive (unpublished) content is never sent to the
embedding provider and is kept out of the vector index: the queue worker drops
any embeddings for a row it finds inactive, the content trigger fires on
`status` changes so publishing/unpublishing reconciles automatically, and
toggling the setting re-evaluates the whole corpus. The v3.4.0 migration carries
the legacy `rag_settings.index_only_active_content` value over to the helper.
When disabled, all content is embedded regardless of status (retrieval still
filters inactive rows out of results).

## Testing

Unit tests run against the default SQLite config:

```sh
pnpm --filter @hexabot-ai/api test
```

The `pgvector` helper also has an integration suite
(`pgvector.integration.spec.ts`) that exercises the real provisioning DDL,
status-aware trigger, leased work queue, and cosine search against PostgreSQL.
It is `describe.skip` unless `TEST_PGVECTOR_DATABASE_URL` is set, and it also
requires `DB_TYPE=postgres` — the entities' `DatetimeColumn` decorator picks its
SQL type from `DB_TYPE` at import time, so without it `createdAt` resolves to the
SQLite `datetime` type and `DataSource.initialize` fails on PostgreSQL. CI runs
it this way (see `.github/workflows/main-ci.yml`):

```sh
docker run -d --name pgv -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hexabot_test \
  -p 5432:5432 pgvector/pgvector:0.8.2-pg16

DB_TYPE=postgres \
TEST_PGVECTOR_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hexabot_test \
  pnpm --filter @hexabot-ai/api exec jest --runInBand \
  --runTestsByPath src/extensions/helpers/pgvector/pgvector.integration.spec.ts
```

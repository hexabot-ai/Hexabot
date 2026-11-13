# RAG helpers

Hexabot ships with one built-in, database-owned RAG helper:

- `fulltext-search` is the default. PostgreSQL uses a GIN expression index over
  the canonical `contents.searchText`; SQLite uses an FTS5 table maintained by
  database triggers.

Additional RAG helpers can be installed as `hexabot-helper-*` packages. They
are auto-discovered from `node_modules/hexabot-helper-*/**/*.helper.js` and own
their settings, storage, and database lifecycle.

The selected helper is controlled by
`global_settings.default_rag_helper`. RAG retrieval is always available through
that helper; there is no feature enable/disable switch.

## Custom helper consistency

A custom RAG helper must extend `BaseRagHelper` and implement `retrieve`.
`index`, `remove`, and `reindex` are optional.

A helper returns hits without `properties`. When a caller asks for content
properties (the `include_properties` setting of `retrieve_rag_content`, or
`properties` on the `hexabot_rag_content_search` MCP tool),
`ContentService.retrieve` reads them from the contents of the hits and attaches
them, so a helper never selects them. Its `text` may be one chunk of the
content, which does not hold every property line of `searchText`.

A helper that builds its index from an external embedding provider should
extend `BaseRagEmbeddingHelper` instead. It carries the chunking
(`chunkSearchText`), provider resolution, query/chunk embedding, vector
validation, and the profile hash that keys stored vectors to the configuration
that produced them. All of it is shared for one reason: two helpers that
disagreed on any of it would produce indexes that cannot be compared or
migrated between.

`embedChunks` sends at most 4 provider requests at once and retries a
rate-limited (429) or failed (5xx) request twice, with exponential backoff; each
request has its own 60 s timeout. Providers without batch embedding (e.g. Amazon
Bedrock Titan) send one request per chunk, so without the cap a document fans
out into as many parallel requests as it has chunks. A helper can expose the
optional `embedding_max_parallel_calls` and `embedding_max_retries` settings to
override these defaults. When retries are exhausted, `isRateLimitError` tells a
rate limit apart from other failures, so a durable queue can pause instead of
failing its next jobs too.

The CMS lifecycle hooks forwarded to `index` and `remove` are best-effort
latency signals. They are not durable change capture: a process failure after
the CMS transaction commits, direct SQL, or another writer can cause an
external index to drift. A custom helper that needs correctness should use a
database outbox, database-native change capture, or an equivalent durable
queue. It should also implement a complete, idempotent `reindex()` so
administrators can reconcile it through `POST /content/rag/reindex`.

## Excluded query terms

Words that every indexed page repeats, such as a brand name in each page
title, match every document. When an agent puts them in its query, generic
pages outrank the relevant ones, with both lexical and embedding helpers.
`retrieve_rag_content` removes the words listed in its `excluded_terms` setting
from the query before the helper receives it, so no helper has to handle them.
Matching ignores case and only matches whole words. Phrases listed in
`preserved_phrases` are kept, so excluding a brand does not break a product
name that contains it. When nothing would be left of the query, it is sent
unchanged. With excluded terms configured, the action also returns the query it
sent (`query_used`) and the terms it removed (`removed_terms`).
`removeQueryTerms` (exported from the CMS module) applies the same filtering
for other callers.

## v3.4.0 migration and rollback

The core v3.4.0 migration removes the legacy (LlamaIndex-era) RAG footprint and
provisions the built-in lexical `fulltext-search` helper. It defaults
`default_rag_helper` to `fulltext-search` when no selection exists yet.

On **SQLite**, the previous version stored its RAG data as tables and triggers
_inside the main database_ (`content_chunks`, `content_embeddings`, the
`content_chunks_fts` mirror, and AFTER triggers on `contents` that wrote into
them). The migration drops these automatically: left in place, the triggers
fire on every content write, and dropping the tables by hand while the triggers
remained made every content write fail with `no such table: content_chunks`.
No manual SQLite cleanup is required.

On **PostgreSQL**, any dormant LlamaIndex structures are preserved for rollback
and are _not_ automated away. After the new helper has been verified and the
rollback window has closed, operators may remove them manually.

## Testing

Unit tests run against the default SQLite config:

```sh
pnpm --filter @hexabot-ai/api test
```

The core migration has a PostgreSQL integration suite
(`src/migration/migrations/1784815200000-v-3-4-0.integration.spec.ts`) covering
the legacy `contents.searchText` btree-index removal and lexical provisioning.
It is `describe.skip` unless `TEST_POSTGRES_DATABASE_URL` is set, and it also
requires `DB_TYPE=postgres` — the entities' `DatetimeColumn` decorator picks its
SQL type from `DB_TYPE` at import time. CI runs it this way (see
`.github/workflows/main-ci.yml`):

```sh
docker run -d --name hexabot-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=hexabot_test -p 5432:5432 postgres:16

DB_TYPE=postgres \
TEST_POSTGRES_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hexabot_test \
  pnpm --filter @hexabot-ai/api exec jest --runInBand \
  --runTestsByPath src/migration/migrations/1784815200000-v-3-4-0.integration.spec.ts
```

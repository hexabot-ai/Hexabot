# Middleware helpers

Middleware helpers form an onion-style chain that wraps the handling of every
inbound channel event (user messages **and** status events: delivery, read,
typing, echo, …) before it reaches the workflow engine. Use them to deduplicate
provider redeliveries, rate limit a contact, merge consecutive messages,
transcribe audio (Speech-to-Text), measure turn duration, etc.

Unlike storage/RAG helpers (where a single "default" helper is selected), **all**
registered middleware helpers run, ordered by `getPriority()` (lower runs first,
outermost layer).

## Contract

A middleware helper extends `BaseMiddlewareHelper` and implements one onion
method:

```ts
abstract handle(
  event: ChannelInboundEvent,
  next: InboundMiddlewareNext,
): Promise<void>;
```

- Call `await next()` to let the event proceed — optionally after mutating it in
  place (e.g. Speech-to-Text sets the transcript as text).
- **Do not** call `next()` to drop the event (e.g. deduplicate redeliveries,
  rate limit).
- Wrap `await next()` in `try/catch` / `try/finally` to react to downstream
  success or failure (e.g. roll back a claim, record metrics).

A helper that only observes must guard its own errors and still call `next()`:
a thrown error propagates to the transport, which logs it and abandons the
event. Message-specific helpers should narrow on the type (e.g.
`event instanceof MessageInboundEvent`) and pass other events straight through.

## Interception point

The chain is executed by each transport through
`ChannelHandler.dispatchInboundEvent(event, next)`, which wraps **all
post-decode processing** as `next`: subscriber resolution/creation, attachment
persistence/uploads, thread resolution, socket broadcasts, and hook emission. A
dropped event therefore incurs none of those side effects.

> Channels that override `handle()` or dispatch events themselves (e.g. a
> gateway/WebSocket channel that calls `ChannelEventBus` directly) must route
> their inbound events through `dispatchInboundEvent` to participate in the
> chain.

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

A helper that builds its index from an external embedding provider should
extend `BaseRagEmbeddingHelper` instead. It carries the chunking
(`chunkSearchText`), provider resolution, query/chunk embedding, vector
validation, and the profile hash that keys stored vectors to the configuration
that produced them. All of it is shared for one reason: two helpers that
disagreed on any of it would produce indexes that cannot be compared or
migrated between.

The CMS lifecycle hooks forwarded to `index` and `remove` are best-effort
latency signals. They are not durable change capture: a process failure after
the CMS transaction commits, direct SQL, or another writer can cause an
external index to drift. A custom helper that needs correctness should use a
database outbox, database-native change capture, or an equivalent durable
queue. It should also implement a complete, idempotent `reindex()` so
administrators can reconcile it through `POST /content/rag/reindex`.

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

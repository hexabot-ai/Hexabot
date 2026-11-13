# Helper module

Helpers are the swappable backends of the API. Each one implements a
capability behind a base class, and each instance selects which implementation
runs through a global setting. Attachments do not know where their files are
stored, and RAG retrieval does not know how content is searched: both ask
`HelperService` for the selected helper.

This module discovers helpers, registers them by type and name, and resolves
them for the rest of the API.

## Helper types

| Type      | Base class                                    | Built-in          | Selected by                              |
| --------- | --------------------------------------------- | ----------------- | ---------------------------------------- |
| `storage` | `BaseStorageHelper`                           | `local-storage`   | `global_settings.default_storage_helper` |
| `rag`     | `BaseRagHelper` (or `BaseRagEmbeddingHelper`) | `fulltext-search` | `global_settings.default_rag_helper`     |
| `util`    | `BaseHelper`                                  | none              | no default: resolved by name or class    |

The base classes live in `lib/`. `BaseHelper` holds what every helper shares: a
name, a type, `getSettings()` and `isAvailable()`. The built-in helpers live in
`src/extensions/helpers/`.

## Discovery and registration

`HelperModule` loads helper providers with `nestjs-dynamic-providers` from
these paths, relative to the API package:

- `node_modules/@hexabot-ai/api/dist/extensions/helpers/**/*.helper.js`: the
  built-in helpers, when the API runs as a dependency of a project.
- `node_modules/hexabot-helper-*/**/*.helper.js` and
  `../../node_modules/hexabot-helper-*/**/*.helper.js`: helper packages
  installed in the API package or at the workspace root.
- `dist/extensions/helpers/**/*.helper.js`: helpers compiled from
  `src/extensions/helpers/`, the built-in ones in this package and custom ones
  in a project.

Only files that match these patterns are loaded, so a helper class goes in a
`*.helper.ts` file (the built-in ones use `index.helper.ts`).

Once Nest has built a helper, `BaseHelper.onModuleInit` registers it with
`HelperService`, unless `isAvailable()` returns `false`. A helper overrides
`isAvailable()` to stay out of the registry, and so out of the helper
selectors, when its environment cannot run it: `fulltext-search` is only
available on PostgreSQL and SQLite. Names are unique within a type: a second
helper with the same type and name stops the boot.

`HelperModule` is global and imports `HttpModule`, `CmsModule`, `ChatModule`
and `UserModule`, so helpers can inject their services.

## Resolving helpers

`HelperService` holds the registry:

- `getDefaultHelper(type)` returns the helper named by
  `global_settings.default_<type>_helper`. It reads the setting on every call,
  so a new selection applies without a restart. It throws for `util`, which
  has no default, and when the selected helper is not registered.
- `get(type, name)` returns a helper by name, and throws when none is
  registered.
- `use(type, HelperClass)` returns the registered instance of a class.
- `getAllByType(type)` and `getAll()` list the registered helpers.

`AttachmentService` resolves the default storage helper on each store and
read. `ContentService.retrieve` and `RagService` resolve the default RAG
helper.

`HelperService` also constrains the `default_<type>_helper` settings: the value
must be the name of a registered helper of that type, so an administrator
cannot select a helper that is not installed or not available.

`GET /api/helper/:type` lists the names of the registered helpers of a type
(`[{ "name": "local-storage" }]`). It is public, answers `400` for an unknown
type, and feeds the helper selectors of the settings page.

## Helper settings

A helper's settings are a runtime setting group named after the helper, and
`getSettings()` returns that group. The group is declared in a `*.settings.ts`
file next to the helper, which `SettingModule` discovers from
`dist/extensions/**/*.settings.js` and `node_modules/hexabot-*/**/*.settings.js`:

```ts
import { createSettingGroup } from '@hexabot-ai/api';
import { z } from 'zod';

export const S3_STORAGE_HELPER_NAME = 's3-storage' as const;

export const s3StorageSettingsSchema = z.strictObject({
  bucket: z.string().default('').meta({ title: 'Bucket' }),
});

declare global {
  interface RuntimeSettingRegistry {
    [S3_STORAGE_HELPER_NAME]: typeof s3StorageSettingsSchema;
  }
}

export const S3StorageSettingsGroup = createSettingGroup({
  group: S3_STORAGE_HELPER_NAME,
  schema: s3StorageSettingsSchema,
  scope: 'extension',
  extensionType: 'helper',
  extensionName: S3_STORAGE_HELPER_NAME,
});
```

Missing settings are created with their defaults at every boot. The group must
match the helper name: setting hooks are named after the group
(`hook:<group>:<label>`), and at boot `ExtensionModule` deletes the stored
helper setting groups that no registered helper owns. A helper whose
`isAvailable()` returns `false` is not registered, so its stored settings are
deleted too.

Built-in helpers keep their translations in `i18n/<lang>.translations.json`,
under a key named after the helper (see `local-storage`).

## Storage helpers

A storage helper keeps the files of attachments. It extends
`BaseStorageHelper` and implements `store`, `download`, `readAsBuffer` and
`readAsStream`. `AttachmentService` owns the attachment records: `store` writes
the file and returns the attachment fields with a `location`, which
`AttachmentService` saves; the read methods receive that attachment back and
find the file from its `location`.

The built-in `local-storage` helper writes files under `UPLOAD_DIR`, and
subscriber and user avatars under `UPLOAD_DIR/avatars`. It resolves a
`location` inside the root directory of the attachment's resource and refuses
one that leads outside it (`../../etc/passwd`). A custom helper that maps
`location` to a path must do the same.

An attachment does not record which helper stored it, and changing
`default_storage_helper` moves no files: the newly selected helper reads the
`location` of every existing attachment. Move the files, or keep `location`
values that both helpers understand, before switching.

## RAG helpers

Hexabot ships with one built-in, database-owned RAG helper:

- `fulltext-search` is the default. PostgreSQL uses a GIN expression index over
  the canonical `contents.searchText`; SQLite uses an FTS5 table maintained by
  database triggers.

Additional RAG helpers can be installed as `hexabot-helper-*` packages. They
own their settings, storage, and database lifecycle.

The selected helper is controlled by
`global_settings.default_rag_helper`. RAG retrieval is always available through
that helper; there is no feature enable/disable switch. Selecting another
helper calls its `reindex()`, when it has one, so it can build its index from
the database.

### Custom helper consistency

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

### Excluded query terms

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

### v3.4.0 migration and rollback

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

## Adding a helper type

A capability that instances should be able to swap gets its own type:

1. Add it to `HelperType` and map it to its base class in `HelperTypeMap`
   (`types.ts`).
2. Add the base class in `lib/`: it sets `type` and declares the contract.
3. Add `default_<type>_helper`, with a default, to `globalSettingsSchema`
   (`src/setting/default.settings.ts`). `getDefaultHelper` fails without it.
4. For the settings selector, add an entity type and its `/helper/<type>`
   route in the frontend (`EntityType`, `services/entities.ts`,
   `services/api.class.ts`), and point the setting's `ui:options.entity` at it.

## Testing

Unit tests run against the default SQLite config. The module's own specs sit
next to its files; the built-in helpers have theirs in
`src/extensions/helpers/`:

```sh
pnpm --filter @hexabot-ai/api test
```

The core RAG migration has a PostgreSQL integration suite
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

# Hexabot API MCP Server

This module exposes Hexabot API capabilities through the Model Context Protocol
(MCP) so coding agents can inspect and manage workflows, workflow runs, memory
definitions, actions, credentials, MCP servers, and CMS content.

The implementation uses `@rekog/mcp-nest` with Streamable HTTP transport.
Authentication is Hexabot-native: users create personal MCP bearer tokens from
their Hexabot account and paste those tokens into MCP clients such as Codex or
Claude Code.

## Runtime endpoints

All routes are mounted under the existing API prefix.

| Route                       | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `/api/mcp`                  | Streamable HTTP MCP endpoint.                                            |
| `/api/mcp-token`            | List and create MCP personal access tokens for the current Hexabot user. |
| `/api/mcp-token/:id/revoke` | Revoke one MCP personal access token owned by the current Hexabot user.  |

The MCP endpoint is stateful and uses `mcp-session-id` headers for sessions.

## Enabling the server

Set the MCP variables in `packages/api/.env` and restart the API.

```dotenv
MCP_ENABLED=true
MCP_SERVER_NAME=hexabot-api
MCP_SERVER_TITLE=Hexabot API MCP Server
MCP_SERVER_VERSION=1.0.0
```

## Authentication and authorization

MCP requests use Hexabot-issued bearer tokens. Tokens are prefixed with
`hbt_mcp_` and are shown only once when created.

The guard chain is:

1. `HexabotMcpTokenGuard` validates the bearer token hash and resolves its
   active Hexabot owner.
2. `McpPermissionGuard` checks the requested tool against Hexabot role
   permissions.

Token storage is intentionally secret-safe:

- Raw token values are never stored.
- Only a SHA-256 token hash and short display prefix are persisted.
- The full token is returned only in the create-token response.
- Revoked, expired, unknown, or inactive-owner tokens are rejected.

The token owner must be an active Hexabot user.

Tool permissions use `@McpPermission(model, action)` metadata and the existing
`PermissionService`. For example, workflow read tools require the caller role to
have `workflow:read`; workflow mutation tools require the corresponding create
or update permission.

## Creating a bearer token

Use the authenticated Hexabot REST API to create a token for the current user:

```http
POST /api/mcp-token
Content-Type: application/json

{
  "name": "Codex",
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

The response includes the raw bearer token once:

```json
{
  "token": "hbt_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "record": {
    "id": "token-id",
    "name": "Codex",
    "tokenPrefix": "hbt_mcp_xxxxxxxx",
    "owner": "user-id",
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "lastUsedAt": null,
    "revokedAt": null,
    "createdAt": "2026-05-05T00:00:00.000Z",
    "updatedAt": "2026-05-05T00:00:00.000Z"
  }
}
```

Copy the `token` value into the MCP client. After this response, Hexabot cannot
show the raw token again.

List token metadata:

```http
GET /api/mcp-token
```

Revoke a token:

```http
POST /api/mcp-token/{id}/revoke
```

## Connecting an MCP client

Use a Streamable HTTP MCP client pointed at:

```text
http://localhost:3000/api/mcp
```

Production clients should use the public API origin, for example:

```text
https://api.example.com/api/mcp
```

If a client requires a JSON config entry, the exact field names depend on the
client, but the effective configuration should be equivalent to:

```json
{
  "mcpServers": {
    "hexabot": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer hbt_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Tool surface

Tools never return a whole user record. A populated user relation (`createdBy`
of workflows and versions, `triggeredBy` of runs, user or subscriber, `owner`
of credentials) is reduced to `{ id, firstName, lastName }`; an unpopulated one
stays a plain id. So is the copy of the initiator a run keeps in its context
for its workflow to read (`context.initiator`, also in an embedded
`parentRun`): it stays whole in the database, since workflows may use any of
its fields. The email, roles, provider and password-reset state of users are
therefore never returned.

Secrets are write-only: tools accept credential values and secret settings,
but never return them (see each section below). The MCP server does not log
request bodies or tool results either: the `debug` level of `@rekog/mcp-nest`,
which prints both in full, is turned off (`logging` in `mcp-api.module.ts`).

### Workflows

| Tool                              | Permission               | Purpose                                                                                      |
| --------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `hexabot_workflow_search`         | `workflow:read`          | Search workflows by metadata.                                                                |
| `hexabot_workflow_get`            | `workflow:read`          | Read one workflow with compact version metadata.                                             |
| `hexabot_workflow_version_status` | `workflow:read`          | Check current and published version pointers for one workflow.                               |
| `hexabot_workflow_create`         | `workflow:create`        | Create a workflow and optionally commit initial YAML.                                        |
| `hexabot_workflow_update`         | `workflow:update`        | Update workflow metadata and optionally commit YAML.                                         |
| `hexabot_workflow_yaml_validate`  | `workflow:read`          | Validate workflow definition YAML without creating a version.                                |
| `hexabot_workflow_yaml_get`       | `workflowversion:read`   | Read exact workflow YAML by current workflow version or version ID with byte-range chunking. |
| `hexabot_workflow_yaml_commit`    | `workflowversion:create` | Validate and commit workflow definition YAML.                                                |
| `hexabot_workflow_rollback`       | `workflowversion:create` | Roll back to a previous version by creating a new restore snapshot.                          |
| `hexabot_workflow_publish`        | `workflow:update`        | Publish the current workflow version.                                                        |
| `hexabot_workflow_unpublish`      | `workflow:update`        | Clear the published workflow version.                                                        |
| `hexabot_workflow_run`            | `workflowrun:create`     | Run a manual or scheduled workflow and return the run summary, or its ID while it runs.      |

Workflow YAML is validated with `parseWorkflowDefinition()` before a version is
created. Coding agents can call `hexabot_workflow_yaml_validate` first to get
structured validation errors without mutating workflow state.
`hexabot_workflow_create` runs the same checks on its `definitionYml` before
creating the workflow: when the definition is refused (invalid YAML, an action
the workflow's type cannot run), no workflow is created and the same call can be
retried with a fixed definition. A workflow created without a `type` is
`conversational`. Commits inherit
the workflow's current version as their parent unless `parentVersion` is
explicitly supplied. `hexabot_workflow_rollback` creates a new current restore snapshot;
publish that snapshot with `hexabot_workflow_publish` when it should become the
published version.

Large YAML definitions are intentionally omitted from workflow and version list
or metadata tools. Use `hexabot_workflow_yaml_get` with `workflowId` or
`versionId` to retrieve the exact YAML. Its `offset`, `limit`, `endOffset`, and
`nextOffset` fields use UTF-8 byte offsets; the response also includes the
version checksum and total byte length so clients can verify reconstruction.

### Workflow versions and runs

| Tool                              | Permission               | Purpose                                                                                          |
| --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `hexabot_workflow_version_search` | `workflowversion:read`   | List compact version metadata for a workflow.                                                    |
| `hexabot_workflow_version_get`    | `workflowversion:read`   | Read compact version metadata.                                                                   |
| `hexabot_workflow_version_update` | `workflowversion:update` | Update workflow version metadata.                                                                |
| `hexabot_workflow_rollback`       | `workflowversion:create` | Restore a previous version by creating a new snapshot.                                           |
| `hexabot_workflow_run_search`     | `workflowrun:read`       | Search workflow runs by workflow and status.                                                     |
| `hexabot_workflow_run_pending`    | `workflowrun:read`       | List suspended runs waiting on an admin (`await_approval`, `suspend_workflow`) with their waits. |
| `hexabot_workflow_run_get`        | `workflowrun:read`       | Read one workflow run with populated workflow metadata but no nested YAML body.                  |
| `hexabot_workflow_run_debug`      | `workflowrun:read`       | Inspect one workflow run with execution state and parent/child run context for troubleshooting.  |

Workflow run, search, get and pending responses strip nested `definitionYml`
fields from populated workflow-version relations, and the resume checkpoint.
`hexabot_workflow_run` and `hexabot_workflow_run_pending` replace the checkpoint
with `openWaits` (`waitId`, `reason`, `step`, `data`), its only content the run
output and step log do not hold; the pending tool lists admin waits only.
`hexabot_workflow_run` waits for the run to finish, fail or suspend for at
most `waitTimeoutSeconds` (default 30, at most 300), under the 60 s request
timeout of MCP SDK clients. A run still going then, or any run with
`wait: false`, is returned right away with `inProgress: true` and its status
(`idle` or `running`), and goes on server-side: poll
`hexabot_workflow_run_get` with its `id`. Calling the tool again would start
another run. A step that refuses the input once the run resumed is reported
as an error only while the tool still waits; afterwards the run is back to
`suspended` on the same wait.
`hexabot_workflow_run` can reach a suspended run of the workflow that waits
for outside input instead of starting a new run. When that run refuses the
input, or another request resumed it first, the tool returns an error (its
message lists the refused fields) instead of `accepted: true`; the run still
waits on the same input.
Deciding on a wait is only possible through the REST API
(`PATCH /api/workflowrun/:id/approve|reject|resume|cancel`). `hexabot_workflow_run_debug` returns the
executed YAML once as top-level `workflowDefinitionYml` only when
`includeWorkflowDefinition=true`.

### Memory definitions

| Tool                               | Permission                | Purpose                     |
| ---------------------------------- | ------------------------- | --------------------------- |
| `hexabot_memory_definition_search` | `memorydefinition:read`   | Search memory definitions.  |
| `hexabot_memory_definition_get`    | `memorydefinition:read`   | Read one memory definition. |
| `hexabot_memory_definition_create` | `memorydefinition:create` | Create a memory definition. |
| `hexabot_memory_definition_update` | `memorydefinition:update` | Update a memory definition. |

### Actions and runtime bindings

| Tool                     | Permission      | Purpose                                        |
| ------------------------ | --------------- | ---------------------------------------------- |
| `hexabot_action_search`  | `workflow:read` | Search available workflow actions and schemas. |
| `hexabot_action_get`     | `workflow:read` | Read one workflow action schema.               |
| `hexabot_binding_search` | `workflow:read` | Search runtime binding kind schemas.           |
| `hexabot_binding_get`    | `workflow:read` | Read one runtime binding schema.               |

### Credentials

| Tool                        | Permission          | Purpose                                                 |
| --------------------------- | ------------------- | ------------------------------------------------------- |
| `hexabot_credential_search` | `credential:read`   | Search credential metadata by name or owner.            |
| `hexabot_credential_get`    | `credential:read`   | Read credential metadata.                               |
| `hexabot_credential_create` | `credential:create` | Store a secret as a credential owned by the token user. |
| `hexabot_credential_update` | `credential:update` | Rename a credential or replace its secret value.        |

Credential secret values are write-only. The MCP tools remove the `value`
field from all credential responses and do not support searching by secret
value. A name another credential has is refused (`A credential named ... already
exists`).

### Settings

| Tool                         | Permission       | Purpose                                                           |
| ---------------------------- | ---------------- | ----------------------------------------------------------------- |
| `hexabot_setting_search`     | `setting:read`   | List runtime settings and their values, optionally for one group. |
| `hexabot_setting_schema_get` | `setting:read`   | Read the JSON Schema of one setting group.                        |
| `hexabot_setting_update`     | `setting:update` | Set one setting, addressed by `group` and `label`.                |

`hexabot_setting_update` validates the value like `PATCH /api/setting/:id`;
a refused value is reported with the reason, e.g. the helpers a
`default_*_helper` setting accepts. A setting's value is returned only when
its group's registered schema declares it and does not mark it as a secret
(a password field in the admin UI, `ui:widget: password`, such as
`global_settings.license_key`). Any other setting, including those a removed
extension left behind, is returned with `secret: true` and `hasValue` instead
of its value.

### Channel sources

| Tool                     | Permission      | Purpose                                                                 |
| ------------------------ | --------------- | ----------------------------------------------------------------------- |
| `hexabot_channel_search` | `source:read`   | List registered channels with the JSON Schema of their source settings. |
| `hexabot_source_search`  | `source:read`   | Search channel sources by name, channel, state or default workflow.     |
| `hexabot_source_get`     | `source:read`   | Read one channel source.                                                |
| `hexabot_source_create`  | `source:create` | Create a source of a registered channel.                                |
| `hexabot_source_update`  | `source:update` | Set the name, state, `defaultWorkflow` or some settings of a source.    |

`hexabot_source_update` merges the `settings` it receives into the current
ones, so settings it leaves out keep their value; `defaultWorkflow: null`
clears the workflow. A source setting is returned only when its channel's
settings schema declares it and does not mark it as a password field; the
others are left out of `settings` and named in `secretSettings` when they have
a value. Removing a channel extension only disables its sources, which keep
their settings: with no schema left, all of them are withheld. A source's
channel cannot change through MCP.

### MCP servers

| Tool                        | Permission         | Purpose                             |
| --------------------------- | ------------------ | ----------------------------------- |
| `hexabot_mcp_server_search` | `mcpserver:read`   | Search configured MCP servers.      |
| `hexabot_mcp_server_get`    | `mcpserver:read`   | Read one configured MCP server.     |
| `hexabot_mcp_server_create` | `mcpserver:create` | Create an MCP server configuration. |
| `hexabot_mcp_server_update` | `mcpserver:update` | Update an MCP server configuration. |

### CMS and RAG content

| Tool                          | Permission           | Purpose                                           |
| ----------------------------- | -------------------- | ------------------------------------------------- |
| `hexabot_content_type_search` | `contenttype:read`   | Search CMS content types.                         |
| `hexabot_content_type_get`    | `contenttype:read`   | Read one content type.                            |
| `hexabot_content_type_create` | `contenttype:create` | Create a content type.                            |
| `hexabot_content_type_update` | `contenttype:update` | Update a content type.                            |
| `hexabot_content_search`      | `content:read`       | Search CMS content records.                       |
| `hexabot_content_get`         | `content:read`       | Read one content record.                          |
| `hexabot_content_create`      | `content:create`     | Create a content record.                          |
| `hexabot_content_update`      | `content:update`     | Update a content record.                          |
| `hexabot_rag_content_search`  | `content:read`       | Search indexed CMS content through RAG retrieval. |

`hexabot_rag_content_search` takes an optional `properties` list of content
property keys (e.g. `["url"]`); each hit then carries those keys in
`properties`, so a client can cite the source page.

#### Content type schemas

A content type's `schema` is an object schema whose `properties` map each field
key to `{ type, title?, description? }`. `type` is a Hexabot field type, not a
JSON Schema type (`CONTENT_FIELD_TYPES` in `@hexabot-ai/types`):

| `type`     | Content value                                   | Admin UI input      | Used by `send_list` as |
| ---------- | ----------------------------------------------- | ------------------- | ---------------------- |
| `string`   | string                                          | single-line text    | title, subtitle        |
| `textarea` | string                                          | multi-line text     |                        |
| `uri`      | string                                          | URL                 | `web_url` button link  |
| `boolean`  | boolean                                         | switch              |                        |
| `file`     | `{ "type": "image", "payload": { "id": "…" } }` | attachment uploader | element image          |

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string", "title": "Title" },
    "status": { "type": "boolean", "title": "Status" },
    "link": { "type": "uri", "title": "Link" },
    "image": { "type": "file", "title": "Image" }
  },
  "required": ["link"]
}
```

The built-in `title` and `status` fields must be kept. A field takes no other
key: `format`, `enum`, `default` and the like are refused (REST and MCP alike),
since nothing would use them; write `{"type":"uri"}`, not
`{"type":"string","format":"uri"}`. `html` is no longer a field type: fields
stored with it are read as `textarea` (and imported workflow bundles turn them
into `textarea`), but a schema sent with it is refused.

In `hexabot_content_create`/`hexabot_content_update`, `properties` holds the
field values by key; `title` and `status` are arguments of their own. A `file`
value's `type` is `image`, `video`, `audio` or `file`, and its `payload` is
`{ "id": "<attachment id>" }` or `{ "url": "<file URL>" }`. Channels send
either, but the admin UI only shows file values that have an `id`.

The properties are checked against the content type
(`buildContentPropertiesSchema` in `@hexabot-ai/types`), over MCP and REST
alike: each value must match its field type (a `uri` value must be a URL),
required fields need a value, optional ones may be left out, `null` or `""`,
and keys that are not fields of the content type are refused. An update checks
them only when it changes `properties` or `contentType`, so toggling `status`
keeps the properties stored before. CSV imports read `true`/`false` (or
`1`/`0`) cells for boolean fields and file URLs for file fields, and report the
rows that do not match.

## Extending the MCP module

Add new tools in the focused provider file under `tools/` that matches the
domain, or create a new `*-mcp.tools.ts` provider when the domain is new. Export
and register new providers through `tools/index.ts`.

Each tool should:

1. Use `@Tool()` with a stable `hexabot_*` name and a Zod parameter schema.
2. Use `@McpPermission(model, action)` with existing Hexabot permission models.
   It also applies `McpPermissionGuard` (`@ToolGuards`), so do not add the
   guard yourself. `@ToolGuards` replaces the guards set before it: a tool that
   needs another guard lists it with `McpPermissionGuard` in a `@ToolGuards`
   placed above `@McpPermission`.
3. Return plain JSON-serializable data.
4. Avoid exposing secrets, tokens, connection strings, or raw credential values.
5. Reduce populated user relations with `toUserRef` (`tools/hexabot-mcp.utils.ts`)
   instead of returning the user record.

If a tool changes API behavior or a public contract, update this README and the
relevant tests in `packages/api/src/mcp`.

## Tests

Run the API checks from the repository root:

```bash
pnpm --filter @hexabot-ai/api run typecheck
pnpm --filter @hexabot-ai/api run lint
pnpm --filter @hexabot-ai/api run test
pnpm --filter @hexabot-ai/api run test:e2e
pnpm --filter @hexabot-ai/api run build
```

The MCP e2e tests are enabled only when `MCP_ENABLED=true`. A local test command
is:

```bash
NODE_ENV=test MCP_ENABLED=true pnpm --filter @hexabot-ai/api run test:e2e
```

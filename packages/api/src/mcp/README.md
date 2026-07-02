# Hexabot API MCP Server

This module exposes Hexabot API capabilities through the Model Context Protocol
(MCP) so coding agents can inspect and manage workflows, workflow runs, memory
definitions, actions, credentials, MCP servers, and CMS content.

The implementation uses `@rekog/mcp-nest` with Streamable HTTP transport.
Authentication is Hexabot-native. MCP clients use legacy MCP bearer tokens, and
REST API clients can use scoped personal API tokens generated from the Hexabot
profile screen.

## Runtime endpoints

All routes are mounted under the existing API prefix.

| Route                       | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `/api/mcp`                  | Streamable HTTP MCP endpoint.                                            |
| `/api/mcp-token`            | List and create MCP personal access tokens for the current Hexabot user. |
| `/api/mcp-token/:id/revoke` | Revoke one MCP personal access token owned by the current Hexabot user.  |
| `/api/api-token`            | List and create scoped REST API tokens for the current Hexabot user.     |
| `/api/api-token/scopes`     | List model/action scopes the current user can grant to an API token.     |
| `/api/api-token/:id/revoke` | Revoke one REST API token owned by the current Hexabot user.             |

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

MCP requests use Hexabot-issued bearer tokens. Legacy MCP tokens are prefixed
with `hbt_mcp_`, remain MCP-only, and are shown only once when created.

REST API requests can use personal API tokens prefixed with `hbt_api_`:

```http
Authorization: Bearer hbt_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API token authorization is capped by both token scopes and the owner's current
role permissions. A token with `workflow:read` cannot create workflows, and a
token stops working for a scope as soon as the owner loses the matching role
permission. API tokens do not authenticate session, auth, token-management,
webhook, public, or websocket endpoints.

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

## Creating a REST API token

List scopes the current session user can grant:

```http
GET /api/api-token/scopes
```

Create a scoped token:

```http
POST /api/api-token
Content-Type: application/json

{
  "name": "Build automation",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "scopes": [
    { "model": "workflow", "action": "read" },
    { "model": "workflowrun", "action": "create" }
  ]
}
```

The response includes the raw `hbt_api_...` bearer token once, plus metadata
such as `tokenPrefix`, `scopes`, expiry, last-use time, and revoke state. Raw
token values are never stored and cannot be shown again.

Use the token on REST endpoints whose model/action is covered by both the token
scope and the owner's live permissions:

```http
GET /api/workflow
Authorization: Bearer hbt_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
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
| `hexabot_workflow_run`            | `workflowrun:create`     | Run a manual or scheduled workflow and return the run summary.                               |

Workflow YAML is validated with `parseWorkflowDefinition()` before a version is
created. Coding agents can call `hexabot_workflow_yaml_validate` first to get
structured validation errors without mutating workflow state. Commits inherit
the workflow's current version as their parent unless `parentVersion` is
explicitly supplied. `hexabot_workflow_rollback` and
`hexabot_workflow_version_restore` both create a new current restore snapshot;
publish that snapshot with `hexabot_workflow_publish` when it should become the
published version.

Large YAML definitions are intentionally omitted from workflow and version list
or metadata tools. Use `hexabot_workflow_yaml_get` with `workflowId` or
`versionId` to retrieve the exact YAML. Its `offset`, `limit`, `endOffset`, and
`nextOffset` fields use UTF-8 byte offsets; the response also includes the
version checksum and total byte length so clients can verify reconstruction.

### Workflow versions and runs

| Tool                               | Permission               | Purpose                                                                                         |
| ---------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `hexabot_workflow_version_search`  | `workflowversion:read`   | List compact version metadata for a workflow.                                                   |
| `hexabot_workflow_version_get`     | `workflowversion:read`   | Read compact version metadata.                                                                  |
| `hexabot_workflow_version_update`  | `workflowversion:update` | Update workflow version metadata.                                                               |
| `hexabot_workflow_version_restore` | `workflowversion:create` | Restore a previous version by creating a new snapshot.                                          |
| `hexabot_workflow_run_search`      | `workflowrun:read`       | Search workflow runs by workflow and status.                                                    |
| `hexabot_workflow_run_get`         | `workflowrun:read`       | Read one workflow run with populated workflow metadata but no nested YAML body.                 |
| `hexabot_workflow_run_debug`       | `workflowrun:read`       | Inspect one workflow run with execution state and parent/child run context for troubleshooting. |

Workflow run search/get responses strip nested `definitionYml` fields from
populated workflow-version relations. `hexabot_workflow_run_debug` returns the
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

| Tool                        | Permission        | Purpose                                      |
| --------------------------- | ----------------- | -------------------------------------------- |
| `hexabot_credential_search` | `credential:read` | Search credential metadata by name or owner. |
| `hexabot_credential_get`    | `credential:read` | Read credential metadata.                    |

Credential secret values are never returned. The MCP tools remove the `value`
field from all credential responses and do not support searching by secret
value.

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

## Extending the MCP module

Add new tools in the focused provider file under `tools/` that matches the
domain, or create a new `*-mcp.tools.ts` provider when the domain is new. Export
and register new providers through `tools/index.ts`.

Each tool should:

1. Use `@Tool()` with a stable `hexabot_*` name and a Zod parameter schema.
2. Use `@ToolGuards([McpPermissionGuard])`.
3. Use `@McpPermission(model, action)` with existing Hexabot permission models.
4. Return plain JSON-serializable data.
5. Avoid exposing secrets, tokens, connection strings, or raw credential values.

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

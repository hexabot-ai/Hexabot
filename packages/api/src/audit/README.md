# Audit Module

The audit module records security-relevant and data-changing activity in the
Hexabot API.

It combines:

- Controller-level audit events through `nestjs-auditlog` decorators.
- TypeORM write auditing for entity creates, updates, and deletes.
- Per-request actor and correlation metadata through `nestjs-cls`.
- A pluggable export backend for local database storage, OpenTelemetry, or
  ClickHouse.
- A read-only REST API for locally stored audit records.

The module is registered from `AppModule` through `AuditModule`.

## Responsibilities

The module is responsible for:

- Capturing write operations on TypeORM entities.
- Capturing explicit controller actions such as login, logout, and audit log
  reads.
- Recording request metadata: request ID, actor, IP address, user agent, method,
  and path.
- Masking configured sensitive fields in persisted before/after/diff payloads.
- Preventing audit export failures from breaking business operations unless
  `AUDIT_LOG_FAIL_CLOSED=true`.
- Exposing audit records when the configured backend is `database`.

The module is not responsible for:

- Replacing application logs.
- Reconstructing historical state from audit records.
- Enforcing permissions by itself. Access still goes through the API role and
  permission guard.
- Storing local records when the backend is OpenTelemetry or ClickHouse.

## Module Layout

```text
packages/api/src/audit
|-- audit.module.ts                  # public Nest module
|-- audit-core.module.ts             # shared providers and local entity setup
|-- controllers/
|   `-- audit-log.controller.ts      # read API for local database backend
|-- decorators/
|   `-- audit-log.decorators.ts      # controller audit decorators
|-- dto/
|   `-- audit-log.dto.ts             # DTO contract for local records
|-- entities/
|   `-- audit-log.entity.ts          # TypeORM entity for local records
|-- exporters/
|   |-- audit-backend.factory.ts     # backend selection
|   |-- audit-database.exporter.ts   # local database exporter
|   |-- audit-noop.exporter.ts       # disabled audit exporter
|   `-- audit-safe.exporter.ts       # fail-open/fail-closed wrapper
|-- interceptors/
|   `-- audit-context.interceptor.ts # request context enrichment
|-- repositories/
|   `-- audit-log.repository.ts      # local audit record repository
|-- services/
|   |-- audit-context.service.ts     # CLS-backed request context service
|   `-- audit-log-record.service.ts  # local audit record service
|-- subscribers/
|   `-- audit-log.subscriber.ts      # TypeORM write subscriber
|-- types/
|   `-- audit-context.type.ts
`-- utils/
    `-- request-context.ts           # request ID/IP/user-agent helpers
```

## Runtime Architecture

`AuditModule` wires three concerns:

1. `ClsModule.forRoot()`
   - Creates an async-local request store.
   - Generates or propagates a request ID from `x-request-id` or
     `x-correlation-id`.
   - Stores initial request metadata before route handling.

2. `AuditCoreModule`
   - Registers `AuditLogOrmEntity` with TypeORM.
   - Provides the local database exporter, repository, record service, backend
     factory, and context service.

3. `SdkAuditLogModule.forRootAsync()`
   - Registers `nestjs-auditlog`.
   - Uses `AuditBackendFactory` to select the configured exporter.
   - Installs the SDK global interceptor used by controller decorators.

`AuditModule` also registers:

- `AuditContextInterceptor` as a global interceptor.
- `AuditLogSubscriber` as a TypeORM subscriber.
- `AuditLogController` for local record reads.

## Audit Event Sources

### TypeORM Entity Writes

`AuditLogSubscriber` listens to TypeORM lifecycle events:

- `afterInsert` -> `Create`
- `afterUpdate` -> `Update`
- `afterRemove` -> `Remove`

For each write event, it builds an audit payload:

```ts
{
  resource: {
    id: "<entity primary key>",
    type: "<entity name without OrmEntity suffix>",
    label: "<@AuditLabel field value, when configured>",
  },
  operation: {
    id: "typeorm.<Entity>.<create|update|remove>",
    type: "Create" | "Update" | "Remove",
    status: "SUCCEEDED",
  },
  actor: {
    id: "<request user id or system>",
    type: "<request user roles or system>",
    label: "<request username/name, when available>",
    ip: "<client ip>",
    agent: "<user agent>",
  },
  data_diff: {
    before: { ... } | null,
    after: { ... } | null,
    diff: { ... } | null,
  },
}
```

The subscriber skips internal infrastructure tables:

- `audit_logs`
- `migrations`
- `sessions`
- `stats`

Audit is also skipped globally when `AUDIT_LOG_ENABLED=false`.

Use `@AuditLabel()` on one entity property to capture a stable display label
inside future audit records. Labels are copied from the event payload only; audit
reads do not resolve labels from live entities.

### Controller Decorators

Controller decorators in `decorators/audit-log.decorators.ts` use
`nestjs-auditlog` to record explicit route operations.

Currently provided decorators:

- `AuditAuthLogin()`
- `AuditAuthLogout()`
- `AuditWorkflowRunOperation(operation)`: admin `approve`, `reject`, `resume`
  and `cancel` operations on a suspended workflow run (`workflowrun.<operation>`).
  Comments and resume data are not mapped.

Example:

```ts
@UseGuards(LocalAuthGuard)
@Roles('public')
@Post('local')
@AuditAuthLogin()
async login(@Req() req: Request) {
  return req.user;
}
```

Decorated controller audit events are emitted by the SDK interceptor after the
handler result or error is available.

### Failed Local Login Attempts

Failed local login attempts do not reach the `AuthController` handler because
Passport guards run before controller interceptors. `LocalAuthGuard` therefore
records failed login attempts directly when `super.canActivate()` throws.

The failed login event:

- Uses operation ID `auth.login`.
- Uses operation type `Login`.
- Uses operation status `FAILED`.
- Uses the attempted `identifier` as resource ID and actor ID when present.
- Includes request IP and user-agent.
- Does not include the password.

## Request Context

`AuditContextService` stores and reads request metadata from `nestjs-cls`.

The context can contain:

```ts
type AuditRequestContext = {
  requestId?: string;
  actorId?: string;
  actorType?: string;
  actorLabel?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
};
```

Context is populated in two stages:

1. CLS middleware stores request ID, IP, user-agent, method, and path at the
   beginning of the request.
2. `AuditContextInterceptor` calls `setFromRequest()` after authentication
   middleware has populated `req.user` or `req.session`.

When no request context exists, entity write audit events fall back to:

- actor ID: `system`
- actor type: `system`

This is expected for background jobs, seeders, and startup tasks.

## Backends

The backend is selected by `AUDIT_LOG_BACKEND`.

| Backend | Value | Local read API | Notes |
| --- | --- | --- | --- |
| Database | `database` | Yes | Persists audit records to `audit_logs`. |
| OpenTelemetry HTTP | `opentelemetry-http` | No | Sends logs to an OTLP HTTP endpoint. |
| OpenTelemetry gRPC | `opentelemetry-grpc` | No | Sends logs to an OTLP gRPC endpoint. |
| ClickHouse | `clickhouse` | No | Uses the SDK ClickHouse exporter. |
| Disabled | `AUDIT_LOG_ENABLED=false` | No | Uses the no-op exporter and skips TypeORM write auditing. |

When the backend is not `database`, the `/auditlog` endpoints return
`503 Service Unavailable` because records are not stored locally.

## Configuration

Environment variables are defined in `packages/api/.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `AUDIT_LOG_ENABLED` | `true` | Enables controller and TypeORM audit logging. |
| `AUDIT_LOG_BACKEND` | `database` | Export backend: `database`, `opentelemetry-http`, `opentelemetry-grpc`, or `clickhouse`. |
| `AUDIT_LOG_FAIL_CLOSED` | `false` | When true, awaited audit exporter failures are rethrown. |
| `AUDIT_LOG_SERVICE_NAME` | `hexabot-api` | Service name attached to external audit records. |
| `AUDIT_LOG_SERVICE_NAMESPACE` | `@hexabot-ai/api` | Service namespace attached to external audit records. |
| `AUDIT_LOG_SERVICE_ENVIRONMENT` | `NODE_ENV` or `development` | Deployment environment attached to external audit records. |
| `AUDIT_LOG_MASK_FIELDS` | sensitive defaults | Comma-separated field names masked in entity before/after/diff payloads. |
| `AUDIT_LOG_OTEL_URL` | unset | OTLP exporter URL. |
| `AUDIT_LOG_OTEL_HOSTNAME` | unset | OTLP hostname. |
| `AUDIT_LOG_OTEL_HEADERS` | `{}` | JSON object of OTLP headers. |
| `AUDIT_LOG_OTEL_TIMEOUT_MILLIS` | unset | OTLP timeout. |
| `AUDIT_LOG_OTEL_CONCURRENCY_LIMIT` | unset | OTLP concurrency limit. |
| `AUDIT_LOG_CLICKHOUSE_URL` | unset | ClickHouse URL. |
| `AUDIT_LOG_CLICKHOUSE_DATABASE` | `hexabot_auditlog` | ClickHouse database name. |
| `AUDIT_LOG_CLICKHOUSE_LOG_EXPIRED_DAYS` | unset | ClickHouse TTL in days. |

Example local database configuration:

```env
AUDIT_LOG_ENABLED=true
AUDIT_LOG_BACKEND=database
AUDIT_LOG_FAIL_CLOSED=false
AUDIT_LOG_MASK_FIELDS=password,resetToken,reset_token,token,secret,authorization,apiKey,privateKey,value
```

Example OpenTelemetry HTTP configuration:

```env
AUDIT_LOG_ENABLED=true
AUDIT_LOG_BACKEND=opentelemetry-http
AUDIT_LOG_SERVICE_NAME=hexabot-api
AUDIT_LOG_SERVICE_NAMESPACE=@hexabot-ai/api
AUDIT_LOG_SERVICE_ENVIRONMENT=production
AUDIT_LOG_OTEL_URL=http://otel-collector:4318/v1/logs
AUDIT_LOG_OTEL_HEADERS={"authorization":"Bearer <token>"}
AUDIT_LOG_FAIL_CLOSED=false
```

Example ClickHouse configuration:

```env
AUDIT_LOG_ENABLED=true
AUDIT_LOG_BACKEND=clickhouse
AUDIT_LOG_SERVICE_NAME=hexabot-api
AUDIT_LOG_CLICKHOUSE_URL=http://clickhouse:8123
AUDIT_LOG_CLICKHOUSE_DATABASE=hexabot_auditlog
AUDIT_LOG_CLICKHOUSE_LOG_EXPIRED_DAYS=180
```

## Fail-Open and Fail-Closed Behavior

All configured backends are wrapped in `AuditSafeExporter`.

When `AUDIT_LOG_FAIL_CLOSED=false`:

- Exporter errors are logged.
- The business operation continues.

When `AUDIT_LOG_FAIL_CLOSED=true`:

- Exporter errors are rethrown.
- Awaited audit paths can fail the business operation.

TypeORM subscriber audit writes are awaited by TypeORM lifecycle hooks, so
fail-closed behavior applies directly there.

Controller decorator audit events are emitted by the third-party SDK interceptor
after handler execution. Treat fail-closed behavior on that path as best effort
and verify carefully before relying on it for compliance-sensitive flows.

## Data Redaction

`AuditLogSubscriber` masks configured field names before records are exported.

Masking is:

- Case-insensitive.
- Based on exact field name match.
- Applied recursively to object entries.
- Applied to array entries.

Default masked fields:

```text
password,resetToken,reset_token,token,secret,authorization,apiKey,privateKey,value
```

Example:

```json
{
  "password": "[REDACTED]",
  "profile": {
    "apiKey": "[REDACTED]"
  }
}
```

Only the TypeORM subscriber path normalizes and masks entity payloads. Explicit
controller audit decorators should avoid adding sensitive data to audit payloads
in the first place.

## Local Storage

When `AUDIT_LOG_BACKEND=database`, audit records are stored in the `audit_logs`
table through `AuditLogOrmEntity`.

Stored fields:

| Field | Description |
| --- | --- |
| `id` | Audit record UUID. |
| `createdAt` | Record creation timestamp. |
| `updatedAt` | Record update timestamp. |
| `resourceId` | Audited resource identifier. |
| `resourceType` | Audited resource type. |
| `resourceLabel` | Audited resource display label, when available. |
| `operationId` | Specific operation identifier. |
| `operationType` | High-level operation type. |
| `operationStatus` | `UNSPECIFIED`, `SUCCEEDED`, or `FAILED`. |
| `actorId` | Actor identifier. |
| `actorType` | Actor type or comma-separated role IDs. |
| `actorLabel` | Actor display label, when available. |
| `actorIp` | Client IP, when available. |
| `actorAgent` | User-agent, when available. |
| `requestId` | Correlation/request ID, when available. |
| `requestMethod` | HTTP method, when available. |
| `requestPath` | Original request path, when available. |
| `dataBefore` | Entity snapshot before the operation. |
| `dataAfter` | Entity snapshot after the operation. |
| `dataDiff` | Computed field-level diff. |
| `raw` | Original SDK audit payload. |

Indexes are defined for:

- `resourceType`, `resourceId`
- `actorId`
- `operationType`
- `requestId`

## REST API

`AuditLogController` is mounted at `/auditlog`. With the global API prefix, the
effective paths are:

- `GET /api/auditlog`
- `GET /api/auditlog/count`
- `GET /api/auditlog/:id`

Supported filter fields:

- `resourceId`
- `resourceType`
- `resourceLabel`
- `operationId`
- `operationType`
- `operationStatus`
- `actorId`
- `actorType`
- `actorLabel`
- `actorIp`
- `requestId`
- `requestMethod`
- `requestPath`

The list endpoint defaults to sorting by `createdAt desc`.
List and count responses hide `AuditLog` and `Stats` resource records by
default so audit reads and statistics writes do not pollute the user-facing
trail.

Example:

```http
GET /api/auditlog?where[resourceType]=User&where[operationType]=Update&limit=25
```

Example count query:

```http
GET /api/auditlog/count?where[actorId]=admin-user-id
```

The standard role and permission guard protects these endpoints. Access requires
permissions for the `auditlog` model identity.

## Shared Types

The local audit record output contract is exported from `@hexabot-ai/types`:

- `auditLogSchema`
- `auditLogFullSchema`
- `AuditLog`
- `AuditLogFull`

The API entity uses these schemas through `BaseOrmEntity.toPlainCls()` and
`BaseOrmEntity.toFullCls()`.

## Adding a New Controller Audit Event

Prefer a small named decorator in `decorators/audit-log.decorators.ts` instead
of inlining SDK options in controllers.

Example:

```ts
export const AuditExampleAction = () =>
  AuditLog({
    resource: {
      type: 'Example',
    },
    operation: {
      id: 'example.action',
      type: 'Action',
    },
    resource_id_field_map: 'params.id',
    actor_id_field_map: 'user.id',
    actor_type_field_map: 'user.roles',
  });
```

Use `$response.` mappings when the audited identifier only exists in the handler
response:

```ts
resource_id_field_map: '$response.id'
```

Do not map passwords, tokens, or secrets into controller audit payloads.

## Adding a New Backend

To add another backend:

1. Implement `IAuditLogExporter` from `nestjs-auditlog`.
2. Add any configuration fields to `Config['audit']`.
3. Parse environment variables in `config/index.ts`.
4. Extend `TAuditBackend` in `config/types.ts`.
5. Add a case to `AuditBackendFactory.createConfiguredExporter()`.
6. Add unit coverage for backend selection and safe-export behavior.

Backends should be wrapped by `AuditSafeExporter`; do not bypass the factory.

## Production Deployment Notes

For production deployments using the database backend:

- Ensure the relational schema contains the `audit_logs` table before enabling
  audit writes.
- Ensure the `models` table contains the `auditlog` identity.
- Ensure the relevant roles have permissions for the `auditlog` model.
- Keep `AUDIT_LOG_FAIL_CLOSED=false` unless the deployment is ready for audit
  storage/export failures to reject business operations.

For external backends:

- Validate exporter connectivity in staging before enabling fail-closed mode.
- Confirm retention, access control, and encryption policies in the external
  system.
- Keep local `/api/auditlog` consumers aware that local records are only
  available for the database backend.

## Testing

Focused tests:

```bash
pnpm --filter @hexabot-ai/api run test -- audit
pnpm --filter @hexabot-ai/api run test -- local-auth.guard
```

Package checks:

```bash
pnpm --filter @hexabot-ai/api run typecheck
pnpm --filter @hexabot-ai/api run lint
pnpm --filter @hexabot-ai/api run test
```

Shared contract checks:

```bash
pnpm --filter @hexabot-ai/types run typecheck
pnpm --filter @hexabot-ai/types run lint
pnpm --filter @hexabot-ai/types run test
```

## Troubleshooting

### `/api/auditlog` returns 503

The configured backend is not `database`. Local reads are only supported when
records are stored in `audit_logs`.

### No actor ID is recorded

The operation may be running outside an HTTP request, or before Passport session
data is available. Background operations fall back to `system`.

### Audit records are missing for failed login attempts

Failed local logins are recorded by `LocalAuthGuard`, not by the
`AuditAuthLogin()` controller decorator. Verify `LocalAuthGuard` is still used
on `POST /auth/local` and that `AUDIT_LOG_ENABLED=true`.

### Sensitive data appears in audit records

For entity write audit logs, add the field name to `AUDIT_LOG_MASK_FIELDS`.
For controller decorator logs, remove the sensitive field mapping from the
decorator or avoid adding sensitive data to the request/response payload being
mapped.

### Writes fail when audit export fails

Check `AUDIT_LOG_FAIL_CLOSED`. When true, awaited audit exporter failures are
rethrown.

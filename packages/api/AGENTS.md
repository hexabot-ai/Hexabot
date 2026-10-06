# Agent Handbook - @hexabot-ai/api

Use this file as the entrypoint for AI coding agents working on the Hexabot API. It summarizes the runtime, module layout, and conventions so changes stay consistent with the NestJS architecture.

## Repository orientation
- Package root: `packages/api` (run commands from repo root with PNPM workspaces).
- Entry point: `packages/api/src/main.ts` -> `bootstrapHexabotApp` in `packages/api/src/bootstrap.ts`.
- App composition: `packages/api/src/app.module.ts` (module imports, static UI serving, global guard).
- Feature modules: `packages/api/src/*` (each folder is a Nest module such as `workflow`, `chat`, `cms`, `user`).
- Extensions: `packages/api/src/extensions/*` (built-in actions, channels, helpers; exported from `packages/api/src/extensions/index.ts`).
- Shared infra: `packages/api/src/config`, `packages/api/src/database`, `packages/api/src/logger`, `packages/api/src/websocket`.
- Shared contract package: `@hexabot-ai/types` (`packages/types/src/*`) for zod schemas and inferred entity output types.

## Runtime architecture
- Global prefix `/api` and body parsing (raw body capture) are set in `packages/api/src/bootstrap.ts`.
- Global pipes: `ValidationPipe` (whitelist + transform) plus `UuidPipe` for UUID params.
- Sessions use `express-session` with a TypeORM-backed store (`SessionOrmEntity`) and Passport session support.
- CSRF protection uses `csrf-sync`, enabled by default with exceptions for auth and webhooks.
- Socket.IO gateway lives in `packages/api/src/websocket`, with Redis adapter when `REDIS_ENABLED=true`.
- Static UI is served via `ServeStaticModule` from `dist/static` or `packages/frontend/dist` when present.

## Configuration and environment
- Env is loaded by `dotenv/config` in `packages/api/src/main.ts`; copy `packages/api/.env.example` to `packages/api/.env`.
- Central config lives in `packages/api/src/config/index.ts`; use it instead of reading `process.env` directly.
- Default port is `3000`, API base URL is `/api`, and SQLite uses `packages/api/hexabot.sqlite` unless overridden.
- DB auto-migration runs outside production or when `DB_AUTO_MIGRATE=true` and `API_IS_PRIMARY_NODE=true`.
- Cache and Socket.IO Redis support are toggled by `REDIS_ENABLED`; TTL defaults to `CACHE_TTL`.
- Upload settings and signed URLs are controlled by `UPLOAD_DIR`, `UPLOAD_MAX_SIZE_IN_BYTES`, and `SIGNED_URL_*`.

## Tooling and commands
- Install deps: `pnpm install` (from repo root).
- Dev server: `pnpm --filter @hexabot-ai/api run dev` (Nest watch mode).
- Build: `pnpm --filter @hexabot-ai/api run build` (frontend build + Nest build).
- Prod start: `pnpm --filter @hexabot-ai/api run start:prod`.
- Lint/format: `pnpm --filter @hexabot-ai/api run lint` or `pnpm --filter @hexabot-ai/api run format`.
- Typecheck: `pnpm --filter @hexabot-ai/api run typecheck`.

## Testing workflows
- Unit tests: `pnpm --filter @hexabot-ai/api run test` (Jest, `src/**/*.spec.ts`).
- E2E tests: `pnpm --filter @hexabot-ai/api run test:e2e` (`packages/api/test/jest-e2e.json`).
- Coverage: `pnpm --filter @hexabot-ai/api run test:cov`.
- Watch mode: `pnpm --filter @hexabot-ai/api run test:watch`.
- Debug tests: `pnpm --filter @hexabot-ai/api run test:debug`.

## Database and migrations
- TypeORM config is provided by `packages/api/src/database/typeorm-config.service.ts`.
- Entities typically extend `BaseOrmEntity` (`packages/api/src/database/entities/base.entity.ts`) for UUID + timestamps.
- Migrations live in `packages/api/src/migration/migrations`; module docs in `packages/api/src/migration/README.md`.
- CLI migration commands: `pnpm --filter @hexabot-ai/api run cli migration create|migrate`.
- Seed data runs in non-production via `packages/api/src/seeder.ts` during bootstrap.
- On SQLite, do not use `queryRunner.addColumn`/`dropColumn` on tables other tables reference (e.g. `workflow_runs`): they rebuild the table with `DROP TABLE`, and inside the migration transaction foreign keys stay enforced, so `ON DELETE` actions fire. Use a native `ALTER TABLE ... ADD/DROP COLUMN` there.

## Workflow runs and suspension
- `AgenticService` (`packages/api/src/workflow/services/agentic.service.ts`) hosts the `@hexabot-ai/agentic` runner; the host contract is in `packages/agentic/SUSPENSION.md` §8.
- A suspended run persists one JSON `checkpoint` column, the only state needed to resume it; read its open waits with `getOpenWaits` (`packages/api/src/workflow/lib/workflow-run-waits.ts`). `suspendedAt` versions the suspension. `markFinished`/`markFailed` clear the checkpoint.
- Resume order: compile the pinned definition → `validateCheckpoint` (and again with `{ waitId, resumeData }`) before claiming → `WorkflowRunService.claimSuspended(runId, suspendedAt)` → `buildRunnerFromCheckpoint` → `resume({ waitId, resumeData })`. The claim targets the suspension that was loaded (`suspended_at`), not only the status.
- A refused payload leaves the run suspended on the same wait: before the claim nothing is written; after it, `releaseClaim` puts back the status and the context. Either way `hook:workflow:resume_rejected` is emitted: by the runner for refusals of a step, by `AgenticService` for refusals before the claim.
- Inbound events resolve the first open wait not listed in `HOST_RESOLVED_WAIT_REASONS` (`packages/api/src/workflow/types.ts`); the host resolves the others itself (e.g. `awaiting_child_workflow`, resolved by the child run's result through the wait whose `data.workflow_run_id` matches).
- A child run cannot resume a parent that is not `suspended` (still running, or claimed by another caller). Every path that leaves a run `suspended` (start, resume, refused resume) therefore calls `deliverMissedChildResults` to deliver the results of child runs that ended meanwhile.
- A run that can never resume (missing or drifted checkpoint, no pinned definition) is failed, its parent receives a failed child result, and the event starts a new run. A definition that no longer parses or compiles is not such a case: it depends on the registered actions and binding kinds, so the resume throws and the run stays suspended.
- Actions declare their resume payload with `suspend({ accepts })` instead of validating it and throwing.

## Extensions and dynamic providers
- Built-in extensions live under `packages/api/src/extensions/{actions,channels,helpers}`.
- External extensions are discovered by naming (`hexabot-channel-*`, `hexabot-action-*`, `hexabot-helper-*`) and compiled `dist/extensions`.
- Dynamic providers are resolved during bootstrap via `nestjs-dynamic-providers` before app creation.
- Extension cleanup runs on application bootstrap in `packages/api/src/extension/extension.module.ts`.
- Use extension settings instead of hardcoded behavior when adding new channel/action/helper behavior.
- Channel/helper runtime setting group keys and settings hook namespaces must match the extension `name` (kebab-case).

## Coding conventions and gotchas
- All new TS files must include the license header; ESLint `header/header` enforces it.
- Path alias `@/` maps to `packages/api/src` (see `packages/api/tsconfig.json`); avoid relative path ladders.
- ESLint enforces import ordering and disallows `console.*`; prefer `LoggerService`.
- DTO validation relies on class-validator + `ValidationPipe` (whitelist + transform); keep DTOs in sync with entities.
- Keep API output contract changes aligned with `@hexabot-ai/types` schemas and update `packages/types/README.md` when exported contracts change.
- Chat contract rule: use discriminator-based contracts from `@hexabot-ai/types` only.
- Swagger docs are available at `/docs` in non-production or via `pnpm --filter @hexabot-ai/api run doc`.

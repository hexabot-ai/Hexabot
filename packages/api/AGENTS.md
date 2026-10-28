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
- `WORKFLOW_RUN_CLAIM_TTL` (`config.workflow.runClaimTtl`, ms, default 60000) sets how long a workflow run stays claimed by a node that stopped renewing its claim; see "Workflow runs and suspension".
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
- `AgenticService` (`packages/api/src/workflow/services/agentic.service.ts`) hosts the `@hexabot-ai/agentic` runner; the host contract is in `packages/agentic/SUSPENSION.md` §8. It keeps only the start/resume paths and the parent/child result delivery, which call each other; its collaborators hold the rest:
  - `WorkflowCompiler` compiles the definition a run pins (`compile(run, event)`; `undefined` when none is pinned).
  - `WorkflowRunService` creates runs (`createFromEvent`), claims them and holds their claims, persists runner passes (`persistResult`, `persistCrash`), validates call stacks (`assertCanCallWorkflow`), cancels runs (`cancelSuspended`, `cancelSuspendedDescendants`, `prepareWorkflowDeletion`) and aborts the runs of a closed thread (`hook:thread:postUpdate`).
  - `WorkflowRunRecoveryService` renews the claims held by this process and recovers the runs whose claim lapsed (see below).
  - `lib/workflow-call-stack.ts` holds the pure helpers of parent/child linkage (`resolveRunId`, `getChildRunId`) and the `call_workflow` payload builders.
- A suspended run persists one JSON `checkpoint` column, the only state needed to resume it; read its open waits with `getOpenWaits` (`packages/api/src/workflow/lib/workflow-run-waits.ts`). `suspendedAt` versions the suspension. `markFinished`/`markFailed` clear the checkpoint.
- Resume order: compile the pinned definition → `validateCheckpoint` (and again with `{ waitId, resumeData }`) before claiming → `WorkflowRunService.claimSuspended(runId, suspendedAt)` → `buildRunnerFromCheckpoint` → `resume({ waitId, resumeData })`. The claim targets the suspension that was loaded (`suspended_at`), not only the status. It returns a claim token (`null` when lost) and writes only the status and the claim, so the run can be put back exactly as it was. In `AgenticService`, `claimResume` does everything up to the claim and `runResumePass` the rest (the pass, then the parent/child deliveries); `startRun` likewise splits into `createFromEvent` and `runStartPass`.
- HTTP requests never wait for a pass: a pass, and the runs it resumes in turn, can take minutes, and a proxy in front of the API (nginx) answers `504` after 60 s. The request answers once the run is claimed and the pass goes on in the background, through `runInBackground` (`workflow/lib/run-in-background.ts`), which logs its errors and never rejects. Outcomes carry the background work as `settled` so tests can await it. `AgenticService.resumeWait` returns `accepted` (operator approve/reject/resume answer `202` with the `running` run), `cancelRun` and the workflow `postDelete` hook run the parent resume in the background, and `AgenticService.dispatchEvent` (manual runs, webhooks with `?async=true`) returns `{ run, settled }` once the run is created or claimed. `handleEvent` is `dispatchEvent` plus waiting for `settled` (chat, scheduler, MCP, synchronous webhooks). Start a claimed run's pass right away, never behind other work: its claim is only renewed inside `withHeldClaim`, and an unrenewed claim lapses after the TTL, after which recovery takes the run over. A process that stops during a background pass is covered by recovery like a crash: an admin decision then goes back to the pending list.
- A refused payload leaves the run suspended on the same wait: before the claim nothing is written; after it, `releaseClaim` puts back the status. Either way `hook:workflow:resume_rejected` is emitted: by the runner for refusals of a step, by `AgenticService` for refusals before the claim.
- Claim leases: a run is `idle` or `running` iff it holds a claim (`workflow_runs.claim_id`, lapsing at `claim_expires_at`; both internal, stripped by the run schemas). `createFromEvent` inserts the run already claimed, and `claimSuspended` claims a suspension. `AgenticService` runs each pass inside `WorkflowRunService.withHeldClaim()`, which holds the claim in this process for the whole pass, so `WorkflowRunRecoveryService` renews it (one `UPDATE` every TTL/4, without listeners) until the pass ends, however it ends. Cancel and the unresumable fail claim without holding: they take milliseconds. The run status lists (`CLAIMED_WORKFLOW_RUN_STATUSES`, `ACTIVE_WORKFLOW_RUN_STATUSES`) and the claim types (`RunClaim`, `ExpiredClaim`, `RunSettlement`, …) live in `workflow/types.ts`.
- Every write that ends a pass takes the token (`markRunning`, `markSuspended`/`markFinished`/`markFailed`, `releaseClaim`, `persistResult`, `persistCrash`) and only applies while the run is still active under it (`WorkflowRunRepository.settle`); it returns `false` otherwise, and the outcome of the pass is dropped (`claim_lost`, or `WorkflowRunClaimLostError` on a start). A `null` token takes an active run over (thread close only). These writes are query-builder `UPDATE`s: they set `updatedAt` themselves and emit `hook:workflowRun:postUpdate`, which the admin run lists follow.
- Recovery: every node sweeps every TTL/2 for runs whose claim lapsed, once its own queries have succeeded for a whole TTL (so that after a database outage, live nodes first renew their claims). A run with a checkpoint (its resume died) is put back on the suspension it was claimed from: same checkpoint, `suspendedAt`, context and `awaitingOperator`, so an approval is pending again; `hook:workflow:suspended` is emitted, the suspended children its pass called and its checkpoint does not wait on are cancelled, and ended children are delivered. A run whose caller ended, or interrupted 3 times in a row (`recovery_count`), is cancelled instead. A run without a checkpoint (its first pass died) is failed, its suspended descendants cancelled and a waiting parent sent the failed result. The recovery write re-checks the lapse, so a late renewal wins and each run is recovered once. Steps that ran in the dead pass run again on the next resume. Node clocks must agree within ¾ TTL.
- Inbound events resolve the first open wait not listed in `HOST_RESOLVED_WAIT_REASONS` (`packages/api/src/workflow/types.ts`); the host resolves the others itself (e.g. `awaiting_child_workflow`, resolved by the child run's result through the wait whose `data.workflow_run_id` matches).
- A child run cannot resume a parent that is not `suspended` (still running, or claimed by another caller). Every path that leaves a run `suspended` (start, resume, refused resume) therefore calls `deliverMissedChildResults` to deliver the results of child runs that ended meanwhile.
- A run that can never resume (missing or drifted checkpoint, no pinned definition) is failed, its parent receives a failed child result, and the event starts a new run. A definition that no longer parses or compiles is not such a case: it depends on the registered actions and binding kinds, so the resume throws and the run stays suspended.
- Actions declare their resume payload with `suspend({ accepts })` instead of validating it and throwing.
- Operator waits (`awaiting_approval` from `await_approval`, `awaiting_resume` from `suspend_workflow`; `OPERATOR_WAIT_REASONS`) are host-resolved: only `WorkflowRunOperatorService` resolves them, behind `PATCH /workflowrun/:id/approve|reject|resume|cancel` (`workflowrun:update`). It builds the payload from the session user (`decided_by`/`resumed_by`, timestamp), so clients never set them; payload shapes live in `workflow/schemas/operator-wait-schemas.ts`. Docs: `src/extensions/actions/workflow/README.md`.
- A resume without an inbound event rebuilds one with `WorkflowEventRestorer` (by `run.workflow.type`; conversational events come from the thread, subscriber, source and channel as they are now, `buildInput()` from the stack root run's input). It throws `WorkflowTriggerUnavailableError` (closed thread, deleted initiator, disabled source or channel).
- `workflow_runs.awaiting_operator` is `true` iff the stored checkpoint holds an open operator wait: `markSuspended` derives it from `checkpoint.waits`, `markFinished`/`markFailed` clear it, and claims leave it. `GET /workflowrun/pending` scopes on it (`withAwaitingOperatorScope`, which also requires `status = suspended`).
- A run blocked on an operator (only host-resolved waits, at least one operator wait; `isBlockedOnOperator`) holds the messages of its conversation, but manual, webhook and scheduled events skip it (`findSuspendedRunByInitiator(..., { skipBlockedOnOperator })`) and start a new run.
- `AgenticService.cancelRun` claims the suspension, marks the steps of its open waits `cancelled`, fails the run, emits `hook:step:cancelled`/`hook:workflow:failure` (all in `WorkflowRunService.cancelSuspended`), cancels its suspended descendants and sends a failed result to a waiting parent.
- Closing a thread (`hook:thread:postUpdate`) runs `WorkflowRunService.abortActiveRunsForThread`: each suspended run of the thread goes through `cancelSuspended` (claimed, waits cancelled, hooks emitted), and idle/running runs are only marked failed, taken over from their pass, whose final write is then dropped. A run whose status changed since it was loaded (claimed or recovered meanwhile) is handled once more from its new status. Child runs share their caller's thread, so no parent is resumed.
- Deleting a workflow deletes its runs (`workflow_runs.workflow_id` is `ON DELETE CASCADE`). `WorkflowRunOperatorService` settles the call stacks around them: on `hook:workflow:preDelete`, `WorkflowRunService.prepareWorkflowDeletion` cancels the suspended runs they called and returns the runs that called them; on `hook:workflow:postDelete` (after the deletion, so a step retry cannot start the workflow again) each suspended caller is resumed with a failed `call_workflow` result through `AgenticService.resumeFromEndedChildren`, with an event rebuilt by `WorkflowEventRestorer`.
- `resumeFromEndedChildren` treats a `call_workflow` wait whose child run no longer exists as a failed child (`Called workflow <id> was deleted`, or `Called workflow run <id> was deleted` when the workflow still exists). This is the safety net for callers the delete hooks could not notify (trigger not rebuildable, a child in flight, runs stranded before this fix): their next event, or their next suspension, fails the call.

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
